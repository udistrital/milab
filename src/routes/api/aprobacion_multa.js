const express = require('express');
const pool = require('../../libs/db');
const { resolveCoordinatorScope } = require('../../libs/faculty-scope');
const { requireRoles } = require('../middlewares/auth');
const {
  SANCTION_TYPES,
  normalizeSanctionType,
  isValidSanctionType,
  fetchMultaConfigsForFacultyIds,
  upsertConfigForFacultyId,
  logConfigChangeToAuditoria,
} = require('../../libs/multa-config');
const { wantsJson } = require('../middlewares/error-handler');
const {
  resolveStudentContactByUsuarioId,
  sendSanctionActivationEmail,
} = require('../../libs/sanction-email');

const router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: true }));

const requireCoordinadorApprovalAccess = requireRoles('coordinador', {
  message: '¡Algo ha salido mal!',
  message2: 'No tienes permisos para acceder a esta vista.',
  limit: 'noSession',
});

const requireCoordinadorApprovalAction = requireRoles('coordinador', {
  message: 'No autorizado',
  message2: 'Tu sesión no tiene permisos suficientes.',
  limit: 'noSession',
});

const requireApprovalAction = requireRoles(['coordinador', 'laboratorista'], {
  message: 'No autorizado',
  message2: 'Tu sesión no tiene permisos suficientes.',
  limit: 'noSession',
});

function getSessionDocument(req) {
  return req.session?.user?.documento_real || req.session?.user?.documento || null;
}

function getSessionRole(req) {
  return String(req.session?.user?.tipo || '').toLowerCase();
}

function resolvePostActionRedirectPath(req) {
  const source = String(req.body?.source || '')
    .trim()
    .toLowerCase();

  if (
    source === 'estudiante' ||
    source === 'gestion_estudiante' ||
    source === 'gestion-estudiante' ||
    source === 'get-info-multa'
  ) {
    return '/milab/api/get-info-multa/get';
  }

  if (
    source === 'docente' ||
    source === 'gestion_docente' ||
    source === 'gestion-docente' ||
    source === 'get-info-multa-docente'
  ) {
    return '/milab/api/get-info-multa-docente/get';
  }

  const role = getSessionRole(req);
  if (role === 'laboratorista') {
    return '/milab/api/get_list_multas';
  }

  if (source === 'listado') {
    return '/milab/api/get_list_multas';
  }

  return '/milab/api/aprobacion_multa';
}

function resolvePostActionFeedbackValue(payload = {}) {
  if (typeof payload.feedback === 'string' && payload.feedback.trim()) {
    return payload.feedback.trim().toLowerCase();
  }

  const state = String(payload.nuevo_estado || '').toUpperCase();
  if (state === 'ACTIVA') {
    return 'activada';
  }
  if (state === 'SALDADA') {
    return 'saldada';
  }
  if (state === 'APLAZADA') {
    return 'aplazada';
  }
  return null;
}

function buildSuccessRedirectPath(req, redirectTo, payload = {}) {
  if (redirectTo !== '/milab/api/get_list_multas') {
    return redirectTo;
  }

  const feedback = resolvePostActionFeedbackValue(payload);
  if (!feedback) {
    return redirectTo;
  }

  return `${redirectTo}?success=${encodeURIComponent(feedback)}`;
}

function respondWithActionSuccess(req, res, payload = {}) {
  const redirectTo = resolvePostActionRedirectPath(req);
  const redirectUrl = buildSuccessRedirectPath(req, redirectTo, payload);
  if (wantsJson(req)) {
    return res.json({ ok: true, redirectTo: redirectUrl, ...payload });
  }
  return res.redirect(redirectUrl);
}

async function resolveLaboratoristaDocument(userDocument) {
  const result = await pool.query(
    'SELECT documento FROM laboratorista WHERE documento = $1 OR n_usuario = $1 LIMIT 1',
    [String(userDocument || '').trim()]
  );
  return result.rows[0]?.documento || null;
}

