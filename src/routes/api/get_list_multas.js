const express = require('express');

const router = express.Router();
const pool = require('../../libs/db');
const {
  fetchSanctionCategories,
  isActiveSanctionCategory,
} = require('../../libs/sanction-categories');
const { resolveCoordinatorScope } = require('../../libs/faculty-scope');
const { requireRoles, requireJsonRoles } = require('../middlewares/auth');
const { fetchSanctionClaimHistory } = require('../../libs/sanction-claims');
const { resolveOatiName } = require('../../libs/oati-name');
const { SANCTION_TYPES } = require('../../libs/multa-config');
const { sgaDebtService } = require('../../libs/oati-debts');
const {
  renderApplicationError,
  renderModuleError,
  wantsJson,
} = require('../middlewares/error-handler');
const ExcelJS = require('exceljs');

const bp = require('body-parser');
router.use(bp.json());
router.use(bp.urlencoded({ extended: true }));

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_FINE_CATEGORY_LENGTH = 500;
const ALLOWED_FINE_STATES = new Set(['ACTIVA', 'APLAZADA', 'Pendiente', 'POR SALDAR', 'SALDADA']);
const LIST_SUCCESS_VALUES = new Set(['activada', 'reactivada', 'aplazada', 'saldada', 'editada']);

const requireMultasAccess = requireRoles(['admin', 'laboratorista', 'coordinador'], {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

const requireMultasEditAccess = requireRoles(['admin', 'laboratorista', 'coordinador'], {
  message: 'Acceso denegado',
  message2: 'No tienes permisos para editar esta sanción.',
  limit: 'noSession',
});

function getSessionDocument(req) {
  return req.session?.user?.documento_real || req.session?.user?.documento || null;
}

function normalizeDateFilter(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return null;
  return ISO_DATE_PATTERN.test(value) ? value : 'INVALID';
}

function normalizeFineStateFilter(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return null;
  return ALLOWED_FINE_STATES.has(value) ? value : 'INVALID';
}

async function resolveLaboratoristaDocument(client, userDocument) {
  const result = await client.query(
    'SELECT documento FROM laboratorista WHERE documento = $1 OR n_usuario = $1 LIMIT 1',
    [String(userDocument || '').trim()]
  );

  return result.rows[0]?.documento || null;
}

async function validateFineEditScope(req, client, multaId) {
  const result = await client.query(
    `SELECT m.con_estado_multa, m.cat_multa, m.ual_id, u.facultad_id
     FROM multa m
     INNER JOIN ual u ON u.ual_id = m.ual_id
     WHERE m.id = $1
     LIMIT 1`,
    [multaId]
  );
  const multa = result.rows[0];

  if (!multa) return { ok: false, message: 'La sanción no existe.' };
  if (String(multa.con_estado_multa || '').toUpperCase() !== 'ACTIVA') {
    return { ok: false, message: 'Solo se pueden editar sanciones ACTIVAS.' };
  }

  const userType = String(req.session?.user?.tipo || '').toLowerCase();
  if (userType === 'admin') return { ok: true, categoria: multa.cat_multa };

  if (userType === 'coordinador') {
    const scope = await resolveCoordinatorScope(client, getSessionDocument(req));
    if (scope.facultyIds.includes(Number(multa.facultad_id)))
      return { ok: true, categoria: multa.cat_multa };
    return { ok: false, message: 'La sanción está fuera del alcance de tu facultad.' };
  }

  const laboratoristaDocument = await resolveLaboratoristaDocument(client, getSessionDocument(req));
  if (!laboratoristaDocument) {
    return { ok: false, message: 'No se encontró un laboratorista asociado a la sesión.' };
  }

  const assignment = await client.query(
    `SELECT 1
     FROM laboratorista_ual
     WHERE laboratorista_documento_id = $1
       AND ual_id = $2
     LIMIT 1`,
    [laboratoristaDocument, multa.ual_id]
  );

  return assignment.rows.length
    ? { ok: true, categoria: multa.cat_multa }
    : { ok: false, message: 'La sanción no pertenece a una UAL asignada al laboratorista.' };
}

function renderFilterError(req, res, message, message2) {
  if (wantsJson(req)) {
    return res.status(400).json({
      ok: false,
      message,
      message2,
    });
  }

  return res.render('home/message_error', {
    message,
    message2,
    limit: null,
  });
}

function normalizeListSuccessFeedback(rawValue) {
  const value = String(rawValue || '')
    .trim()
    .toLowerCase();
  return LIST_SUCCESS_VALUES.has(value) ? value : null;
}

function normalizeIdFilter(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return null;
  return /^\d{1,9}$/.test(value) && Number(value) > 0 ? Number(value) : 'INVALID';
}

function isGlobalSanctionsViewer(user) {
  const roles = [
    user?.tipo,
    ...(Array.isArray(user?.roles) ? user.roles : String(user?.roles || '').split(',')),
  ].map((role) =>
    String(role || '')
      .trim()
      .toLowerCase()
  );
  return roles.some((role) =>
    ['admin', 'administrador', 'coordinador_general', 'coordinador general'].includes(role)
  );
}

// Arma las opciones de facultad/dependencia/UAL disponibles según el alcance del usuario.
async function fetchLocationFilterOptions(client, scopeCondition, scopeParams) {
  const result = await client.query(
    `SELECT u.ual_id,
            u.nombre AS ual_nombre,
            d.dependencia_facultad_id AS unidad_id,
            d.nombre AS unidad_nombre,
            d.padre_id,
            COALESCE(p.dependencia_facultad_id, d.dependencia_facultad_id) AS facultad_raiz_id,
            COALESCE(p.nombre, d.nombre) AS facultad_raiz_nombre
     FROM ual u
     INNER JOIN dependencia_facultad d ON d.dependencia_facultad_id = u.facultad_id
     LEFT JOIN dependencia_facultad p ON p.dependencia_facultad_id = d.padre_id
     ${scopeCondition ? `WHERE ${scopeCondition}` : ''}
     ORDER BY facultad_raiz_nombre ASC, unidad_nombre ASC, u.nombre ASC`,
    scopeParams
  );

  const facultades = new Map();
  const dependencias = new Map();
  const uals = [];

  for (const row of result.rows) {
    const ualId = Number(row.ual_id);
    const facultadId = Number(row.facultad_raiz_id);
    if (!ualId || !facultadId || !row.ual_nombre) continue;

    facultades.set(facultadId, { id: facultadId, nombre: row.facultad_raiz_nombre });
    const dependenciaId = row.padre_id ? Number(row.unidad_id) : null;
    if (dependenciaId) {
      dependencias.set(dependenciaId, {
        id: dependenciaId,
        nombre: row.unidad_nombre,
        facultad_id: facultadId,
      });
    }
    uals.push({
      id: ualId,
      nombre: row.ual_nombre,
      facultad_id: facultadId,
      dependencia_id: dependenciaId,
    });
  }

  return {
    facultades: [...facultades.values()],
    dependencias: [...dependencias.values()],
    uals,
  };
}

async function buildMultasQueryContext(req, client, { includeLocationOptions = false } = {}) {
  const fechaDesde = normalizeDateFilter(req.query?.fecha_desde);
  const fechaHasta = normalizeDateFilter(req.query?.fecha_hasta);
  const estadoMulta = normalizeFineStateFilter(req.query?.estado_multa);
  const facultadFiltro = normalizeIdFilter(req.query?.facultad_id);
  const dependenciaFiltro = normalizeIdFilter(req.query?.dependencia_id);
  const ualFiltro = normalizeIdFilter(req.query?.ual_id);

  if ([facultadFiltro, dependenciaFiltro, ualFiltro].includes('INVALID')) {
    return {
      error: {
        message: 'Filtro de ubicación inválido.',
        message2: 'Selecciona una facultad, dependencia o UAL válida.',
      },
    };
  }

  if (estadoMulta === 'INVALID') {
    return {
      error: {
        message: 'Filtro de estado inválido.',
        message2: 'Selecciona un estado de sanción válido.',
      },
    };
  }

  if (fechaDesde === 'INVALID' || fechaHasta === 'INVALID') {
    return {
      error: {
        message: 'Filtro de fecha inválido.',
        message2: 'Usa el formato YYYY-MM-DD para fecha desde y fecha hasta.',
      },
    };
  }

  if (fechaDesde && fechaHasta && fechaDesde > fechaHasta) {
    return {
      error: {
        message: 'Rango de fechas inválido.',
        message2: 'La fecha inicial no puede ser mayor que la fecha final.',
      },
    };
  }

  const conditions = [];
  const params = [];
  const nextParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  const userType = String(req.session?.user?.tipo || '').toLowerCase();
  const isGlobalViewer = isGlobalSanctionsViewer(req.session?.user);
  let optionsScopeCondition = '';
  let optionsScopeParams = [];

  if (userType === 'coordinador' && !isGlobalViewer) {
    const scope = await resolveCoordinatorScope(client, getSessionDocument(req));

    if (scope.facultyIds.length === 0) {
      return {
        error: {
          message: '¡Acceso denegado!',
          message2: 'El coordinador no tiene facultades asociadas.',
        },
      };
    }

    conditions.push(`u.facultad_id = ANY(${nextParam(scope.facultyIds)}::int[])`);
    optionsScopeCondition = 'u.facultad_id = ANY($1::int[])';
    optionsScopeParams = [scope.facultyIds];
  } else if (userType === 'laboratorista' && !isGlobalViewer) {
    const laboratoristaDocument = await resolveLaboratoristaDocument(
      client,
      getSessionDocument(req)
    );

    if (!laboratoristaDocument) {
      return {
        error: {
          message: '¡Acceso denegado!',
          message2: 'No se encontró un laboratorista asociado a la sesión activa.',
        },
      };
    }

    conditions.push(
      `EXISTS (
        SELECT 1
        FROM laboratorista_ual lu
        WHERE lu.laboratorista_documento_id = ${nextParam(laboratoristaDocument)}
          AND lu.ual_id = m.ual_id
      )`
    );
    optionsScopeCondition = `EXISTS (
        SELECT 1
        FROM laboratorista_ual lu
        WHERE lu.laboratorista_documento_id = $1
          AND lu.ual_id = u.ual_id
      )`;
    optionsScopeParams = [laboratoristaDocument];
  }

  const needsLocationOptions =
    includeLocationOptions || Boolean(facultadFiltro || dependenciaFiltro || ualFiltro);
  const locationOptions = needsLocationOptions
    ? await fetchLocationFilterOptions(client, optionsScopeCondition, optionsScopeParams)
    : { facultades: [], dependencias: [], uals: [] };
  const filterAccess = {
    facultad: isGlobalViewer,
    dependencia: isGlobalViewer || userType === 'coordinador',
    ual: true,
  };
  const hasOption = (list, id) => list.some((item) => item.id === id);

  if (
    (facultadFiltro &&
      (!filterAccess.facultad || !hasOption(locationOptions.facultades, facultadFiltro))) ||
    (dependenciaFiltro &&
      (!filterAccess.dependencia || !hasOption(locationOptions.dependencias, dependenciaFiltro))) ||
    (ualFiltro && !hasOption(locationOptions.uals, ualFiltro))
  ) {
    return {
      error: {
        message: 'Filtro de ubicación no permitido.',
        message2: 'La facultad, dependencia o UAL seleccionada está fuera de tu alcance.',
      },
    };
  }

  if (facultadFiltro) {
    const facultadParam = nextParam(facultadFiltro);
    conditions.push(
      `u.facultad_id IN (
        SELECT dependencia_facultad_id
        FROM dependencia_facultad
        WHERE dependencia_facultad_id = ${facultadParam}::int
           OR padre_id = ${facultadParam}::int
      )`
    );
  }

  if (dependenciaFiltro) {
    conditions.push(`u.facultad_id = ${nextParam(dependenciaFiltro)}::int`);
  }

  if (ualFiltro) {
    conditions.push(`m.ual_id = ${nextParam(ualFiltro)}::int`);
  }

  if (fechaDesde) {
    conditions.push(`m.fecha_multa >= ${nextParam(fechaDesde)}::date`);
  }

  if (fechaHasta) {
    conditions.push(`m.fecha_multa <= ${nextParam(fechaHasta)}::date`);
  }

  if (estadoMulta) {
    conditions.push(`m.con_estado_multa = ${nextParam(estadoMulta)}`);
  }

  return {
    filters: {
      fecha_desde: fechaDesde || '',
      fecha_hasta: fechaHasta || '',
      estado_multa: estadoMulta || '',
      facultad_id: facultadFiltro || '',
      dependencia_id: dependenciaFiltro || '',
      ual_id: ualFiltro || '',
    },
    filterAccess,
    locationOptions,
    conditions,
    params,
  };
}

async function queryMultasRows(client, conditions, params) {
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await client.query(
    `
      SELECT
        m.id,
        m.cat_multa,
        l.nombre AS nombre_laboratorista,
        l.documento AS cc_laboratorista,
        COALESCE(pe.documento, pd.documento, us.documento) AS documento_sancionado,
        COALESCE(pe.nombre, pd.nombre, us.nombre, '') AS nombre_sancionado,
        COALESCE(pe.codigo::text, us.codigo::text, '') AS codigo_sancionado,
        CASE WHEN pd.usuario_id IS NOT NULL THEN 'docente' ELSE 'estudiante' END AS tipo_sancionado,
        u.nombre AS ual,
        m.ual_id,
        u.facultad_id,
        TO_CHAR(m.fecha_multa, 'YYYY-MM-DD') AS fecha_multa_formateada,
        m.con_estado_multa,
        m.obs_multa,
        m.tipo_sancion
      FROM multa m
      INNER JOIN ual u ON u.ual_id = m.ual_id
      LEFT JOIN laboratorista l ON l.documento = m.laboratorista_documento_id
      LEFT JOIN usuario us ON us.id = m.usuario_sancionado_id
      LEFT JOIN perfil_estudiante pe ON pe.usuario_id = m.usuario_sancionado_id
      LEFT JOIN perfil_docente pd ON pd.usuario_id = m.usuario_sancionado_id
      ${whereClause}
      ORDER BY m.fecha_multa DESC NULLS LAST, m.id DESC
    `,
    params
  );

  return result.rows;
}

async function addLaboratoristaActions(client, rows, req) {
  const userType = String(req.session?.user?.tipo || '').toLowerCase();
  if (userType !== 'laboratorista') {
    const readOnly = userType === 'coordinador_general' || userType === 'coordinador general';
    return rows.map((row) => ({
      ...row,
      canEdit: !readOnly && String(row.con_estado_multa || '').toUpperCase() === 'ACTIVA',
    }));
  }

  const facultyIds = [
    ...new Set(rows.map((row) => Number(row.facultad_id)).filter((id) => Number.isFinite(id))),
  ];
  if (facultyIds.length === 0) {
    return rows;
  }

  const configResult = await client.query(
    'SELECT * FROM config_facultad_multas WHERE facultad_id = ANY($1::int[])',
    [facultyIds]
  );
  const configMap = new Map(
    configResult.rows.map((config) => [Number(config.facultad_id), config])
  );

  return rows.map((row) => {
    const state = String(row.con_estado_multa || '').toUpperCase();
    const config = configMap.get(Number(row.facultad_id));

    return {
      ...row,
      canActivate: state === 'PENDIENTE' && config?.permite_crear_multas_activas_directas === true,
      canSaldar: state === 'POR SALDAR' && config?.permite_saldar_multas_directas === true,
      canAplazar:
        state === 'ACTIVA' &&
        (config?.permite_crear_multas_activas_directas === true ||
          config?.permite_saldar_multas_directas === true),
      canReactivar:
        state === 'APLAZADA' &&
        (config?.permite_crear_multas_activas_directas === true ||
          config?.permite_saldar_multas_directas === true),
      canRemove: state === 'ACTIVA' && config?.permite_saldar_multas_directas === true,
      canEdit: state === 'ACTIVA',
    };
  });
}

router.get('/resolve_name', requireMultasAccess, async (req, res) => {
  const documento = String(req.query.documento || '').trim();

  if (!documento) {
    return res.json({ ok: false, nombre: '' });
  }

  try {
    const nombre = await resolveOatiName(documento);
    return res.json({ ok: true, nombre: nombre || '' });
  } catch (error) {
    console.error('Error resolviendo nombre OATI:', error);
    return res.status(500).json({ ok: false, nombre: '' });
  }
});

router.get(
  '/:multaId/reclamaciones',
  requireJsonRoles(['admin', 'laboratorista', 'coordinador']),
  async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const multaId = Number(req.params.multaId);
    if (!Number.isSafeInteger(multaId) || multaId <= 0) {
      return res.status(400).json({ ok: false, message: 'El ID de la sanción no es válido.' });
    }
    let client;
    try {
      client = await pool.connect();
      const context = await buildMultasQueryContext(req, client);
      if (context.error)
        return res.status(403).json({ ok: false, message: context.error.message2 });
      const sanctions = await queryMultasRows(
        client,
        [...context.conditions, `m.id = $${context.params.length + 1}`],
        [...context.params, multaId]
      );
      if (!sanctions.length)
        return res
          .status(404)
          .json({ ok: false, message: 'La sanción no existe o está fuera de tu alcance.' });
      const history = await fetchSanctionClaimHistory(client, multaId);
      return res.json({ ok: true, history });
    } catch (error) {
      console.error('Error consultando historial de reclamación:', error);
      return res
        .status(500)
        .json({ ok: false, message: 'No fue posible consultar el historial de reclamación.' });
    } finally {
      if (client) client.release();
    }
  }
);

router.get('/:multaId/sga-multas', requireMultasAccess, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const multaId = Number(req.params.multaId);
  if (!Number.isInteger(multaId) || multaId <= 0) {
    return res.status(400).json({ ok: false, message: 'El ID de la sanción no es válido.' });
  }

  if (!sgaDebtService.isConfigured()) {
    return res.json({ ok: true, configured: false, supported: true, multas: [] });
  }

  let client;
  try {
    client = await pool.connect();
    const queryContext = await buildMultasQueryContext(req, client);
    if (queryContext.error) {
      client.release();
      return res.status(403).json({
        ok: false,
        message: queryContext.error.message2 || queryContext.error.message,
      });
    }

    const idParameter = `$${queryContext.params.length + 1}`;
    const rows = await queryMultasRows(
      client,
      [...queryContext.conditions, `m.id = ${idParameter}`],
      [...queryContext.params, multaId]
    );
    client.release();
    client = null;

    const sanction = rows[0];
    if (!sanction) {
      return res
        .status(404)
        .json({ ok: false, message: 'La sanción no existe o está fuera de tu alcance.' });
    }

    if (sanction.tipo_sancionado !== 'estudiante') {
      return res.json({ ok: true, configured: true, supported: false, multas: [] });
    }

    const multas = await sgaDebtService.getActiveDebts({
      codigo: sanction.codigo_sancionado,
      documento: sanction.documento_sancionado,
    });
    return res.json({ ok: true, configured: true, supported: true, multas });
  } catch (error) {
    if (client) client.release();
    console.error('Error consultando multas SGA desde el detalle de sanción:', error);
    return res.status(502).json({
      ok: false,
      message: 'No fue posible consultar las multas del estudiante en SGA.',
    });
  }
});

