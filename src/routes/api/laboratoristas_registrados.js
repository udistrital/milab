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

function normalizeCoordinatorDocument(value) {
  return String(value || '').trim();
}

async function resolveCoordinatorScopeByDocument(client, coordinatorDocument) {
  const normalizedDocument = normalizeCoordinatorDocument(coordinatorDocument);

  if (!normalizedDocument) {
    return {
      coordinatorDocument: null,
      facultyIds: [],
    };
  }

  const coordinatorRes = await client.query(
    'SELECT documento FROM coordinador WHERE documento = $1 LIMIT 1',
    [normalizedDocument]
  );

  if (coordinatorRes.rows.length === 0) {
    return {
      coordinatorDocument: null,
      facultyIds: [],
    };
  }

  const facultiesRes = await client.query(
    'SELECT facultad_id FROM coordinador_facultad WHERE coordinador_documento_id = $1',
    [normalizedDocument]
  );

  return {
    coordinatorDocument: normalizedDocument,
    facultyIds: [
      ...new Set(
        facultiesRes.rows
          .map((row) => Number(row.facultad_id))
          .filter((value) => Number.isInteger(value))
      ),
    ],
  };
}

async function fetchCoordinatorOptions(client) {
  const result = await client.query(
    `SELECT c.documento,
            c.nombre,
            COALESCE(STRING_AGG(DISTINCT f.nombre, ', ' ORDER BY f.nombre), '') AS facultades
     FROM coordinador c
     LEFT JOIN coordinador_facultad cf ON cf.coordinador_documento_id = c.documento
     LEFT JOIN facultad f ON f.facultad_id = cf.facultad_id
     GROUP BY c.documento, c.nombre
     ORDER BY c.nombre ASC`
  );

  return result.rows;
}

async function resolveLaboratoristaUserId(client, laboratorista) {
  if (laboratorista?.usuario_id) {
    return laboratorista.usuario_id;
  }

  const result = await client.query(
    `SELECT id
     FROM usuario
     WHERE documento = $1
        OR documento = $2
        OR (correo IS NOT NULL AND LOWER(correo) = LOWER($3))
     LIMIT 1`,
    [laboratorista?.documento || '', laboratorista?.n_usuario || '', laboratorista?.correo || '']
  );

  return result.rows[0]?.id || null;
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
  const coordInfoRes = await client.query('SELECT documento FROM coordinador WHERE nombre_u = $1', [
    authDocument,
  ]);

  if (coordInfoRes.rows.length === 0) {
    return [];
  }

  const coordDocumento = coordInfoRes.rows[0].documento;
  const facultadesRes = await client.query(
    'SELECT facultad_id FROM coordinador_facultad WHERE coordinador_documento_id = $1',
    [coordDocumento]
  );

  return facultadesRes.rows.map((row) => row.facultad_id);
}