async function resolveApprovalActionScope(req, multaId, requiredFlagForLaboratorista) {
  const role = String(req.session?.user?.tipo || '').toLowerCase();

  if (role === 'coordinador') {
    const scope = await resolveCoordinatorScope(pool, getSessionDocument(req));
    if (!scope.coordinatorDocument || scope.facultyIds.length === 0) {
      return {
        allowed: false,
        message2: 'La cuenta de coordinador no tiene facultades asociadas.',
      };
    }
    return {
      allowed: true,
      actorDocument: scope.coordinatorDocument,
      facultyIds: scope.facultyIds,
      role,
    };
  }

  if (role !== 'laboratorista') {
    return {
      allowed: false,
      message2: 'Tu sesión no tiene permisos suficientes para esta acción.',
    };
  }

  const sessionDocument = getSessionDocument(req);
  const laboratoristaDocument = await resolveLaboratoristaDocument(sessionDocument);
  if (!laboratoristaDocument) {
    return {
      allowed: false,
      message2: 'No se encontró un laboratorista asociado a la sesión activa.',
    };
  }

  const multaScopeResult = await pool.query(
    `
      SELECT m.id, u.ual_id, u.facultad_id
      FROM multa m
      INNER JOIN ual u ON u.ual_id = m.ual_id
      WHERE m.id = $1
      LIMIT 1
    `,
    [multaId]
  );

  const multaScope = multaScopeResult.rows[0];
  if (!multaScope) {
    return {
      allowed: false,
      message2: 'La sanción seleccionada no existe o ya no está disponible.',
    };
  }

  const asignacionResult = await pool.query(
    `
      SELECT 1
      FROM laboratorista_ual
      WHERE laboratorista_documento_id = $1
        AND ual_id = $2
      LIMIT 1
    `,
    [laboratoristaDocument, multaScope.ual_id]
  );

  if (!asignacionResult.rows.length) {
    return {
      allowed: false,
      message2: 'La sanción no pertenece a una UAL asignada al laboratorista.',
    };
  }

  const facultadId = Number(multaScope.facultad_id);
  if (!Number.isFinite(facultadId)) {
    return {
      allowed: false,
      message2: 'No fue posible identificar la facultad de la sanción.',
    };
  }

  const configMap = await fetchMultaConfigsForFacultyIds([facultadId]);
  const config = configMap.get(facultadId);
  if (config?.[requiredFlagForLaboratorista] !== true) {
    const detailMessage =
      requiredFlagForLaboratorista === 'permite_saldar_multas_directas'
        ? 'La facultad no tiene habilitada por el coordinador la funcionalidad para desactivar sanciones directamente.'
        : 'La facultad no tiene habilitada por el coordinador la funcionalidad para activar sanciones directamente.';
    return {
      allowed: false,
      message2: detailMessage,
    };
  }

  return {
    allowed: true,
    actorDocument: laboratoristaDocument,
    facultyIds: [facultadId],
    role,
  };
}