router.post('/editar', requireMultasEditAccess, async (req, res) => {
  const multaId = Number(req.body?.multa_id);
  const categoria = String(req.body?.cat_multa || '').trim();
  const tipoSancion = String(req.body?.tipo_sancion || '').trim();

  if (
    !Number.isInteger(multaId) ||
    multaId <= 0 ||
    !categoria ||
    categoria.length > MAX_FINE_CATEGORY_LENGTH
  ) {
    return res.render('home/message_error', {
      message: 'Datos de sanción inválidos.',
      message2: 'Selecciona una categoría válida.',
      limit: null,
    });
  }

  if (!SANCTION_TYPES.includes(tipoSancion)) {
    return res.render('home/message_error', {
      message: 'Tipo de sanción inválido.',
      message2: 'Selecciona un tipo de sanción válido.',
      limit: null,
    });
  }

  let client;
  try {
    client = await pool.connect();
    const scope = await validateFineEditScope(req, client, multaId);
    if (!scope.ok) {
      client.release();
      return res.render('home/message_error', {
        message: 'No autorizado',
        message2: scope.message,
        limit: null,
      });
    }

    if (categoria !== scope.categoria && !(await isActiveSanctionCategory(categoria, client))) {
      client.release();
      return res.render('home/message_error', {
        message: 'Categoría de sanción no disponible.',
        message2: 'Conserva la categoría actual o selecciona una categoría activa del catálogo.',
        limit: null,
      });
    }

    await client.query(
      `UPDATE multa
       SET cat_multa = $1,
           tipo_sancion = $2,
           fecha_modificacion = CURRENT_TIMESTAMP
       WHERE id = $3
         AND con_estado_multa = 'ACTIVA'`,
      [categoria, tipoSancion, multaId]
    );
    await client.query(
      'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
      [
        req.session.user.tipo,
        getSessionDocument(req),
        'Editar categoría y tipo de sanción activa',
        String(multaId),
      ]
    );
    client.release();

    return res.redirect('/milab/api/get_list_multas?success=editada');
  } catch (error) {
    if (client) client.release();
    console.error('Error editando sanción:', error);
    return renderModuleError(
      req,
      res,
      {
        message: 'No fue posible editar la sanción.',
        message2: 'Inténtalo nuevamente.',
      },
      error
    );
  }
});

