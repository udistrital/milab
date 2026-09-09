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
const { renderApplicationError, wantsJson } = require('../middlewares/error-handler');

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

async function resolveCoordinatorUserId(client, coordinador) {
  if (coordinador?.usuario_id) {
    return coordinador.usuario_id;
  }

  const result = await client.query(
    `SELECT id
     FROM usuario
     WHERE documento = $1
        OR documento = $2
        OR (correo IS NOT NULL AND LOWER(correo) = LOWER($3))
     LIMIT 1`,
    [coordinador?.documento || '', coordinador?.nombre_u || '', coordinador?.correo || '']
  );

  return result.rows[0]?.id || null;
}

async function resolveExistingColumn(tableName, candidateColumns) {
  try {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = ANY($2::text[]) LIMIT 1`,
      [tableName, candidateColumns]
    );
    return res.rows[0]?.column_name || candidateColumns[0];
  } catch (e) {
    return candidateColumns[0];
  }
}

router.get('/', requireAdminCoordinadoresView, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  let client;

  try {
    client = await pool.connect();
    const query = `
      SELECT c.nombre AS con_nombre,
             c.documento AS con_documento,
             c.correo AS con_correo,
             STRING_AGG(DISTINCT f.nombre, ', ' ORDER BY f.nombre) AS facultad_nombre,
             ARRAY_AGG(DISTINCT f.facultad_id ORDER BY f.facultad_id) FILTER (WHERE f.facultad_id IS NOT NULL) AS facultad_ids,
             CASE WHEN COALESCE(role_state.activo, FALSE)
               THEN 'coordinador'
               ELSE 'inactivo'
             END AS tipo
      FROM coordinador c
      JOIN coordinador_facultad cf ON cf.coordinador_documento_id = c.documento
      JOIN facultad f ON f.facultad_id = cf.facultad_id
      LEFT JOIN usuario u
        ON u.id = c.usuario_id
        OR u.documento = c.documento
        OR (c.nombre_u IS NOT NULL AND u.documento = c.nombre_u)
        OR (c.correo IS NOT NULL AND LOWER(u.correo) = LOWER(c.correo))
      LEFT JOIN LATERAL (
        SELECT ur.activo
        FROM usuario_rol ur
        JOIN rol r ON r.id = ur.rol_id
        WHERE ur.usuario_id = u.id
          AND r.nombre = 'coordinador'
        LIMIT 1
      ) role_state ON true
      GROUP BY c.nombre, c.documento, c.correo, role_state.activo
    `;
    const result = await client.query(query);
    const coordinadores = result.rows;

    const facultadesResult = await client.query(
      'SELECT facultad_id, nombre FROM facultad ORDER BY nombre ASC'
    );
    const facultadesDisponibles = facultadesResult.rows;

    return res.render('home/coordinadores_registrados', {
      coordinadores,
      facultadesDisponibles,
    });
  } catch (error) {
    console.error('Error al obtener coordinadores:', error);

    if (wantsJson(req)) {
      return res.status(500).json({
        ok: false,
        message: 'No fue posible cargar los coordinadores registrados.',
        message2: 'Intenta nuevamente en unos minutos.',
      });
    }

    return renderApplicationError(res, {
      status: 500,
      message: 'No fue posible cargar los coordinadores registrados.',
      message2: 'Intenta nuevamente en unos minutos.',
      limit: null,
    });
  } finally {
    if (client) client.release();
  }
});

router.post('/actualizar', requireAdminCoordinatorEmailEdit, async (req, res) => {
  const documento = String(req.body.documento || '').trim();
  const correo = normalizeInstitutionalEmail(req.body.correo);

  const facultyIdsInput = req.body.facultad_ids;
  const facultadIds = Array.isArray(facultyIdsInput)
    ? facultyIdsInput.map((x) => parseInt(String(x || '0'), 10)).filter(Number.isFinite)
    : typeof facultyIdsInput === 'string' && /^\d+$/.test(facultyIdsInput)
      ? [parseInt(facultyIdsInput, 10)]
      : [];

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

  if (!facultadIds.length) {
    return res.status(400).json({
      ok: false,
      message: 'Debes seleccionar al menos una sede / facultad.',
    });
  }

  let client;

  try {
    client = await pool.connect();

    const coordinatorResult = await client.query(
      'SELECT documento, nombre, correo, nombre_u, usuario_id FROM coordinador WHERE documento = $1',
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
    const conflict = await findEmailConflict(
      client,
      correo,
      coordinador.documento || coordinador.nombre_u
    );

    if (conflict) {
      client.release();
      return res.status(409).json({
        ok: false,
        message: 'Ese correo ya existe vinculado a otra cuenta.',
      });
    }

    const validFacultyColumn = await resolveExistingColumn('facultad', [
      'facultad_id',
      'id_facultad',
    ]);
    const validFacs = await client.query(
      `SELECT ${validFacultyColumn} AS facultad_id FROM facultad WHERE ${validFacultyColumn} = ANY($1::int[])`,
      [facultadIds]
    );
    if (validFacs.rows.length !== facultadIds.length) {
      client.release();
      return res.status(400).json({
        ok: false,
        message: 'Una o más facultades seleccionadas no existen.',
      });
    }

    const coordinatorFacultyColumn = await resolveExistingColumn('coordinador_facultad', [
      'facultad_id',
      'id_facultad',
    ]);

    await client.query('BEGIN');
    await client.query('UPDATE coordinador SET correo = $1 WHERE documento = $2', [
      correo,
      documento,
    ]);
    if (coordinador.usuario_id) {
      await client.query(
        `UPDATE usuario
         SET correo = $1,
            fecha_modificacion = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [correo, coordinador.usuario_id]
      );
    } else {
      await client.query(
        `UPDATE usuario
         SET correo = $1,
            fecha_modificacion = CURRENT_TIMESTAMP
         WHERE documento = $2`,
        [correo, documento]
      );
    }

    await client.query(`DELETE FROM coordinador_facultad WHERE coordinador_documento_id = $1`, [
      documento,
    ]);

    for (const facId of facultadIds) {
      await client.query(
        `INSERT INTO coordinador_facultad (coordinador_documento_id, ${coordinatorFacultyColumn})
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [documento, facId]
      );
    }

    await client.query(
      'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
      [
        req.session.user.tipo,
        normalizeLogDocument(req.session.user.documento),
        'Actualizar correo y facultades coordinador',
        documento,
      ]
    );
    await client.query('COMMIT');
    client.release();

    return res.json({
      ok: true,
      correo,
      documento,
      facultad_ids: facultadIds,
    });
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error(
          'Error al revertir actualización de correo y facultades de coordinador:',
          rollbackError
        );
      }
      client.release();
    }

    console.error('Error al actualizar coordinador:', error);

    if (isUniqueViolation(error)) {
      return res.status(409).json({
        ok: false,
        message: 'Ese correo ya existe vinculado a otra cuenta.',
      });
    }

    return res.status(500).json({
      ok: false,
      message: 'No fue posible actualizar el coordinador. Inténtalo nuevamente.',
    });
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
      'SELECT documento, nombre, correo, nombre_u, usuario_id FROM coordinador WHERE documento = $1',
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
    const conflict = await findEmailConflict(
      client,
      correo,
      coordinador.documento || coordinador.nombre_u
    );

    if (conflict) {
      client.release();
      return res.status(409).json({
        ok: false,
        message: 'Ese correo ya existe vinculado a otra cuenta.',
      });
    }

    await client.query('BEGIN');
    await client.query('UPDATE coordinador SET correo = $1 WHERE documento = $2', [
      correo,
      documento,
    ]);
    if (coordinador.usuario_id) {
      await client.query(
        `UPDATE usuario
         SET correo = $1,
            fecha_modificacion = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [correo, coordinador.usuario_id]
      );
    } else {
      await client.query(
        `UPDATE usuario
         SET correo = $1,
            fecha_modificacion = CURRENT_TIMESTAMP
         WHERE documento = $2`,
        [correo, documento]
      );
    }
    await client.query(
      'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
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
      'SELECT documento, correo, nombre_u, usuario_id FROM coordinador WHERE documento = $1',
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
    const coordinador = checkResult.rows[0];
    const userId = await resolveCoordinatorUserId(client, coordinador);
    await client.query('BEGIN');
    await client.query('DELETE FROM coordinador WHERE documento = $1', [documento]);
    if (userId) {
      await client.query(
        `UPDATE usuario_rol ur
         SET activo = FALSE,
             fecha_modificacion = CURRENT_TIMESTAMP
         FROM rol r
         WHERE ur.usuario_id = $1
           AND ur.rol_id = r.id
           AND r.nombre = 'coordinador'`,
        [userId]
      );
    }
    await client.query(
      'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
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

// POST cambiar estado del rol coordinador
router.post('/toggle-estado', requireAdminOrLabCoordinatorToggle, async (req, res) => {
  const { documento } = req.body;

  let client2;
  try {
    client2 = await pool.connect();
    const coordRes = await client2.query(
      'SELECT documento, correo, nombre_u, usuario_id FROM coordinador WHERE documento = $1',
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
    const coordinador = coordRes.rows[0];
    const userId = await resolveCoordinatorUserId(client2, coordinador);
    if (!userId) {
      client2.release();
      return res.render('home/message_error', {
        message: 'No se encontró usuario asociado al coordinador.',
        message2: 'Verifique los datos del coordinador.',
        limit: 'noSession',
      });
    }

    const result = await client2.query(
      `SELECT ur.activo
       FROM usuario_rol ur
       JOIN rol r ON r.id = ur.rol_id
       WHERE ur.usuario_id = $1
         AND r.nombre = 'coordinador'`,
      [userId]
    );

    const hasExistingCoordinatorRole = result.rows.length > 0;
    const nuevoEstado = hasExistingCoordinatorRole ? !result.rows[0].activo : true;

    if (hasExistingCoordinatorRole) {
      await client2.query(
        `UPDATE usuario_rol ur
         SET activo = $2,
             fecha_modificacion = CURRENT_TIMESTAMP
         FROM rol r
         WHERE ur.usuario_id = $1
           AND ur.rol_id = r.id
           AND r.nombre = 'coordinador'`,
        [userId, nuevoEstado]
      );
    } else {
      await client2.query(
        `INSERT INTO usuario_rol (usuario_id, rol_id, activo)
         SELECT $1, id, TRUE FROM rol WHERE nombre = 'coordinador'
         ON CONFLICT (usuario_id, rol_id) DO UPDATE
         SET activo = TRUE,
             fecha_modificacion = CURRENT_TIMESTAMP`,
        [userId]
      );
    }

    const estadoLabel = nuevoEstado ? 'coordinador' : 'inactivo';
    await client2.query(
      'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
      [
        'admin',
        normalizeLogDocument(req.session.user.documento),
        `cambiar estado coordinador a ${estadoLabel}`,
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