async function resolveAplazamientoActionScope(req, multaId) {
  const role = String(req.session?.user?.tipo || '').toLowerCase();

  if (role === 'coordinador') {
    const scope = await resolveCoordinatorScope(pool, getSessionDocument(req));
    if (!scope.coordinatorDocument || scope.facultyIds.length === 0) {
      return {
        allowed: false,
        message2: 'La cuenta de coordinador no tiene facultades asociadas.',
      };
    }
    return {
      allowed: true,
      actorDocument: scope.coordinatorDocument,
      facultyIds: scope.facultyIds,
      role,
    };
  }

  if (role !== 'laboratorista') {
    return {
      allowed: false,
      message2: 'Tu sesión no tiene permisos suficientes para esta acción.',
    };
  }

  const sessionDocument = getSessionDocument(req);
  const laboratoristaDocument = await resolveLaboratoristaDocument(sessionDocument);
  if (!laboratoristaDocument) {
    return {
      allowed: false,
      message2: 'No se encontró un laboratorista asociado a la sesión activa.',
    };
  }

  const multaScopeResult = await pool.query(
    `
      SELECT m.id, u.ual_id, u.facultad_id
      FROM multa m
      INNER JOIN ual u ON u.ual_id = m.ual_id
      WHERE m.id = $1
      LIMIT 1
    `,
    [multaId]
  );

  const multaScope = multaScopeResult.rows[0];
  if (!multaScope) {
    return {
      allowed: false,
      message2: 'La sanción seleccionada no existe o ya no está disponible.',
    };
  }

  const asignacionResult = await pool.query(
    `
      SELECT 1
      FROM laboratorista_ual
      WHERE laboratorista_documento_id = $1
        AND ual_id = $2
      LIMIT 1
    `,
    [laboratoristaDocument, multaScope.ual_id]
  );

  if (!asignacionResult.rows.length) {
    return {
      allowed: false,
      message2: 'La sanción no pertenece a una UAL asignada al laboratorista.',
    };
  }

  const facultadId = Number(multaScope.facultad_id);
  if (!Number.isFinite(facultadId)) {
    return {
      allowed: false,
      message2: 'No fue posible identificar la facultad de la sanción.',
    };
  }

  const configMap = await fetchMultaConfigsForFacultyIds([facultadId]);
  const config = configMap.get(facultadId);
  const canDirectAction =
    config?.permite_crear_multas_activas_directas === true ||
    config?.permite_saldar_multas_directas === true;

  if (!canDirectAction) {
    return {
      allowed: false,
      message2:
        'La facultad no tiene habilitada por el coordinador la funcionalidad para aplazar o reactivar sanciones directamente.',
    };
  }

  return {
    allowed: true,
    actorDocument: laboratoristaDocument,
    facultyIds: [facultadId],
    role,
  };
}

// GET: Vista de aprobación de multas
router.get('/', requireCoordinadorApprovalAccess, async function (req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const scope = await resolveCoordinatorScope(pool, getSessionDocument(req));

    if (!scope.coordinatorDocument) {
      return res.render('home/message_error', {
        message: 'No se encontró información del coordinador.',
        message2: 'Verifique su cuenta',
        limit: null,
      });
    }

    if (scope.facultyIds.length === 0) {
      return res.render('home/message_error', {
        message: 'No hay facultades asociadas al coordinador.',
        message2: 'Contacte al administrador',
        limit: null,
      });
    }

    const result = await pool.query(
      `SELECT 
        m.id,
        COALESCE(pe.documento, pd.documento, us.documento) AS documento_sancionado,
        m.usuario_sancionado_id,
        CASE WHEN pd.usuario_id IS NOT NULL THEN 'docente' ELSE 'estudiante' END AS tipo_sancionado,
        us.codigo AS codigo_sancionado,
        l.nombre AS nombre_laboratorista,
        m.cat_multa,
        u.nombre AS ual, 
        m.fecha_multa, 
        m.con_estado_multa, 
        m.obs_multa,
        m.tipo_sancion
      FROM multa m
      INNER JOIN ual u ON u.ual_id = m.ual_id
      LEFT JOIN laboratorista l ON l.documento = m.laboratorista_documento_id
        LEFT JOIN usuario us ON us.id = m.usuario_sancionado_id
        LEFT JOIN perfil_estudiante pe ON pe.usuario_id = m.usuario_sancionado_id
        LEFT JOIN perfil_docente pd ON pd.usuario_id = m.usuario_sancionado_id
      WHERE m.con_estado_multa IN ('Pendiente', 'POR SALDAR')
        AND u.facultad_id = ANY($1::int[])`,
      [scope.facultyIds]
    );

    const multasPendientes = result.rows;

    const facultadesResult = await pool.query(
      'SELECT dependencia_facultad_id AS facultad_id, nombre FROM dependencia_facultad WHERE dependencia_facultad_id = ANY($1::int[]) ORDER BY nombre ASC',
      [scope.facultyIds]
    );
    const configMap = await fetchMultaConfigsForFacultyIds(scope.facultyIds);
    const facultadesParaAutorizar = facultadesResult.rows.map((row) => {
      const cfg = configMap.get(Number(row.facultad_id)) || {};
      return {
        facultad_id: Number(row.facultad_id),
        nombre: row.nombre,
        permite_crear_multas_activas_directas: Boolean(cfg.permite_crear_multas_activas_directas),
        permite_saldar_multas_directas: Boolean(cfg.permite_saldar_multas_directas),
        fecha_ultima_modificacion: cfg.fecha_ultima_modificacion || null,
        documento_ultimo_autorizador: cfg.documento_ultimo_autorizador || null,
        accion_ultima: cfg.accion_ultima || 'inicial',
      };
    });

    res.set('Cache-Control', 'no-store');
    return res.render('home/aprobacion_multa', {
      multas: multasPendientes,
      nombreCoordinador: req.session.user.nombre,
      SANCTION_TYPES,
      facultadesParaAutorizar,
    });
  } catch (error) {
    console.error('Error en /aprobacion_multa:', error);
    return res.render('home/message_error', {
      message: 'Error al cargar sanciones.',
      message2: 'Por favor, intenta más tarde.',
      limit: null,
    });
  }
});

