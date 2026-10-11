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
const { coordinatorScopeAllowsUal, resolveCoordinatorScope } = require('../../libs/faculty-scope');

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
      scopeType: null,
      facultyIds: [],
      ualIds: [],
    };
  }

  return resolveCoordinatorScope(client, normalizedDocument);
}

async function fetchCoordinatorOptions(client) {
  const result = await client.query(
    `SELECT c.documento,
            c.nombre,
            COALESCE(STRING_AGG(DISTINCT f.nombre, ', ' ORDER BY f.nombre), '') AS facultades
     FROM coordinador c
     LEFT JOIN coordinador_facultad cf ON cf.coordinador_documento_id = c.documento
     LEFT JOIN dependencia_facultad f ON f.dependencia_facultad_id = cf.facultad_id
     GROUP BY c.documento, c.nombre
     ORDER BY c.nombre ASC`
  );

  return result.rows;
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

async function resolveLaboratoristaUalAssignments(client, laboratoristaDocumento) {
  const result = await client.query(
    `SELECT DISTINCT lu.ual_id, u.facultad_id
     FROM laboratorista_ual lu
     JOIN ual u ON u.ual_id = lu.ual_id
     WHERE lu.laboratorista_documento_id = $1`,
    [laboratoristaDocumento]
  );

  return result.rows.map((row) => ({
    ualId: Number(row.ual_id),
    facultyId: Number(row.facultad_id),
  }));
}

function laboratoristaAssignmentsWithinCoordinatorScope(assignments, scope) {
  if (!scope?.coordinatorDocument || !scope.facultyIds.length) {
    return false;
  }

  return assignments.some(({ ualId, facultyId }) =>
    scope.scopeType === 'uales'
      ? coordinatorScopeAllowsUal(scope, ualId, facultyId)
      : scope.facultyIds.includes(facultyId)
  );
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
        COALESCE(
          STRING_AGG(
            DISTINCT COALESCE(facultad_padre.nombre, f.nombre),
            ', ' ORDER BY COALESCE(facultad_padre.nombre, f.nombre)
          ),
          ''
        ) AS con_facultad,
        COALESCE(
          STRING_AGG(DISTINCT f.nombre, ', ' ORDER BY f.nombre)
            FILTER (WHERE f.padre_id IS NOT NULL),
          ''
        ) AS con_dependencia,
        COALESCE(STRING_AGG(DISTINCT u_rel.nombre, ', ' ORDER BY u_rel.nombre), '') AS con_ual
      FROM laboratorista l
      LEFT JOIN laboratorista_ual lu ON lu.laboratorista_documento_id = l.documento
      LEFT JOIN ual u_rel ON u_rel.ual_id = lu.ual_id
      LEFT JOIN dependencia_facultad f ON f.dependencia_facultad_id = u_rel.facultad_id
      LEFT JOIN dependencia_facultad facultad_padre ON facultad_padre.dependencia_facultad_id = f.padre_id
    `;

    if (req.session.user.tipo === 'admin') {
      const result = await pool.query(
        `${baseQuery}
        GROUP BY l.nombre, l.documento, l.correo, l.activo
         ORDER BY l.nombre ASC`
      );
      laboratoristas = result.rows;
    } else if (req.session.user.tipo === 'coordinador') {
      const scope = await resolveCoordinatorScope(pool, req.session.user.documento);
      if (!scope.coordinatorDocument || scope.facultyIds.length === 0) {
        return res.render('home/message_error', {
          message: '¡Error!',
          message2: 'No se encontró información del coordinador',
          limit: null,
        });
      }

      const scopeIds = scope.scopeType === 'uales' ? scope.ualIds : scope.facultyIds;
      const scopeColumn = scope.scopeType === 'uales' ? 'u_scope.ual_id' : 'u_scope.facultad_id';
      const visibleUalCondition =
        scope.scopeType === 'uales'
          ? 'AND u_rel.ual_id = ANY($1::int[])'
          : 'AND u_rel.facultad_id = ANY($1::int[])';
      const scopedBaseQuery = baseQuery.replace(
        'LEFT JOIN ual u_rel ON u_rel.ual_id = lu.ual_id',
        `LEFT JOIN ual u_rel ON u_rel.ual_id = lu.ual_id ${visibleUalCondition}`
      );

      const result = await pool.query(
        `${scopedBaseQuery}
         WHERE EXISTS (
           SELECT 1
           FROM laboratorista_ual lu_scope
           JOIN ual u_scope ON u_scope.ual_id = lu_scope.ual_id
           WHERE lu_scope.laboratorista_documento_id = l.documento
             AND ${scopeColumn} = ANY($1::int[])
         )
         GROUP BY l.nombre, l.documento, l.correo, l.activo
         ORDER BY l.nombre ASC`,
        [scopeIds]
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
    const requestedCoordinatorScope = isAdmin
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
    const laboratoristaAssignments = await resolveLaboratoristaUalAssignments(pool, documento);
    const laboratoristaFacultyIds = [
      ...new Set(laboratoristaAssignments.map((assignment) => assignment.facultyId)),
    ];
    let selectedFacultyId = laboratoristaFacultyIds[0] || null;
    let facultadesPermitidas = null;
    let coordinatorUserScope = null;

    if (req.session.user.tipo === 'coordinador') {
      coordinatorUserScope = await resolveCoordinatorScope(pool, req.session.user.documento);
      facultadesPermitidas = coordinatorUserScope.facultyIds;
      const isWithinCoordinatorScope = laboratoristaAssignmentsWithinCoordinatorScope(
        laboratoristaAssignments,
        coordinatorUserScope
      );

      if (!isWithinCoordinatorScope) {
        return res.render('home/message_error', {
          message: '¡Acceso denegado!',
          message2: 'No tienes permisos para editar este laboratorista.',
          limit: null,
        });
      }

      const visibleAssignment = laboratoristaAssignments.find((assignment) =>
        coordinatorUserScope.scopeType === 'uales'
          ? coordinatorScopeAllowsUal(coordinatorUserScope, assignment.ualId, assignment.facultyId)
          : facultadesPermitidas.includes(assignment.facultyId)
      );
      selectedFacultyId = visibleAssignment?.facultyId || facultadesPermitidas[0] || null;
    }

    let facultadesRes;
    if (req.session.user.tipo === 'coordinador') {
      facultadesRes = await pool.query(
        'SELECT dependencia_facultad_id AS facultad_id, nombre FROM dependencia_facultad WHERE dependencia_facultad_id = ANY($1::int[]) ORDER BY nombre ASC',
        [facultadesPermitidas]
      );
    } else if (
      requestedCoordinatorScope?.coordinatorDocument &&
      requestedCoordinatorScope.facultyIds.length
    ) {
      facultadesRes = await pool.query(
        'SELECT dependencia_facultad_id AS facultad_id, nombre FROM dependencia_facultad WHERE dependencia_facultad_id = ANY($1::int[]) ORDER BY nombre ASC',
        [requestedCoordinatorScope.facultyIds]
      );
    } else {
      facultadesRes = await pool.query(
        'SELECT dependencia_facultad_id AS facultad_id, nombre FROM dependencia_facultad ORDER BY nombre ASC'
      );
    }

    let ualsRes;
    if (req.session.user.tipo === 'coordinador' && coordinatorUserScope.scopeType === 'uales') {
      ualsRes = await pool.query(
        'SELECT ual_id, nombre, codigo_abreviacion, descripcion, sal_id_espacio, sal_ocupantes, facultad_id, activo FROM ual WHERE activo = TRUE AND facultad_id = ANY($1::int[]) AND ual_id = ANY($2::int[]) ORDER BY nombre ASC',
        [facultadesPermitidas, coordinatorUserScope.ualIds]
      );
    } else if (req.session.user.tipo === 'coordinador') {
      ualsRes = await pool.query(
        'SELECT ual_id, nombre, codigo_abreviacion, descripcion, sal_id_espacio, sal_ocupantes, facultad_id, activo FROM ual WHERE activo = TRUE AND facultad_id = ANY($1::int[]) ORDER BY nombre ASC',
        [facultadesPermitidas]
      );
    } else if (
      requestedCoordinatorScope?.coordinatorDocument &&
      requestedCoordinatorScope.facultyIds.length
    ) {
      ualsRes = await pool.query(
        'SELECT ual_id, nombre, codigo_abreviacion, descripcion, sal_id_espacio, sal_ocupantes, facultad_id, activo FROM ual WHERE activo = TRUE AND facultad_id = ANY($1::int[]) ORDER BY nombre ASC',
        [requestedCoordinatorScope.facultyIds]
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
      selectedCoordinatorDocument: requestedCoordinatorScope?.coordinatorDocument || '',
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

    let selectedCoordinatorScope = null;
    if (req.session.user.tipo === 'admin' && requestedCoordinatorDocument) {
      const scope = await resolveCoordinatorScopeByDocument(client, requestedCoordinatorDocument);
      selectedCoordinatorScope = scope;
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
    const assignedUalAssignments = await resolveLaboratoristaUalAssignments(client, documento);

    if (req.session.user.tipo === 'coordinador') {
      selectedCoordinatorScope = await resolveCoordinatorScope(client, req.session.user.documento);
      const isWithinCoordinatorScope = laboratoristaAssignmentsWithinCoordinatorScope(
        assignedUalAssignments,
        selectedCoordinatorScope
      );

      if (
        selectedCoordinatorScope.facultyIds.length === 0 ||
        !isWithinCoordinatorScope ||
        (selectedCoordinatorScope.scopeType !== 'uales' &&
          !selectedCoordinatorScope.facultyIds.includes(selectedFacultyId)) ||
        (selectedCoordinatorScope.scopeType === 'uales' &&
          selectedUalIds.some(
            (ualId) => !coordinatorScopeAllowsUal(selectedCoordinatorScope, ualId)
          ))
      ) {
        client.release();
        return res.render('home/message_error', {
          message: '¡Acceso denegado!',
          message2: 'No tienes permisos para modificar este laboratorista o su facultad.',
          limit: null,
        });
      }
    }

    if (
      req.session.user.tipo === 'admin' &&
      selectedCoordinatorScope?.scopeType === 'uales' &&
      selectedUalIds.some((ualId) => !coordinatorScopeAllowsUal(selectedCoordinatorScope, ualId))
    ) {
      client.release();
      return res.render('home/message_error', {
        message: 'Selección inválida de UALs',
        message2:
          'Una o más UALs seleccionadas están fuera del alcance del coordinador responsable.',
        limit: null,
      });
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

    const retainedUalIds =
      req.session.user.tipo === 'coordinador'
        ? assignedUalAssignments
            .filter(
              ({ ualId, facultyId }) =>
                facultyId !== selectedFacultyId ||
                (selectedCoordinatorScope.scopeType === 'uales' &&
                  !coordinatorScopeAllowsUal(selectedCoordinatorScope, ualId, facultyId))
            )
            .map((assignment) => assignment.ualId)
        : [];
    const ualIdsToPersist = [...new Set([...selectedUalIds, ...retainedUalIds])];

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
      [documento, ualIdsToPersist]
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
    if (req.session.user.tipo === 'coordinador') {
      const coordinatorScope = await resolveCoordinatorScope(client, req.session.user.documento);
      const assignments = await resolveLaboratoristaUalAssignments(client, documento);
      const isWithinCoordinatorScope = laboratoristaAssignmentsWithinCoordinatorScope(
        assignments,
        coordinatorScope
      );

      if (!isWithinCoordinatorScope) {
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
  const documento = String(req.body.documento || '').trim();

  if (!documento) {
    return res.render('home/message_error', {
      message: '¡Error en los datos!',
      message2: 'Documento no válido',
      limit: null,
    });
  }

  let client;

  try {
    client = await pool.connect();

    const laboratoristaRes = await client.query(
      'SELECT documento, n_usuario, correo, usuario_id, activo FROM laboratorista WHERE documento = $1',
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

    if (req.session.user.tipo === 'coordinador') {
      const coordinatorScope = await resolveCoordinatorScope(client, req.session.user.documento);
      const assignments = await resolveLaboratoristaUalAssignments(client, documento);
      const isWithinCoordinatorScope = laboratoristaAssignmentsWithinCoordinatorScope(
        assignments,
        coordinatorScope
      );

      if (!isWithinCoordinatorScope) {
        client.release();
        return res.render('home/message_error', {
          message: '¡Acceso denegado!',
          message2: 'No tienes permisos para modificar este laboratorista.',
          limit: null,
        });
      }
    }

    const laboratorista = laboratoristaRes.rows[0];
    const userIdResult = await client.query(
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

    if (!userId) {
      client.release();
      return res.render('home/message_error', {
        message: 'No se encontró usuario asociado al laboratorista.',
        message2: 'Verifique los datos del laboratorista.',
        limit: null,
      });
    }

    const nuevoEstado = !laboratorista.activo;

    await client.query('BEGIN');

    await client.query(
      `INSERT INTO usuario_rol (usuario_id, rol_id, activo)
       SELECT $1, id, $2 FROM rol WHERE nombre = 'laboratorista'
       ON CONFLICT (usuario_id, rol_id) DO UPDATE
       SET activo = EXCLUDED.activo,
           fecha_modificacion = CURRENT_TIMESTAMP`,
      [userId, nuevoEstado]
    );

    await client.query(
      `UPDATE laboratorista
       SET activo = $2,
           fecha_modificacion = CURRENT_TIMESTAMP
       WHERE documento = $1`,
      [documento, nuevoEstado]
    );

    const actorDocument = await resolveActorDocumentForLogs(req, client);

    await client.query(
      'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
      [
        req.session.user.tipo,
        normalizeLogDocument(actorDocument),
        `cambiar estado laboratorista a ${nuevoEstado ? 'activo' : 'inactivo'}`,
        documento,
      ]
    );

    await client.query('COMMIT');
    client.release();

    return res.redirect('/milab/api/laboratoristas_registrados');
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error al revertir cambio de estado de laboratorista:', rollbackError);
      }
      client.release();
    }

    console.error('Error al cambiar estado de laboratorista:', error);
    return res.render('home/message_error', {
      message: '¡Error al cambiar estado!',
      message2: 'Inténtalo nuevamente',
      limit: null,
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
