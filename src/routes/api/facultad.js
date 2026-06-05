const express = require('express');

const pool = require('../../libs/db');
const { normalizeLogDocument } = require('../../libs/account-email');
const { requireRoles } = require('../middlewares/auth');

const router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: false }));

const requireAdminFacultyAccess = requireRoles('admin', {
  message: '¡Acceso denegado!',
  message2: 'No tienes permisos para esta acción',
  limit: 'noSession',
});

function getLogActorDocument(req) {
  return normalizeLogDocument(req.session?.user?.documento);
}

function normalizeUalDescription(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeUalShortCode(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized || null;
}

function isValidUalShortCode(value) {
  return /^[A-Z0-9_-]+$/.test(value);
}

router.use(requireAdminFacultyAccess);

// Página principal de administración de facultades y UALs (admin solo)
router.get('/', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const { facultad_id: facultadId } = req.query;

  try {
    let facultades = [];
    let selectedFacultad = null;
    let uals = [];

    const facRes = await pool.query('SELECT facultad_id, nombre FROM facultad ORDER BY nombre ASC');
    facultades = facRes.rows;
    if (facultadId) {
      const facSel = facultades.find((f) => String(f.facultad_id) === String(facultadId));
      selectedFacultad = facSel || null;
      const ualRes = await pool.query(
        'SELECT ual_id, nombre, codigo_abreviacion, descripcion FROM ual WHERE facultad_id = $1 ORDER BY nombre ASC',
        [facultadId]
      );
      uals = ualRes.rows;
    }

    return res.render('home/facultad', { facultades, uals, selectedFacultad });
  } catch (error) {
    console.error('Error cargando facultades/UALs:', error);
    return res.render('home/message_error', {
      message: 'Error al cargar datos',
      message2: 'Por favor intenta nuevamente',
      limit: null,
    });
  }
});

// Agregar facultad
router.post('/add', async (req, res) => {
  const { nombre } = req.body;
  if (!nombre || !nombre.trim()) {
    return res.render('home/message_error', {
      message: 'Nombre inválido',
      message2: 'Proporcione un nombre de facultad válido',
      limit: null,
    });
  }

  try {
    await pool.query('INSERT INTO facultad (nombre) VALUES ($1)', [nombre.trim()]);
    await pool.query(
      'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
      [req.session.user.tipo, getLogActorDocument(req), 'agregar facultad', nombre.trim()]
    );
    return res.redirect('/milab/api/facultad');
  } catch (error) {
    console.error('Error agregando facultad:', error);
    return res.render('home/message_error', {
      message: 'Error al agregar facultad',
      message2: 'Inténtalo nuevamente',
      limit: null,
    });
  }
});

// Eliminar facultad (solo si no tiene dependencias)
router.post('/eliminar', async (req, res) => {
  const { facultad_id: facultadId } = req.body;
  if (!facultadId) {
    return res.render('home/message_error', {
      message: 'ID de facultad inválido',
      message2: 'Verifique la solicitud',
      limit: null,
    });
  }

  try {
    const depUal = await pool.query('SELECT COUNT(*)::int AS c FROM ual WHERE facultad_id = $1', [
      facultadId,
    ]);
    const depLab = await pool.query(
      `SELECT COUNT(DISTINCT lu.laboratorista_documento_id)::int AS c
       FROM laboratorista_ual lu
       JOIN ual u ON u.ual_id = lu.ual_id
       WHERE u.facultad_id = $1`,
      [facultadId]
    );
    const depCoord = await pool.query(
      'SELECT COUNT(*)::int AS c FROM coordinador_facultad WHERE facultad_id = $1',
      [facultadId]
    );

    if (depUal.rows[0].c > 0 || depLab.rows[0].c > 0 || depCoord.rows[0].c > 0) {
      return res.render('home/message_error', {
        message: 'No se puede eliminar la facultad',
        message2: 'Tiene UALs o usuarios asociados. Elimine dependencias primero.',
        limit: null,
      });
    }

    const facNameRes = await pool.query('SELECT nombre FROM facultad WHERE facultad_id = $1', [
      facultadId,
    ]);
    const facName = facNameRes.rows[0] ? facNameRes.rows[0].nombre : String(facultadId);

    await pool.query('DELETE FROM facultad WHERE facultad_id = $1', [facultadId]);
    await pool.query(
      'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
      [req.session.user.tipo, getLogActorDocument(req), 'eliminar facultad', facName]
    );
    return res.redirect('/milab/api/facultad');
  } catch (error) {
    console.error('Error eliminando facultad:', error);
    return res.render('home/message_error', {
      message: 'Error al eliminar facultad',
      message2: 'Inténtalo nuevamente',
      limit: null,
    });
  }
});