// POST: Activar sanción (de Pendiente a ACTIVA)
router.post('/activar', requireApprovalAction, async function (req, res) {
  const body = req.body || {};
  const multa_id = Number(body.multa_id);
  const tipo_sancion = normalizeSanctionType(body.tipo_sancion);

  if (!Number.isInteger(multa_id) || multa_id <= 0) {
    return res.render('home/message_error', {
      message: 'Sanción inválida',
      message2: 'No se pudo identificar la sanción a activar.',
      limit: null,
    });
  }

  if (!isValidSanctionType(tipo_sancion)) {
    return res.render('home/message_error', {
      message: 'Tipo de sanción inválido',
      message2: 'Selecciona una opción válida antes de activar la sanción.',
      limit: null,
    });
  }

  try {
    const scope = await resolveApprovalActionScope(
      req,
      multa_id,
      'permite_crear_multas_activas_directas'
    );

    if (!scope?.allowed) {
      return res.render('home/message_error', {
        message: 'No autorizado',
        message2: scope?.message2 || 'No tienes autorización para activar esta sanción.',
        limit: null,
      });
    }

    const result = await pool.query(
      `
      UPDATE multa AS m
      SET con_estado_multa = 'ACTIVA',
          tipo_sancion = $2
      FROM ual u
      WHERE m.id = $1
        AND m.con_estado_multa = 'Pendiente'
        AND u.ual_id = m.ual_id
        AND u.facultad_id = ANY($3::int[])
    `,
      [multa_id, tipo_sancion, scope.facultyIds]
    );

    if (result.rowCount === 0) {
      return res.render('home/message_error', {
        message: 'No se pudo activar la sanción.',
        message2: "Verifica que esté en estado 'Pendiente'.",
        limit: null,
      });
    }

    const multaInfo = await pool.query(
      'SELECT m.usuario_sancionado_id, m.fecha_multa, u.nombre AS ual, m.obs_multa FROM multa m LEFT JOIN ual u ON u.ual_id = m.ual_id WHERE m.id = $1',
      [multa_id]
    );
    const usuarioId = multaInfo.rows[0]?.usuario_sancionado_id;
    const studentInfo = await resolveStudentContactByUsuarioId(usuarioId);
    const referencia = studentInfo?.codigo || studentInfo?.documento || '';
    await pool.query(
      `
        INSERT INTO log (nombre, documento, accion, persona)
        VALUES ($1, $2, $3, $4)
      `,
      [
        req.session.user.tipo,
        scope.actorDocument,
        'Cambiar estado de multa a ACTIVA',
        referencia || String(multa_id),
      ]
    );
    if (studentInfo?.correo) {
      const emailResult = await sendSanctionActivationEmail({
        multaId: multa_id,
        permiteReclamacion: !studentInfo.es_docente,
        correo: studentInfo.correo,
        nombre: studentInfo.nombre,
        codigo: referencia,
        tipoSancion: tipo_sancion,
        observaciones: multaInfo.rows[0]?.obs_multa,
        laboratorio: multaInfo.rows[0]?.ual,
        fecha: multaInfo.rows[0]?.fecha_multa,
      });

      if (emailResult?.ok !== true) {
        throw new Error('No fue posible enviar el correo de sanción activada.');
      }
    }

    return respondWithActionSuccess(req, res, {
      multa_id,
      nuevo_estado: 'ACTIVA',
    });
  } catch (error) {
    console.error('Error al activar sanción:', error);
    return res.render('home/message_error', {
      message: 'Error al activar la sanción.',
      message2: 'Por favor, intenta nuevamente.',
      limit: null,
    });
  }
});

