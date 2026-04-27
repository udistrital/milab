const express = require('express');
const pool = require('../../libs/db');
const {
  findEmailConflict,
  isInstitutionalEmail,
  isUniqueViolation,
  normalizeLogDocument,
  normalizeInstitutionalEmail,
} = require('../../libs/account-email');
const { requireJsonRoles, requireRoles } = require('../middlewares/auth');

const router = express.Router();

router.use(express.urlencoded({ extended: true }));

const requireAdminCoordinadoresView = requireRoles('admin', {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

const requireAdminOrLabCoordinatorAction = requireRoles(['admin', 'laboratorista'], {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

const requireAdminOrLabCoordinatorToggle = requireRoles(['admin', 'laboratorista'], {
  message: '¡Acceso denegado!',
  message2: 'No tienes permisos para esta acción',
  limit: 'noSession',
});

const requireAdminCoordinatorEmailEdit = requireJsonRoles('admin', {
  message: 'No tienes permisos para actualizar este correo.',
});

router.get('/', requireAdminCoordinadoresView, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const query = `
      SELECT c.nombre AS con_nombre, 
             c.documento AS con_documento, 
             c.correo AS con_correo,
             c.id_facultad AS con_facultad, 
             f.nombre AS facultad_nombre, 
             a.tipo
      FROM coordinador_laboratorio c
      JOIN auth a ON c.nombre_u = a.documento
      JOIN facultad f ON c.id_facultad = f.id_facultad
    `;
    const result = await pool.query(query);
    const coordinadores = result.rows;
    res.render('home/coordinadores_registrados', { coordinadores });
  } catch (error) {
    console.error('Error al obtener coordinadores:', error);
    res.status(500).send('Error al obtener coordinadores');
  }
});

router.post('/actualizar-correo', requireAdminCoordinatorEmailEdit, async (req, res) => {
  const documento = String(req.body.documento || '').trim();
  const correo = normalizeInstitutionalEmail(req.body.correo);

  if (!documento) {
    return res.status(400).json({
      ok: false,
      message: 'Debes indicar el documento del coordinador.',
    });
  }

  if (!isInstitutionalEmail(correo)) {
    return res.status(400).json({
      ok: false,
      message: 'Solo se permiten correos institucionales @udistrital.edu.co.',
    });
  }

  let client;

  try {
    client = await pool.connect();

    const coordinatorResult = await client.query(
      'SELECT documento, nombre, correo, nombre_u, usuario_id FROM coordinador_laboratorio WHERE documento = $1',
      [documento]
    );

    if (coordinatorResult.rows.length === 0) {
      client.release();
      return res.status(404).json({
        ok: false,
        message: 'No encontramos el coordinador seleccionado.',
      });
    }

    const coordinador = coordinatorResult.rows[0];
    const conflict = await findEmailConflict(client, correo, coordinador.nombre_u);

    if (conflict) {
      client.release();
      return res.status(409).json({
        ok: false,
        message: 'Ese correo ya existe vinculado a otra cuenta.',
      });
    }

    await client.query('BEGIN');
    await client.query('UPDATE coordinador_laboratorio SET correo = $1 WHERE documento = $2', [
      correo,
      documento,
    ]);
    await client.query('UPDATE auth SET correo = $1 WHERE documento = $2', [
      correo,
      coordinador.nombre_u,
    ]);
    if (coordinador.usuario_id) {
      await client.query(
        `UPDATE usuarios
         SET correo = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [correo, coordinador.usuario_id]
      );
    } else {
      await client.query(
        `UPDATE usuarios
         SET correo = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE documento = $2`,
        [correo, documento]
      );
    }
    await client.query(
      'INSERT INTO logs (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
      [
        req.session.user.tipo,
        normalizeLogDocument(req.session.user.documento),
        'Actualizar correo coordinador',
        documento,
      ]
    );
    await client.query('COMMIT');
    client.release();

    return res.json({
      ok: true,
      correo,
      documento,
    });
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error al revertir actualización de correo de coordinador:', rollbackError);
      }
      client.release();
    }

    console.error('Error al actualizar correo de coordinador:', error);

    if (isUniqueViolation(error)) {
      return res.status(409).json({
        ok: false,
        message: 'Ese correo ya existe vinculado a otra cuenta.',
      });
    }

    return res.status(500).json({
      ok: false,
      message: 'No fue posible actualizar el correo. Inténtalo nuevamente.',
    });
  }
});

router.post('/eliminar', requireAdminOrLabCoordinatorAction, async (req, res) => {
  const { documento } = req.body;

  let client;
  try {
    client = await pool.connect();
    const checkResult = await client.query(
      'SELECT nombre_u FROM coordinador_laboratorio WHERE documento = $1',
      [documento]
    );
    if (checkResult.rows.length === 0) {
      client.release();
      return res.render('home/message_error', {
        message: '¡Coordinador no encontrado!',
        message2: 'Ya no existe en la base de datos',
        limit: 'noSession',
      });
    }
    const nombreU = checkResult.rows[0].nombre_u;
    await client.query('BEGIN');
    await client.query('DELETE FROM coordinador_laboratorio WHERE documento = $1', [documento]);
    await client.query('DELETE FROM auth WHERE documento = $1', [nombreU]);
    await client.query(
      'INSERT INTO logs (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
      [
        'admin',
        normalizeLogDocument(req.session.user.documento),
        'eliminar registro coordinador',
        documento,
      ]
    );
    await client.query('COMMIT');
    client.release();
    res.redirect('/milab/api/coordinadores_registrados');
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK');
      client.release();
    }
    console.error('Error al eliminar coordinador:', error);
    res.render('home/message_error', {
      message: '¡Error al eliminar coordinador!',
      message2: 'Inténtalo nuevamente',
      limit: 'noSession',
    });
  }
});

// POST cambiar estado en tabla auth
router.post('/toggle-estado', requireAdminOrLabCoordinatorToggle, async (req, res) => {
  const { documento } = req.body;

  let client2;
  try {
    client2 = await pool.connect();
    const coordRes = await client2.query(
      'SELECT nombre_u FROM coordinador_laboratorio WHERE documento = $1',
      [documento]
    );
    if (coordRes.rows.length === 0) {
      client2.release();
      return res.render('home/message_error', {
        message: '¡Coordinador no encontrado!',
        message2: 'Verifique el documento',
        limit: 'noSession',
      });
    }
    const nombreU = coordRes.rows[0].nombre_u;
    const result = await client2.query('SELECT tipo FROM auth WHERE documento = $1', [nombreU]);
    if (result.rows.length === 0) {
      client2.release();
      return res.render('home/message_error', {
        message: 'Datos inválidos. Verifique la información e inténtelo nuevamente.',
        message2: 'Revise los datos ingresados',
        limit: 'noSession',
      });
    }
    const tipoActual = result.rows[0].tipo;
    const nuevoTipo = tipoActual === 'coordinador' ? 'inactivo' : 'coordinador';
    await client2.query('UPDATE auth SET tipo = $1 WHERE documento = $2', [nuevoTipo, nombreU]);
    await client2.query(
      'INSERT INTO logs (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
      [
        'admin',
        normalizeLogDocument(req.session.user.documento),
        `cambiar tipo auth a ${nuevoTipo}`,
        documento,
      ]
    );
    client2.release();
    res.redirect('/milab/api/coordinadores_registrados');
  } catch (error) {
    if (client2) client2.release();
    console.error('Error al cambiar estado:', error);
    res.render('home/message_error', {
      message: '¡Error al cambiar estado!',
      message2: 'Inténtalo nuevamente',
      limit: 'noSession',
    });
  }
});

module.exports = router;