// Agregar UAL a una facultad
router.post('/ual/add', async (req, res) => {
  const { facultad_id: facultadId } = req.body;
  const { nombre } = req.body;
  const codigoAbreviacion = normalizeUalShortCode(req.body.codigo_abreviacion);
  const descripcion = normalizeUalDescription(req.body.descripcion);
  if (!facultadId || !nombre || !nombre.trim()) {
    return res.render('home/message_error', {
      message: 'Datos inválidos',
      message2: 'Proporcione nombre de UAL y facultad válidos',
      limit: null,
    });
  }

  if (codigoAbreviacion) {
    if (codigoAbreviacion.length > 30 || !isValidUalShortCode(codigoAbreviacion)) {
      return res.render('home/message_error', {
        message: 'Código abreviado inválido',
        message2: 'Usa máximo 30 caracteres con letras, números, guion o guion bajo.',
        limit: null,
      });
    }
  }

  if (descripcion && descripcion.length > 255) {
    return res.render('home/message_error', {
      message: 'Descripción inválida',
      message2: 'La descripción de la UAL no puede superar 255 caracteres.',
      limit: null,
    });
  }

  try {
    await pool.query(
      'INSERT INTO ual (nombre, codigo_abreviacion, descripcion, facultad_id) VALUES ($1, $2, $3, $4)',
      [nombre.trim(), codigoAbreviacion, descripcion, facultadId]
    );
    await pool.query(
      'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
      [req.session.user.tipo, getLogActorDocument(req), 'agregar UAL', nombre.trim()]
    );
    return res.redirect(`/milab/api/facultad?facultad_id=${facultadId}`);
  } catch (error) {
    console.error('Error agregando UAL:', error);

    if (
      error?.code === '23505' &&
      String(error?.constraint || '').includes('idx_ual_codigo_abreviacion_unique')
    ) {
      return res.render('home/message_error', {
        message: 'Código abreviado duplicado',
        message2: 'Ya existe una UAL con ese código abreviado.',
        limit: null,
      });
    }

    return res.render('home/message_error', {
      message: 'Error al agregar UAL',
      message2: 'Inténtalo nuevamente',
      limit: null,
    });
  }
});

// Editar UAL (admin o coordinador dentro de su facultad)
router.post('/ual/editar', async (req, res) => {
  const { ual_id: ualId, facultad_id: facultadId, new_facultad_id: newFacultadId } = req.body;
  const { nombre } = req.body;
  const codigoAbreviacion = normalizeUalShortCode(req.body.codigo_abreviacion);
  const descripcion = normalizeUalDescription(req.body.descripcion);
  if (!ualId || !nombre || !nombre.trim()) {
    return res.render('home/message_error', {
      message: 'Datos inválidos',
      message2: 'Proporcione un nombre válido para la UAL',
      limit: null,
    });
  }

  if (codigoAbreviacion) {
    if (codigoAbreviacion.length > 30 || !isValidUalShortCode(codigoAbreviacion)) {
      return res.render('home/message_error', {
        message: 'Código abreviado inválido',
        message2: 'Usa máximo 30 caracteres con letras, números, guion o guion bajo.',
        limit: null,
      });
    }
  }

  if (descripcion && descripcion.length > 255) {
    return res.render('home/message_error', {
      message: 'Descripción inválida',
      message2: 'La descripción de la UAL no puede superar 255 caracteres.',
      limit: null,
    });
  }

  try {
    // Solo admin edita UAL

    const oldRes = await pool.query(
      'SELECT ual.nombre AS ual_nombre, ual.codigo_abreviacion AS ual_codigo_abreviacion, ual.descripcion AS ual_descripcion, ual.facultad_id AS ual_facultad, f.nombre AS facultad_nombre FROM ual JOIN facultad f ON f.facultad_id = ual.facultad_id WHERE ual_id = $1',
      [ualId]
    );
    const oldRow = oldRes.rows[0] || {
      ual_nombre: '',
      ual_facultad: facultadId,
      facultad_nombre: '',
    };

    // Actualización de nombre, código y descripción
    await pool.query(
      'UPDATE ual SET nombre = $1, codigo_abreviacion = $2, descripcion = $3 WHERE ual_id = $4',
      [nombre.trim(), codigoAbreviacion, descripcion, ualId]
    );

    // Si es admin y envía new_facultad_id diferente, mover UAL a otra facultad
    let redirectFacultadId = facultadId;
    let cambioFacultadTexto = '';
    if (
      req.session.user.tipo === 'admin' &&
      newFacultadId &&
      String(newFacultadId) !== String(oldRow.ual_facultad)
    ) {
      // Validar que la facultad destino existe
      const facDestRes = await pool.query('SELECT nombre FROM facultad WHERE facultad_id = $1', [
        newFacultadId,
      ]);
      if (facDestRes.rows.length === 0) {
        return res.render('home/message_error', {
          message: 'Facultad destino inválida',
          message2: 'Seleccione una facultad existente',
          limit: null,
        });
      }
      await pool.query('UPDATE ual SET facultad_id = $1 WHERE ual_id = $2', [newFacultadId, ualId]);
      cambioFacultadTexto = ` | facultad: ${oldRow.facultad_nombre} -> ${facDestRes.rows[0].nombre}`;
      redirectFacultadId = newFacultadId;
    }

    await pool.query(
      'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
      [
        req.session.user.tipo,
        getLogActorDocument(req),
        'editar UAL',
        `${oldRow.ual_nombre} -> ${nombre.trim()}${cambioFacultadTexto}`,
      ]
    );
    return res.redirect(`/milab/api/facultad?facultad_id=${redirectFacultadId || ''}`);
  } catch (error) {
    console.error('Error editando UAL:', error);

    if (
      error?.code === '23505' &&
      String(error?.constraint || '').includes('idx_ual_codigo_abreviacion_unique')
    ) {
      return res.render('home/message_error', {
        message: 'Código abreviado duplicado',
        message2: 'Ya existe una UAL con ese código abreviado.',
        limit: null,
      });
    }

    return res.render('home/message_error', {
      message: 'Error al editar UAL',
      message2: 'Inténtalo nuevamente',
      limit: null,
    });
  }
});