// POST: Marcar sanción como SALDADA (de POR SALDAR a SALDADA)
router.post('/saldar', requireApprovalAction, async function (req, res) {
  const body = req.body || {};
  const multa_id = Number(body.multa_id);

  if (!Number.isInteger(multa_id) || multa_id <= 0) {
    return res.render('home/message_error', {
      message: 'Sanción inválida',
      message2: 'No se pudo identificar la sanción a saldar.',
      limit: null,
    });
  }

  try {
    const scope = await resolveApprovalActionScope(req, multa_id, 'permite_saldar_multas_directas');

    if (!scope?.allowed) {
      return res.render('home/message_error', {
        message: 'No autorizado',
        message2: scope?.message2 || 'No tienes autorización para saldar esta sanción.',
        limit: null,
      });
    }

    const result = await pool.query(
      `
      UPDATE multa AS m
      SET con_estado_multa = 'SALDADA'
      FROM ual u
      WHERE m.id = $1
        AND m.con_estado_multa = 'POR SALDAR'
        AND u.ual_id = m.ual_id
        AND u.facultad_id = ANY($2::int[])
    `,
      [multa_id, scope.facultyIds]
    );

    if (result.rowCount === 0) {
      return res.render('home/message_error', {
        message: 'No se pudo marcar como saldada.',
        message2: "Verifica que esté en estado 'POR SALDAR'.",
        limit: null,
      });
    }

    const sancionadoResult = await pool.query(
      'SELECT u.documento FROM multa m LEFT JOIN usuario u ON u.id = m.usuario_sancionado_id WHERE m.id = $1',
      [multa_id]
    );
    const documentoSancionado = sancionadoResult.rows[0]?.documento || String(multa_id);

    await pool.query(
      `
      INSERT INTO log (nombre, documento, accion, persona)
      VALUES ($1, $2, $3, $4)
    `,
      [
        req.session.user.tipo,
        scope.actorDocument,
        'Cambiar estado de multa a SALDADA',
        documentoSancionado,
      ]
    );

    return respondWithActionSuccess(req, res, {
      multa_id,
      nuevo_estado: 'SALDADA',
    });
  } catch (error) {
    console.error('Error al marcar sanción como saldada:', error);
    return res.render('home/message_error', {
      message: 'Error al marcar como saldada.',
      message2: 'Por favor, intenta nuevamente.',
      limit: null,
    });
  }
});