async function resolveLaboratoristaFacultyIds(client, laboratoristaDocumento) {
  const result = await client.query(
    `SELECT DISTINCT u.facultad_id
     FROM laboratorista_ual lu
     JOIN ual u ON u.ual_id = lu.ual_id
     WHERE lu.laboratorista_documento_id = $1`,
    [laboratoristaDocumento]
  );

  return result.rows.map((row) => Number(row.facultad_id)).filter(Boolean);
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
        l.activo AS activo,
        COALESCE(STRING_AGG(DISTINCT u_rel.nombre, ', ' ORDER BY u_rel.nombre), '') AS con_ual,
        COALESCE(STRING_AGG(DISTINCT f.nombre, ', ' ORDER BY f.nombre), '') AS con_facultad
      FROM laboratorista l
      LEFT JOIN laboratorista_ual lu ON lu.laboratorista_documento_id = l.documento
      LEFT JOIN ual u_rel ON u_rel.ual_id = lu.ual_id
      LEFT JOIN facultad f ON f.facultad_id = u_rel.facultad_id
    `;

    if (req.session.user.tipo === 'admin') {
      const result = await pool.query(
        `${baseQuery}
         GROUP BY l.nombre, l.documento, l.correo, l.activo
         ORDER BY l.nombre ASC`
      );
      laboratoristas = result.rows;
    } else if (req.session.user.tipo === 'coordinador') {
      const coordInfoRes = await pool.query(
        `SELECT documento FROM coordinador WHERE nombre_u = $1`,
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
      const cfRes = await pool.query(
        `SELECT facultad_id FROM coordinador_facultad WHERE coordinador_documento_id = $1`,
        [coordDocumento]
      );

      const facultadesCoord = cfRes.rows.map((r) => r.facultad_id);

      if (facultadesCoord.length === 0) {
        return res.render('home/message_error', {
          message: '¡Error!',
          message2: 'El coordinador no tiene facultades asociadas',
          limit: null,
        });
      }

      const result = await pool.query(
        `${baseQuery}
         WHERE EXISTS (
           SELECT 1
           FROM laboratorista_ual lu_scope
           JOIN ual u_scope ON u_scope.ual_id = lu_scope.ual_id
           WHERE lu_scope.laboratorista_documento_id = l.documento
             AND u_scope.facultad_id = ANY($1::int[])
         )
         GROUP BY l.nombre, l.documento, l.correo, l.activo
         ORDER BY l.nombre ASC`,
        [facultadesCoord]
      );
      laboratoristas = result.rows;
    }

    res.render('home/laboratoristas_registrados', {
      laboratoristas,
      successMessage:
        req.query.updated === '1'
          ? 'El laboratorista se actualizó correctamente.'
          : req.query.toggled === '1'
            ? 'El estado del laboratorista se actualizó correctamente.'
            : null,
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
  const requestedCoordinatorDocument = normalizeCoordinatorDocument(
    req.query.coordinador_documento
  );

  if (!documento) {
    return res.render('home/message_error', {
      message: '¡Error en los datos!',
      message2: 'Documento no válido',
      limit: null,
    });
  }

  try {
    const isAdmin = req.session.user.tipo === 'admin';
    const coordinatorOptions = isAdmin ? await fetchCoordinatorOptions(pool) : [];
    const coordinatorScope = isAdmin
      ? await resolveCoordinatorScopeByDocument(pool, requestedCoordinatorDocument)
      : null;

    const laboratoristaRes = await pool.query(
      `
        SELECT documento, nombre, correo, n_usuario, contrato
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
    const laboratoristaFacultyIds = await resolveLaboratoristaFacultyIds(pool, documento);
    const selectedFacultyId = laboratoristaFacultyIds[0] || null;
    let facultadesPermitidas = null;

    if (req.session.user.tipo === 'coordinador') {
      facultadesPermitidas = await resolveCoordinatorFacultyIds(pool, req.session.user.documento);
      const isWithinCoordinatorScope = laboratoristaFacultyIds.some((facultyId) =>
        facultadesPermitidas.includes(facultyId)
      );

      if (facultadesPermitidas.length === 0 || !isWithinCoordinatorScope) {
        return res.render('home/message_error', {
          message: '¡Acceso denegado!',
          message2: 'No tienes permisos para editar este laboratorista.',
          limit: null,
        });
      }
    }

    let facultadesRes;
    if (req.session.user.tipo === 'coordinador') {
      facultadesRes = await pool.query(
        'SELECT facultad_id, nombre FROM facultad WHERE facultad_id = ANY($1::int[]) ORDER BY nombre ASC',
        [facultadesPermitidas]
      );
    } else if (coordinatorScope?.coordinatorDocument && coordinatorScope.facultyIds.length) {
      facultadesRes = await pool.query(
        'SELECT facultad_id, nombre FROM facultad WHERE facultad_id = ANY($1::int[]) ORDER BY nombre ASC',
        [coordinatorScope.facultyIds]
      );
    } else {
      facultadesRes = await pool.query(
        'SELECT facultad_id, nombre FROM facultad ORDER BY nombre ASC'
      );
    }

    let ualsRes;
    if (req.session.user.tipo === 'coordinador') {
      ualsRes = await pool.query(
        'SELECT ual_id, nombre, codigo_abreviacion, descripcion, sal_id_espacio, sal_ocupantes, facultad_id, activo FROM ual WHERE activo = TRUE AND facultad_id = ANY($1::int[]) ORDER BY nombre ASC',
        [facultadesPermitidas]
      );
    } else if (coordinatorScope?.coordinatorDocument && coordinatorScope.facultyIds.length) {
      ualsRes = await pool.query(
        'SELECT ual_id, nombre, codigo_abreviacion, descripcion, sal_id_espacio, sal_ocupantes, facultad_id, activo FROM ual WHERE activo = TRUE AND facultad_id = ANY($1::int[]) ORDER BY nombre ASC',
        [coordinatorScope.facultyIds]
      );
    } else {
      ualsRes = await pool.query(
        'SELECT ual_id, nombre, codigo_abreviacion, descripcion, sal_id_espacio, sal_ocupantes, facultad_id, activo FROM ual WHERE activo = TRUE ORDER BY nombre ASC'
      );
    }

    const assignedUalsRes = await pool.query(
      'SELECT ual_id FROM laboratorista_ual WHERE laboratorista_documento_id = $1 ORDER BY ual_id ASC',
      [documento]
    );
    const assignedUalIds = assignedUalsRes.rows.map((row) => Number(row.ual_id));

    return res.render('home/editar_laboratorista', {
      tipo: req.session.user.tipo,
      laboratorista: {
        ...laboratorista,
        facultad_id: selectedFacultyId,
      },
      facultades: facultadesRes.rows,
      uals: ualsRes.rows,
      assignedUalIds,
      coordinadores: coordinatorOptions,
      selectedCoordinatorDocument: coordinatorScope?.coordinatorDocument || '',
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
  const selectedUalIds = normalizeSelectedUalIds(req.body.ual_ids);
  const requestedCoordinatorDocument = normalizeCoordinatorDocument(req.body.coordinador_documento);

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

    if (req.session.user.tipo === 'admin' && requestedCoordinatorDocument) {
      const scope = await resolveCoordinatorScopeByDocument(client, requestedCoordinatorDocument);
      if (!scope.coordinatorDocument || scope.facultyIds.length === 0) {
        client.release();
        return res.render('home/message_error', {
          message: 'Selección inválida de coordinador',
          message2: 'Selecciona un coordinador válido con facultades asociadas.',
          limit: null,
        });
      }

      if (!scope.facultyIds.includes(selectedFacultyId)) {
        client.release();
        return res.render('home/message_error', {
          message: 'Selección inválida de facultad',
          message2: 'La facultad seleccionada no pertenece al coordinador indicado.',
          limit: null,
        });
      }
    }

    const laboratoristaRes = await client.query(
      'SELECT documento, n_usuario, usuario_id FROM laboratorista WHERE documento = $1',
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
    const laboratoristaFacultyIds = await resolveLaboratoristaFacultyIds(client, documento);

    if (req.session.user.tipo === 'coordinador') {
      const facultadesPermitidas = await resolveCoordinatorFacultyIds(
        client,
        req.session.user.documento
      );
      const isWithinCoordinatorScope = laboratoristaFacultyIds.some((facultyId) =>
        facultadesPermitidas.includes(facultyId)
      );

      if (
        facultadesPermitidas.length === 0 ||
        !isWithinCoordinatorScope ||
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
      'SELECT ual_id FROM ual WHERE activo = TRUE AND facultad_id = $1 AND ual_id = ANY($2::int[])',
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

    await client.query('BEGIN');
    await client.query(
      `
        UPDATE laboratorista
        SET nombre = $1,
            correo = $2,
            contrato = $3
        WHERE documento = $4
      `,
      [nombre, correo, contrato, documento]
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
    await client.query('DELETE FROM laboratorista_ual WHERE laboratorista_documento_id = $1', [
      documento,
    ]);
    await client.query(
      'INSERT INTO laboratorista_ual (laboratorista_documento_id, ual_id) SELECT $1, UNNEST($2::int[])',
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
      'SELECT documento, nombre, correo, n_usuario, usuario_id FROM laboratorista WHERE documento = $1',
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
    const laboratoristaFacultyIds = await resolveLaboratoristaFacultyIds(client, documento);

    if (req.session.user.tipo === 'coordinador') {
      const facultadesPermitidas = await resolveCoordinatorFacultyIds(
        client,
        req.session.user.documento
      );
      const isWithinCoordinatorScope = laboratoristaFacultyIds.some((facultyId) =>
        facultadesPermitidas.includes(facultyId)
      );

      if (facultadesPermitidas.length === 0 || !isWithinCoordinatorScope) {
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

router.post('/toggle-estado', requireAdminOrCoordinadorLabAction, async (req, res) => {
  const { documento } = req.body;

  let client;
  if (!documento) {
    return res.render('home/message_error', {
      message: '¡Error en los datos!',
      message2: 'Documento no válido',
      limit: null,
    });
  }

  try {
    client = await pool.connect();
    const checkQuery =
      'SELECT documento, n_usuario, correo, usuario_id, activo FROM laboratorista WHERE documento = $1';
    const checkResult = await client.query(checkQuery, [documento]);

    if (checkResult.rows.length === 0) {
      client.release();
      return res.render('home/message_error', {
        message: '¡Laboratorista no encontrado!',
        message2: 'El laboratorista ya no existe en la base de datos',
        limit: null,
      });
    }

    const laboratorista = checkResult.rows[0];
    const laboratoristaFacultyIds = await resolveLaboratoristaFacultyIds(client, documento);

    if (req.session.user.tipo === 'coordinador') {
      const facultadesPermitidas = await resolveCoordinatorFacultyIds(
        client,
        req.session.user.documento
      );
      const isWithinCoordinatorScope = laboratoristaFacultyIds.some((facultyId) =>
        facultadesPermitidas.includes(facultyId)
      );

      if (facultadesPermitidas.length === 0 || !isWithinCoordinatorScope) {
        client.release();
        return res.render('home/message_error', {
          message: '¡Acceso denegado!',
          message2: 'No tienes permisos para cambiar el estado de este laboratorista.',
          limit: null,
        });
      }
    }

    const userId = await resolveLaboratoristaUserId(client, laboratorista);
    const nuevoEstado = !laboratorista.activo;

    await client.query('BEGIN');

    try {
      await client.query(
        `UPDATE laboratorista
         SET activo = $2,
             fecha_modificacion = CURRENT_TIMESTAMP
         WHERE documento = $1`,
        [documento, nuevoEstado]
      );

      if (userId) {
        await client.query(
          `UPDATE usuario_rol ur
           SET activo = $2,
               fecha_modificacion = CURRENT_TIMESTAMP
           FROM rol r
           WHERE ur.usuario_id = $1
             AND ur.rol_id = r.id
             AND r.nombre = 'laboratorista'`,
          [userId, nuevoEstado]
        );
      }

      let documentoReal = req.session.user.documento;

      if (req.session.user.tipo === 'coordinador') {
        const result = await client.query('SELECT documento FROM coordinador WHERE nombre_u = $1', [
          req.session.user.documento,
        ]);
        if (result.rows.length > 0) {
          documentoReal = result.rows[0].documento;
        }
      }

      await client.query(
        'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
        [
          req.session.user.tipo,
          documentoReal,
          `Cambiar estado laboratorista a ${nuevoEstado ? 'activo' : 'inactivo'}`,
          documento,
        ]
      );

      await client.query('COMMIT');
      client.release();
      client = null;

      res.redirect('/milab/api/laboratoristas_registrados?toggled=1');
    } catch (transactionError) {
      await client.query('ROLLBACK');
      throw transactionError;
    }
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error al revertir cambio de estado de laboratorista:', rollbackError);
      }
      client.release();
    }
    console.error('Error al cambiar estado del laboratorista:', error);
    res.render('home/message_error', {
      message: '¡Error al cambiar estado del laboratorista!',
      message2: 'Inténtalo nuevamente',
      limit: null,
    });
  }
});

module.exports = router;