// Eliminar UAL (solo si no tiene laboratoristas asociados)
router.post('/ual/eliminar', async (req, res) => {
  const { ual_id: ualId, facultad_id: facultadId } = req.body;
  if (!ualId) {
    return res.render('home/message_error', {
      message: 'ID de UAL inválido',
      message2: 'Verifique la solicitud',
      limit: null,
    });
  }

  try {
    const depLabMulti = await pool.query(
      'SELECT COUNT(*)::int AS c FROM laboratorista_ual WHERE ual_id = $1',
      [ualId]
    );
    const depLabCount = depLabMulti.rows[0]?.c || 0;

    if (depLabCount > 0) {
      return res.render('home/message_error', {
        message: 'No se puede eliminar la UAL',
        message2: 'Tiene laboratoristas asociados. Elimine dependencias primero.',
        limit: null,
      });
    }
    const ualNameRes = await pool.query('SELECT nombre FROM ual WHERE ual_id = $1', [ualId]);
    const ualName = ualNameRes.rows[0] ? ualNameRes.rows[0].nombre : String(ualId);
    await pool.query('DELETE FROM ual WHERE ual_id = $1', [ualId]);
    await pool.query(
      'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
      [req.session.user.tipo, getLogActorDocument(req), 'eliminar UAL', ualName]
    );
    return res.redirect(`/milab/api/facultad?facultad_id=${facultadId || ''}`);
  } catch (error) {
    console.error('Error eliminando UAL:', error);
    return res.render('home/message_error', {
      message: 'Error al eliminar UAL',
      message2: 'Inténtalo nuevamente',
      limit: null,
    });
  }
});

// Editar Facultad (solo admin)
router.post('/editar', async (req, res) => {
  const { facultad_id: facultadId } = req.body;
  const { nombre } = req.body;
  if (!facultadId || !nombre || !nombre.trim()) {
    return res.render('home/message_error', {
      message: 'Datos inválidos',
      message2: 'Proporcione un nombre válido para la facultad',
      limit: null,
    });
  }

  try {
    const oldRes = await pool.query('SELECT nombre FROM facultad WHERE facultad_id = $1', [
      facultadId,
    ]);
    const oldName = oldRes.rows[0] ? oldRes.rows[0].nombre : '';
    await pool.query('UPDATE facultad SET nombre = $1 WHERE facultad_id = $2', [
      nombre.trim(),
      facultadId,
    ]);
    await pool.query(
      'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
      [
        req.session.user.tipo,
        getLogActorDocument(req),
        'editar facultad',
        `${oldName} -> ${nombre.trim()}`,
      ]
    );
    return res.redirect('/milab/api/facultad');
  } catch (error) {
    console.error('Error editando facultad:', error);
    return res.render('home/message_error', {
      message: 'Error al editar facultad',
      message2: 'Inténtalo nuevamente',
      limit: null,
    });
  }
});

module.exports = router;