// POST: Marcar sanción como APLAZADA (de ACTIVA a APLAZADA)
router.post('/aplazar', requireApprovalAction, async function (req, res) {
  const body = req.body || {};
  const multa_id = Number(body.multa_id);

  if (!Number.isInteger(multa_id) || multa_id <= 0) {
    return res.render('home/message_error', {
      message: 'Sanción inválida',
      message2: 'No se pudo identificar la sanción a aplazar.',
      limit: null,
    });
  }

  try {
    const scope = await resolveAplazamientoActionScope(req, multa_id);

    if (!scope?.allowed) {
      return res.render('home/message_error', {
        message: 'No autorizado',
        message2: scope?.message2 || 'No tienes autorización para aplazar esta sanción.',
        limit: null,
      });
    }

    const result = await pool.query(
      `
      UPDATE multa AS m
      SET con_estado_multa = 'APLAZADA'
      FROM ual u
      WHERE m.id = $1
        AND m.con_estado_multa = 'ACTIVA'
        AND u.ual_id = m.ual_id
        AND u.facultad_id = ANY($2::int[])
    `,
      [multa_id, scope.facultyIds]
    );

    if (result.rowCount === 0) {
      return res.render('home/message_error', {
        message: 'No se pudo aplazar la sanción.',
        message2: "Verifica que esté en estado 'ACTIVA'.",
        limit: null,
      });
    }

    const sancionadoResult = await pool.query(
      'SELECT u.documento FROM multa m LEFT JOIN usuario u ON u.id = m.usuario_sancionado_id WHERE m.id = $1',
      [multa_id]
    );
    const documentoSancionado = sancionadoResult.rows[0]?.documento || String(multa_id);

    await pool.query(
      `
      INSERT INTO log (nombre, documento, accion, persona)
      VALUES ($1, $2, $3, $4)
    `,
      [
        req.session.user.tipo,
        scope.actorDocument,
        'Cambiar estado de multa a APLAZADA',
        documentoSancionado,
      ]
    );

    return respondWithActionSuccess(req, res, {
      multa_id,
      nuevo_estado: 'APLAZADA',
      feedback: 'aplazada',
    });
  } catch (error) {
    console.error('Error al aplazar sanción:', error);
    return res.render('home/message_error', {
      message: 'Error al aplazar la sanción.',
      message2: 'Por favor, intenta nuevamente.',
      limit: null,
    });
  }
});

// POST: Reactivar sanción (de APLAZADA a ACTIVA)
router.post('/reactivar', requireApprovalAction, async function (req, res) {
  const body = req.body || {};
  const multa_id = Number(body.multa_id);

  if (!Number.isInteger(multa_id) || multa_id <= 0) {
    return res.render('home/message_error', {
      message: 'Sanción inválida',
      message2: 'No se pudo identificar la sanción a reactivar.',
      limit: null,
    });
  }

  try {
    const scope = await resolveAplazamientoActionScope(req, multa_id);

    if (!scope?.allowed) {
      return res.render('home/message_error', {
        message: 'No autorizado',
        message2: scope?.message2 || 'No tienes autorización para reactivar esta sanción.',
        limit: null,
      });
    }

    const result = await pool.query(
      `
      UPDATE multa AS m
      SET con_estado_multa = 'ACTIVA'
      FROM ual u
      WHERE m.id = $1
        AND m.con_estado_multa = 'APLAZADA'
        AND u.ual_id = m.ual_id
        AND u.facultad_id = ANY($2::int[])
    `,
      [multa_id, scope.facultyIds]
    );

    if (result.rowCount === 0) {
      return res.render('home/message_error', {
        message: 'No se pudo reactivar la sanción.',
        message2: "Verifica que esté en estado 'APLAZADA'.",
        limit: null,
      });
    }

    const sancionadoResult = await pool.query(
      'SELECT u.documento FROM multa m LEFT JOIN usuario u ON u.id = m.usuario_sancionado_id WHERE m.id = $1',
      [multa_id]
    );
    const documentoSancionado = sancionadoResult.rows[0]?.documento || String(multa_id);

    await pool.query(
      `
      INSERT INTO log (nombre, documento, accion, persona)
      VALUES ($1, $2, $3, $4)
    `,
      [
        req.session.user.tipo,
        scope.actorDocument,
        'Cambiar estado de multa a ACTIVA (desde APLAZADA)',
        documentoSancionado,
      ]
    );

    return respondWithActionSuccess(req, res, {
      multa_id,
      nuevo_estado: 'ACTIVA',
      feedback: 'reactivada',
    });
  } catch (error) {
    console.error('Error al reactivar sanción:', error);
    return res.render('home/message_error', {
      message: 'Error al reactivar la sanción.',
      message2: 'Por favor, intenta nuevamente.',
      limit: null,
    });
  }
});

