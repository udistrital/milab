const express = require('express');
const pool = require('../../../libs/db');
const { fetchSanctionCategories } = require('../../../libs/sanction-categories');
const { normalizeLogDocument } = require('../../../libs/account-email');
const { requireRoles, getUserRoles, renderAuthError } = require('../../middlewares/auth');
const { renderApplicationError } = require('../../middlewares/error-handler');

const router = express.Router();
router.use(express.json());
router.use(express.urlencoded({ extended: true }));
router.use(
  requireRoles('admin', {
    message: 'Acceso denegado',
    message2: 'Solo los administradores pueden gestionar el catálogo de sanciones.',
    limit: 'loginOnly',
  })
);
router.use((req, res, next) => {
  const isAdmin = getUserRoles(req.session?.user).some((role) =>
    ['admin', 'administrador', 'administradora'].includes(String(role).trim().toLowerCase())
  );
  if (!isAdmin) {
    return renderAuthError(res, {
      message: 'Acceso denegado',
      message2: 'Solo los administradores pueden gestionar el catálogo de sanciones.',
      limit: 'loginOnly',
    });
  }
  return next();
});

async function renderPage(req, res, status = 200, error = null) {
  const categories = await fetchSanctionCategories({ activeOnly: false, client: pool });
  return res.status(status).render('home/admin_sanciones', {
    categories,
    error,
    success: ['creada', 'editada', 'estado'].includes(req.query.success) ? req.query.success : null,
  });
}

function handleError(req, res, error) {
  console.error('Error gestionando catálogo de sanciones:', error);
  return renderApplicationError(
    res,
    {
      status: 500,
      message: 'No fue posible gestionar el catálogo de sanciones.',
      message2: 'Verifica que la migración del catálogo se haya aplicado e inténtalo nuevamente.',
      limit: null,
    },
    req,
    error
  );
}

router.get('/', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    return await renderPage(req, res);
  } catch (error) {
    return handleError(req, res, error);
  }
});

async function mutateCategory(req, res, operation) {
  const id = Number(req.params.id);
  const nombre = typeof req.body.nombre === 'string' ? req.body.nombre.trim() : '';
  const descripcion = typeof req.body.descripcion === 'string' ? req.body.descripcion.trim() : '';
  const validFields =
    nombre.length >= 2 &&
    nombre.length <= 150 &&
    descripcion.length >= 2 &&
    descripcion.length <= 500;
  const validId = Number.isSafeInteger(id) && id > 0;
  let client;
  try {
    if (
      (operation !== 'crear' && !validId) ||
      (operation !== 'estado' && !validFields) ||
      (operation === 'estado' && !['true', 'false'].includes(req.body.activo))
    ) {
      return await renderPage(
        req,
        res,
        400,
        'Datos inválidos. Usa un nombre de 2 a 150 caracteres y una descripción de 2 a 500 caracteres.'
      );
    }

    client = await pool.connect();
    await client.query('BEGIN');
    let result;
    if (operation === 'crear') {
      result = await client.query(
        'INSERT INTO categoria_sancion (nombre, descripcion) VALUES ($1, $2) RETURNING id, nombre, descripcion, activo',
        [nombre, descripcion]
      );
    } else if (operation === 'editar') {
      result = await client.query(
        `UPDATE categoria_sancion SET nombre = $1, descripcion = $2,
         fecha_modificacion = CURRENT_TIMESTAMP WHERE id = $3
         RETURNING id, nombre, descripcion, activo`,
        [nombre, descripcion, id]
      );
    } else {
      result = await client.query(
        `UPDATE categoria_sancion SET activo = $1, fecha_modificacion = CURRENT_TIMESTAMP
         WHERE id = $2 RETURNING id, nombre, descripcion, activo`,
        [req.body.activo === 'true', id]
      );
    }
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      client.release();
      client = null;
      return await renderPage(req, res, 404, 'La categoría seleccionada no existe.');
    }
    const actor = req.session.user;
    await client.query(
      'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
      [
        actor.tipo || 'admin',
        normalizeLogDocument(actor.documento_real || actor.documento),
        `Catálogo de sanciones: ${operation}`,
        `#${result.rows[0].id} | ${result.rows[0].nombre} | ${result.rows[0].activo ? 'activa' : 'inactiva'}`,
      ]
    );
    await client.query('COMMIT');
    return res.redirect(
      303,
      `/milab/api/admin/sanciones?success=${operation === 'crear' ? 'creada' : operation === 'editar' ? 'editada' : 'estado'}`
    );
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error revirtiendo cambio del catálogo de sanciones:', rollbackError);
      }
      client.release();
      client = null;
    }
    if (error.code === '23505') {
      try {
        return await renderPage(
          req,
          res,
          409,
          'Ya existe una categoría con ese nombre o descripción, incluso si está inactiva.'
        );
      } catch (renderError) {
        return handleError(req, res, renderError);
      }
    }
    return handleError(req, res, error);
  } finally {
    if (client) client.release();
  }
}

router.post('/crear', (req, res) => mutateCategory(req, res, 'crear'));
router.post('/:id/editar', (req, res) => mutateCategory(req, res, 'editar'));
router.post('/:id/estado', (req, res) => mutateCategory(req, res, 'estado'));

module.exports = router;