router.get('/', requireMultasAccess, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  let client;

  try {
    client = await pool.connect();
    const queryContext = await buildMultasQueryContext(req, client, {
      includeLocationOptions: true,
    });
    if (queryContext.error) {
      client.release();
      return renderFilterError(req, res, queryContext.error.message, queryContext.error.message2);
    }

    const rows = await queryMultasRows(client, queryContext.conditions, queryContext.params);
    const rowsWithActions = await addLaboratoristaActions(client, rows, req);
    const sanctionCategories = await fetchSanctionCategories({ client });

    client.release();
    const sancionesEstudiantes = rowsWithActions.filter((row) => row.tipo_sancionado !== 'docente');
    const sancionesDocentes = rowsWithActions.filter((row) => row.tipo_sancionado === 'docente');

    res.render('home/get_list_multas', {
      sampleData: rowsWithActions,
      sanctionCategories,
      sancionesEstudiantes,
      sancionesDocentes,
      SANCTION_TYPES,
      filtros: queryContext.filters,
      filterAccess: queryContext.filterAccess,
      locationOptions: queryContext.locationOptions,
      successFeedback: normalizeListSuccessFeedback(req.query?.success),
      sgaConfigured: sgaDebtService.isConfigured(),
    });
  } catch (error) {
    if (client) {
      client.release();
    }

    console.error(error);

    if (wantsJson(req)) {
      return res.status(500).json({
        ok: false,
        message: 'No fue posible cargar el listado de multas.',
        message2: 'Intenta nuevamente en unos minutos.',
      });
    }

    return renderApplicationError(
      res,
      {
        status: 500,
        message: 'No fue posible cargar el listado de multas.',
        message2: 'Intenta nuevamente en unos minutos.',
        limit: null,
      },
      req,
      error
    );
  }
});