function buildToggleConfigHandler(flag, accionHabilitar, accionDeshabilitar, descripcionBase) {
  return async function (req, res) {
    try {
      const scope = await resolveCoordinatorScope(pool, getSessionDocument(req));
      if (!scope.coordinatorDocument || scope.facultyIds.length === 0) {
        const msg = {
          message: 'No autorizado',
          message2: 'La cuenta no tiene facultades asociadas.',
        };
        return req.accepts('json')
          ? res.status(401).json({ ok: false, ...msg })
          : res.render('home/message_error', { ...msg, limit: null });
      }
      const facultadIdParam = Number(req.params.facultad_id);
      if (!Number.isFinite(facultadIdParam)) {
        const msg = {
          message: 'Facultad inválida',
          message2: 'No se pudo interpretar el identificador de la facultad.',
        };
        return req.accepts('json')
          ? res.status(400).json({ ok: false, ...msg })
          : res.render('home/message_error', { ...msg, limit: null });
      }
      if (!scope.facultyIds.includes(facultadIdParam)) {
        const msg = {
          message: 'No autorizado',
          message2: 'No puedes gestionar la configuración de esta facultad.',
        };
        return req.accepts('json')
          ? res.status(403).json({ ok: false, ...msg })
          : res.render('home/message_error', { ...msg, limit: null });
      }
      const currentCfg = scope.facultyIds?.length
        ? (await fetchMultaConfigsForFacultyIds([facultadIdParam])).get(facultadIdParam)
        : null;
      const currentValue = Boolean(currentCfg?.[flag]);
      const nextValue = !currentValue;
      const accionAudit = nextValue ? accionHabilitar : accionDeshabilitar;
      const descripcion = nextValue
        ? `${descripcionBase} habilitada para facultad ${facultadIdParam}`
        : `${descripcionBase} deshabilitada para facultad ${facultadIdParam}`;
      await upsertConfigForFacultyId(
        facultadIdParam,
        { [flag]: nextValue },
        scope.coordinatorDocument,
        accionAudit
      );
      await logConfigChangeToAuditoria(pool, scope.coordinatorDocument, accionAudit, descripcion, {
        facultad_id: facultadIdParam,
        flag,
        nuevo_valor: nextValue,
      });
      await pool.query(
        `INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)`,
        [req.session.user.tipo, scope.coordinatorDocument, accionAudit, String(facultadIdParam)]
      );
      const payload = {
        ok: true,
        flag,
        nextValue,
        facultad_id: facultadIdParam,
        fecha_modificacion: new Date().toISOString(),
        documento_autorizador: scope.coordinatorDocument,
        accion_ultima: accionAudit,
      };
      if (req.accepts('json')) {
        return res.json(payload);
      }
      return res.redirect('/milab/api/aprobacion_multa');
    } catch (error) {
      console.error('Error al cambiar configuración de facultad:', error);
      const msg = {
        message: 'Error al actualizar configuración.',
        message2: 'Por favor, intenta nuevamente.',
      };
      return req.accepts('json')
        ? res.status(500).json({ ok: false, ...msg })
        : res.render('home/message_error', { ...msg, limit: null });
    }
  };
}

router.post(
  '/configuracion/:facultad_id/toggle-crear-directa',
  requireCoordinadorApprovalAction,
  buildToggleConfigHandler(
    'permite_crear_multas_activas_directas',
    'CONFIG_MULTAS_HABILITAR_CREACION_DIRECTA',
    'CONFIG_MULTAS_DESHABILITAR_CREACION_DIRECTA',
    'Autorización de creación de sanciones activas directas'
  )
);

router.post(
  '/configuracion/:facultad_id/toggle-saldar-directa',
  requireCoordinadorApprovalAction,
  buildToggleConfigHandler(
    'permite_saldar_multas_directas',
    'CONFIG_MULTAS_HABILITAR_SALDO_DIRECTO',
    'CONFIG_MULTAS_DESHABILITAR_SALDO_DIRECTO',
    'Autorización de saldo directo de sanciones'
  )
);

module.exports = router;
