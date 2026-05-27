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

const requireAdminOrCoordinadorLabAccess = requireRoles(['admin', 'coordinador'], {
  message: '¡Acceso denegado!',
  message2: 'No tienes permisos para ver el dashboard',
  limit: 'noSession',
});

const requireAdminOrCoordinadorLabAction = requireRoles(['admin', 'coordinador'], {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

const requireAdminOrCoordinadorLabEmailEdit = requireJsonRoles(['admin', 'coordinador'], {
  message: 'No tienes permisos para actualizar este correo.',
});

function normalizeSelectedUalIds(rawValue) {
  const values = Array.isArray(rawValue) ? rawValue : [rawValue];

  return values
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

async function resolveActorDocumentForLogs(req, client) {
  if (req.session?.user?.tipo !== 'coordinador') {
    return req.session?.user?.documento;
  }

  const result = await client.query('SELECT documento FROM coordinador WHERE nombre_u = $1', [
    req.session.user.documento,
  ]);

  return result.rows[0]?.documento || req.session.user.documento;
}

async function resolveCoordinatorFacultyIds(client, authDocument) {
  const coordInfoRes = await client.query(
    'SELECT documento, id_facultad FROM coordinador WHERE nombre_u = $1',
    [authDocument]
  );

  if (coordInfoRes.rows.length === 0) {
    return [];
  }

  const coordDocumento = coordInfoRes.rows[0].documento;
  const facultadPrincipal = coordInfoRes.rows[0].id_facultad;
  const facultadesRes = await client.query(
    'SELECT id_facultad FROM coordinador_facultad WHERE documento = $1',
    [coordDocumento]
  );

  const facultades = facultadesRes.rows.map((row) => row.id_facultad);

  if (facultades.length === 0 && facultadPrincipal) {
    return [facultadPrincipal];
  }

  return facultades;
}

router.get('/', requireAdminOrCoordinadorLabAccess, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  try {
    let laboratoristas;

    const baseQuery = `
      SELECT 
        l.nombre AS con_nombre,
        l.documento AS con_documento,
        l.correo AS con_correo,
        COALESCE(
          STRING_AGG(DISTINCT u_rel.nombre, ', ' ORDER BY u_rel.nombre),
          u_principal.nombre
        ) AS con_ual,
        f.nombre AS con_facultad
      FROM laboratorista l
      LEFT JOIN laboratorista_ual lu ON lu.documento = l.documento
      LEFT JOIN ual u_rel ON u_rel.id_ual = lu.id_ual
      LEFT JOIN ual u_principal ON u_principal.id_ual = l.id_ual
      JOIN facultad f ON f.id_facultad = l.id_facultad
    `;

    if (req.session.user.tipo === 'admin') {
      const result = await pool.query(
        `${baseQuery}
         GROUP BY l.nombre, l.documento, l.correo, u_principal.nombre, f.nombre
         ORDER BY l.nombre ASC`
      );
      laboratoristas = result.rows;
    } else if (req.session.user.tipo === 'coordinador') {
      // Obtener el documento real del coordinador y su facultad principal (compatibilidad)
      const coordInfoRes = await pool.query(
        `SELECT documento, id_facultad FROM coordinador WHERE nombre_u = $1`,
        [req.session.user.documento]
      );

      if (coordInfoRes.rows.length === 0) {
        return res.render('home/message_error', {
          message: '¡Error!',
          message2: 'No se encontró información del coordinador',
          limit: null,
        });
      }

      const coordDocumento = coordInfoRes.rows[0].documento;
      const facultadPrincipal = coordInfoRes.rows[0].id_facultad;

      // Recuperar todas las facultades asociadas mediante la tabla de unión
      const cfRes = await pool.query(
        `SELECT id_facultad FROM coordinador_facultad WHERE documento = $1`,
        [coordDocumento]
      );

      let facultadesCoord = cfRes.rows.map((r) => r.id_facultad);
      // Fallback: si aún no hay registros en la relación, usar la facultad principal
      if (facultadesCoord.length === 0 && facultadPrincipal) {
        facultadesCoord = [facultadPrincipal];
      }

      if (facultadesCoord.length === 0) {
        return res.render('home/message_error', {
          message: '¡Error!',
          message2: 'El coordinador no tiene facultades asociadas',
          limit: null,
        });
      }

      const result = await pool.query(
        `${baseQuery}
         WHERE l.id_facultad = ANY($1::int[])
         GROUP BY l.nombre, l.documento, l.correo, u_principal.nombre, f.nombre
         ORDER BY l.nombre ASC`,
        [facultadesCoord]
      );
      laboratoristas = result.rows;
    }

    res.render('home/laboratoristas_registrados', {
      laboratoristas,
      successMessage:
        req.query.updated === '1' ? 'El laboratorista se actualizó correctamente.' : null,
    });
  } catch (error) {
    console.error('Error al obtener laboratoristas:', error);
    res.render('home/message_error', {
      message: 'Error al obtener laboratoristas',
      message2: 'Por favor intenta nuevamente',
      limit: null,
    });
  }
});

router.get('/editar', requireAdminOrCoordinadorLabAccess, async (req, res) => {
  const documento = String(req.query.documento || '').trim();

  if (!documento) {
    return res.render('home/message_error', {
      message: '¡Error en los datos!',
      message2: 'Documento no válido',
      limit: null,
    });
  }

  try {
    const laboratoristaRes = await pool.query(
      `
        SELECT documento, nombre, correo, n_usuario, id_facultad, contrato, id_ual
        FROM laboratorista
        WHERE documento = $1
      `,
      [documento]
    );

    if (laboratoristaRes.rows.length === 0) {
      return res.render('home/message_error', {
        message: '¡Laboratorista no encontrado!',
        message2: 'El laboratorista solicitado no existe en la base de datos.',
        limit: null,
      });
    }

    const laboratorista = laboratoristaRes.rows[0];
    let facultadesPermitidas = null;

    if (req.session.user.tipo === 'coordinador') {
      facultadesPermitidas = await resolveCoordinatorFacultyIds(pool, req.session.user.documento);

      if (
        facultadesPermitidas.length === 0 ||
        !facultadesPermitidas.includes(laboratorista.id_facultad)
      ) {
        return res.render('home/message_error', {
          message: '¡Acceso denegado!',
          message2: 'No tienes permisos para editar este laboratorista.',
          limit: null,
        });
      }
    }

    const facultiesQuery =
      req.session.user.tipo === 'coordinador'
        ? 'SELECT id_facultad, nombre FROM facultad WHERE id_facultad = ANY($1::int[]) ORDER BY nombre ASC'
        : 'SELECT id_facultad, nombre FROM facultad ORDER BY nombre ASC';
    const facultadesRes =
      req.session.user.tipo === 'coordinador'
        ? await pool.query(facultiesQuery, [facultadesPermitidas])
        : await pool.query(facultiesQuery);

    const ualsQuery =
      req.session.user.tipo === 'coordinador'
        ? 'SELECT id_ual, nombre, id_facultad FROM ual WHERE id_facultad = ANY($1::int[]) ORDER BY nombre ASC'
        : 'SELECT id_ual, nombre, id_facultad FROM ual ORDER BY nombre ASC';
    const ualsRes =
      req.session.user.tipo === 'coordinador'
        ? await pool.query(ualsQuery, [facultadesPermitidas])
        : await pool.query(ualsQuery);

    const assignedUalsRes = await pool.query(
      'SELECT id_ual FROM laboratorista_ual WHERE documento = $1 ORDER BY id_ual ASC',
      [documento]
    );
    const assignedUalIds = assignedUalsRes.rows.map((row) => Number(row.id_ual));

    if (assignedUalIds.length === 0 && laboratorista.id_ual) {
      assignedUalIds.push(Number(laboratorista.id_ual));
    }

    return res.render('home/editar_laboratorista', {
      laboratorista,
      facultades: facultadesRes.rows,
      uals: ualsRes.rows,
      assignedUalIds,
      error: null,
    });
  } catch (error) {
    console.error('Error al cargar edición de laboratorista:', error);
    return res.render('home/message_error', {
      message: 'Error al cargar el laboratorista',
      message2: 'Por favor intenta nuevamente',
      limit: null,
    });
  }
});

router.post('/editar', requireAdminOrCoordinadorLabAction, async (req, res) => {
  const documento = String(req.body.documento || '').trim();
  const nombre = String(req.body.nombre || '').trim();
  const contrato = String(req.body.contrato || '').trim();
  const correo = normalizeInstitutionalEmail(req.body.correo);
  const selectedFacultyId = Number(req.body.facultad);
  const selectedUalIds = normalizeSelectedUalIds(req.body.id_uales);

  if (!documento || !nombre || !contrato || !selectedFacultyId || selectedUalIds.length === 0) {
    return res.render('home/message_error', {
      message: '¡Error en los datos!',
      message2: 'Completa nombre, correo, facultad y al menos un laboratorio.',
      limit: null,
    });
  }

  if (!isInstitutionalEmail(correo)) {
    return res.render('home/message_error', {
      message: 'Correo inválido',
      message2: 'Solo se permiten correos institucionales @udistrital.edu.co.',
      limit: null,
    });
  }

  let client;

  try {
    client = await pool.connect();

    const laboratoristaRes = await client.query(
      'SELECT documento, n_usuario, id_facultad, usuario_id FROM laboratorista WHERE documento = $1',
      [documento]
    );

    if (laboratoristaRes.rows.length === 0) {
      client.release();
      return res.render('home/message_error', {
        message: '¡Laboratorista no encontrado!',
        message2: 'El laboratorista solicitado no existe en la base de datos.',
        limit: null,
      });
    }

    const laboratorista = laboratoristaRes.rows[0];

    if (req.session.user.tipo === 'coordinador') {
      const facultadesPermitidas = await resolveCoordinatorFacultyIds(
        client,
        req.session.user.documento
      );

      if (
        facultadesPermitidas.length === 0 ||
        !facultadesPermitidas.includes(laboratorista.id_facultad) ||
        !facultadesPermitidas.includes(selectedFacultyId)
      ) {
        client.release();
        return res.render('home/message_error', {
          message: '¡Acceso denegado!',
          message2: 'No tienes permisos para modificar este laboratorista o su facultad.',
          limit: null,
        });
      }
    }

    const ualsRes = await client.query(
      'SELECT id_ual FROM ual WHERE id_facultad = $1 AND id_ual = ANY($2::int[])',
      [selectedFacultyId, selectedUalIds]
    );

    if (ualsRes.rows.length !== selectedUalIds.length) {
      client.release();
      return res.render('home/message_error', {
        message: 'Selección inválida de laboratorios',
        message2: 'Todos los laboratorios deben pertenecer a la facultad seleccionada.',
        limit: null,
      });
    }

    const conflict = await findEmailConflict(client, correo, laboratorista.documento);

    if (conflict) {
      client.release();
      return res.render('home/message_error', {
        message: 'Correo en conflicto',
        message2: 'Ese correo ya está asociado a otra cuenta.',
        limit: null,
      });
    }

    const primaryUalId = selectedUalIds[0];

    await client.query('BEGIN');
    await client.query(
      `
        UPDATE laboratorista
        SET nombre = $1,
            correo = $2,
            id_facultad = $3,
            id_ual = $4,
            contrato = $5
        WHERE documento = $6
      `,
      [nombre, correo, selectedFacultyId, primaryUalId, contrato, documento]
    );
    if (laboratorista.usuario_id) {
      await client.query(
        `UPDATE usuario
         SET correo = $1,
           nombre = $2,
           fecha_modificacion = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [correo, nombre, laboratorista.usuario_id]
      );
    } else {
      await client.query(
        `UPDATE usuario
         SET correo = $1,
           nombre = $2,
           fecha_modificacion = CURRENT_TIMESTAMP
         WHERE documento = $3`,
        [correo, nombre, documento]
      );
    }
    await client.query('DELETE FROM laboratorista_ual WHERE documento = $1', [documento]);
    await client.query(
      'INSERT INTO laboratorista_ual (documento, id_ual) SELECT $1, UNNEST($2::int[])',
      [documento, selectedUalIds]
    );

    const actorDocument = await resolveActorDocumentForLogs(req, client);
    await client.query(
      'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
      [
        req.session.user.tipo,
        normalizeLogDocument(actorDocument),
        'Editar laboratorista y asignar laboratorios',
        documento,
      ]
    );

    await client.query('COMMIT');
    client.release();

    return res.redirect('/milab/api/laboratoristas_registrados?updated=1');
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error al revertir edición de laboratorista:', rollbackError);
      }
      client.release();
    }

    console.error('Error al editar laboratorista:', error);
    return res.render('home/message_error', {
      message: 'Error al actualizar laboratorista',
      message2: 'Por favor intenta nuevamente.',
      limit: null,
    });
  }
});

router.post('/actualizar-correo', requireAdminOrCoordinadorLabEmailEdit, async (req, res) => {
  const documento = String(req.body.documento || '').trim();
  const correo = normalizeInstitutionalEmail(req.body.correo);

  if (!documento) {
    return res.status(400).json({
      ok: false,
      message: 'Debes indicar el documento del laboratorista.',
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

    const laboratoristaResult = await client.query(
      'SELECT documento, nombre, correo, n_usuario, id_facultad, usuario_id FROM laboratorista WHERE documento = $1',
      [documento]
    );

    if (laboratoristaResult.rows.length === 0) {
      client.release();
      return res.status(404).json({
        ok: false,
        message: 'No encontramos el laboratorista seleccionado.',
      });
    }

    const laboratorista = laboratoristaResult.rows[0];

    if (req.session.user.tipo === 'coordinador') {
      const facultadesPermitidas = await resolveCoordinatorFacultyIds(
        client,
        req.session.user.documento
      );

      if (
        facultadesPermitidas.length === 0 ||
        !facultadesPermitidas.includes(laboratorista.id_facultad)
      ) {
        client.release();
        return res.status(403).json({
          ok: false,
          message: 'No tienes permisos para editar el correo de este laboratorista.',
        });
      }
    }

    const conflict = await findEmailConflict(client, correo, laboratorista.documento);

    if (conflict) {
      client.release();
      return res.status(409).json({
        ok: false,
        message: 'Ese correo ya existe vinculado a otra cuenta.',
      });
    }

    await client.query('BEGIN');
    await client.query('UPDATE laboratorista SET correo = $1 WHERE documento = $2', [
      correo,
      documento,
    ]);
    if (laboratorista.usuario_id) {
      await client.query(
        `UPDATE usuario
         SET correo = $1,
           fecha_modificacion = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [correo, laboratorista.usuario_id]
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

    const actorDocument = await resolveActorDocumentForLogs(req, client);

    await client.query(
      'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
      [
        req.session.user.tipo,
        normalizeLogDocument(actorDocument),
        'Actualizar correo laboratorista',
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
        console.error('Error al revertir actualización de correo de laboratorista:', rollbackError);
      }
      client.release();
    }

    console.error('Error al actualizar correo de laboratorista:', error);

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

// Nueva ruta para manejar la eliminación
router.post('/eliminar', requireAdminOrCoordinadorLabAction, async (req, res) => {
  const { documento } = req.body;

  if (!documento) {
    return res.render('home/message_error', {
      message: '¡Error en los datos!',
      message2: 'Documento no válido',
      limit: null,
    });
  }

  try {
    const checkQuery =
      'SELECT documento, n_usuario, correo, usuario_id FROM laboratorista WHERE documento = $1';
    const checkResult = await pool.query(checkQuery, [documento]);

    if (checkResult.rows.length === 0) {
      return res.render('home/message_error', {
        message: '¡Laboratorista no encontrado!',
        message2: 'El laboratorista ya no existe en la base de datos',
        limit: null,
      });
    }

    const laboratorista = checkResult.rows[0];
    const userIdResult = await pool.query(
      `SELECT id
       FROM usuario
       WHERE id = $1
          OR documento = $2
          OR documento = $3
          OR (correo IS NOT NULL AND LOWER(correo) = LOWER($4))
       LIMIT 1`,
      [laboratorista.usuario_id || 0, documento, laboratorista.n_usuario, laboratorista.correo]
    );
    const userId = userIdResult.rows[0]?.id || null;

    await pool.query('BEGIN');

    try {
      await pool.query('DELETE FROM laboratorista WHERE documento = $1', [documento]);
      if (userId) {
        await pool.query(
          `UPDATE usuario_rol ur
           SET activo = FALSE,
               fecha_modificacion = CURRENT_TIMESTAMP
           FROM rol r
           WHERE ur.usuario_id = $1
             AND ur.rol_id = r.id
             AND r.nombre = 'laboratorista'`,
          [userId]
        );
      }

      let documentoReal = req.session.user.documento;

      if (req.session.user.tipo === 'coordinador') {
        const result = await pool.query('SELECT documento FROM coordinador WHERE nombre_u = $1', [
          req.session.user.documento,
        ]);
        if (result.rows.length > 0) {
          documentoReal = result.rows[0].documento;
        }
      }

      await pool.query(
        'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
        [req.session.user.tipo, documentoReal, 'Eliminar laboratorista', documento]
      );

      await pool.query('COMMIT');

      res.redirect('/milab/api/laboratoristas_registrados');
    } catch (transactionError) {
      await pool.query('ROLLBACK');
      throw transactionError;
    }
  } catch (error) {
    console.error('Error al eliminar laboratorista:', error);
    res.render('home/message_error', {
      message: '¡Error al eliminar laboratorista!',
      message2: 'Inténtalo nuevamente',
      limit: null,
    });
  }
});

module.exports = router;