router.get('/export/excel', requireMultasAccess, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  let client;

  try {
    client = await pool.connect();

    const queryContext = await buildMultasQueryContext(req, client);
    if (queryContext.error) {
      client.release();
      return renderFilterError(req, res, queryContext.error.message, queryContext.error.message2);
    }

    const rows = await queryMultasRows(client, queryContext.conditions, queryContext.params);
    client.release();

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Multas');

    worksheet.columns = [
      { header: 'ID', key: 'id', width: 10 },
      { header: 'Tipo Sancionado', key: 'tipo_sancionado', width: 18 },
      { header: 'Documento Sancionado', key: 'documento_sancionado', width: 22 },
      { header: 'Codigo Sancionado', key: 'codigo_sancionado', width: 20 },
      { header: 'Fecha Multa', key: 'fecha_multa_formateada', width: 14 },
      { header: 'Estado', key: 'con_estado_multa', width: 14 },
      { header: 'Categoria', key: 'cat_multa', width: 20 },
      { header: 'Tipo Sancion', key: 'tipo_sancion', width: 26 },
      { header: 'UAL', key: 'ual', width: 28 },
      { header: 'Laboratorista', key: 'nombre_laboratorista', width: 26 },
      { header: 'CC Laboratorista', key: 'cc_laboratorista', width: 20 },
      { header: 'Observaciones', key: 'obs_multa', width: 40 },
    ];

    rows.forEach((row) => {
      worksheet.addRow({
        ...row,
        tipo_sancion: row.tipo_sancion || '',
        nombre_laboratorista: row.nombre_laboratorista || '',
        cc_laboratorista: row.cc_laboratorista || '',
        obs_multa: row.obs_multa || '',
      });
    });

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };

    const today = new Date().toISOString().slice(0, 10);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="multas_${today}.xlsx"`);

    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    if (client) {
      client.release();
    }

    console.error(error);

    if (wantsJson(req)) {
      return res.status(500).json({
        ok: false,
        message: 'No fue posible exportar el listado de multas.',
        message2: 'Intenta nuevamente en unos minutos.',
      });
    }

    return renderApplicationError(res, {
      status: 500,
      message: 'No fue posible exportar el listado de multas.',
      message2: 'Intenta nuevamente en unos minutos.',
      limit: null,
    });
  }
});

module.exports = router;
