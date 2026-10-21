const express = require('express');

const pool = require('../../libs/db');
const { getAcademicServicePath, requestOati } = require('../../libs/oati-client');
const { ensurePerfilEstudiante } = require('../../libs/user-identity');
const {
  buildSanctionPersonReturnPath,
  createSanctionPersonLookup,
  resolveSanctionPersonLookup,
} = require('../../libs/sanction-person-lookup');
const { requireRoles } = require('../middlewares/auth');
const { SANCTION_TYPES } = require('../../libs/multa-config');
// const { SANCTION_TYPES, fetchMultaConfigsForFacultyIds } = require('../../libs/multa-config');
const { fetchSanctionCategories } = require('../../libs/sanction-categories');
const { sgaDebtService } = require('../../libs/oati-debts');
const { listingHelpers: sanctionListHelpers } = require('./get_list_multas');

// Variables de entorno
require('dotenv').config();

let router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: false }));

function extractOasStudentRecords(payload) {
  if (!payload) return [];

  const nested = payload?.datosEstudianteCollection?.datosBasicosEstudiante;
  if (Array.isArray(nested)) return nested;
  if (nested) return [nested];

  const flat = payload?.datosBasicosEstudiante;
  if (Array.isArray(flat)) return flat;
  if (flat) return [flat];

  return [];
}

// Laboratoristas asignados por UAL, usados para que admin/coordinador elijan en cuyo nombre registrar.
async function fetchLaboratoristasByUalIds(ualIds) {
  const normalizedIds = (ualIds || []).filter((id) => Number.isFinite(id));
  if (!normalizedIds.length) return new Map();

  const result = await pool.query(
    `SELECT lu.ual_id, l.documento, l.nombre
     FROM laboratorista_ual lu
     INNER JOIN laboratorista l ON l.documento = lu.laboratorista_documento_id
     WHERE lu.ual_id = ANY($1::int[])
       AND (l.activo IS DISTINCT FROM FALSE)
     ORDER BY l.nombre ASC`,
    [normalizedIds]
  );

  const map = new Map();
  result.rows.forEach((row) => {
    const key = Number(row.ual_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ documento: row.documento, nombre: row.nombre });
  });
  return map;
}

const requireFineInfoPageAccess = requireRoles(['admin', 'laboratorista', 'coordinador'], {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

// Historial y SGA son solo del estudiante consultado; los reutilizan la búsqueda y el regreso desde cada acción.
async function buildStudentSanctionPanel(req, { usuarioId, person }) {
  const activeResult = await pool.query(
    "SELECT COUNT(*) AS total FROM multa WHERE usuario_sancionado_id = $1 AND con_estado_multa = 'ACTIVA'",
    [usuarioId]
  );

  // Si el alcance del usuario no permite ver el historial, la pantalla sigue operativa con un aviso.
  let history = [];
  let historyError = '';
  const queryContext = await sanctionListHelpers.buildMultasQueryContext(
    { session: req.session, query: {} },
    pool
  );
  if (queryContext.error) {
    historyError = queryContext.error.message2 || queryContext.error.message;
  } else {
    const rows = await sanctionListHelpers.queryMultasRows(
      pool,
      [...queryContext.conditions, `m.usuario_sancionado_id = $${queryContext.params.length + 1}`],
      [...queryContext.params, usuarioId]
    );
    history = await sanctionListHelpers.addLaboratoristaActions(pool, rows, req);
  }

  const sga = { configured: sgaDebtService.isConfigured(), debts: [], failed: false };
  if (sga.configured) {
    try {
      sga.debts = await sgaDebtService.getActiveDebts({
        codigo: person.codigo,
        documento: person.documento,
      });
    } catch (error) {
      sga.failed = true;
      console.error('Error consultando sanciones SGA en Paso 2:', error);
    }
  }

  return {
    activeSanctionCount: Number(activeResult.rows[0]?.total || 0),
    history,
    historyError,
    sga,
  };
}

async function renderStudentSanctionActions(
  req,
  res,
  { lookupToken, person, usuarioId, successFeedback = null }
) {
  const panel = await buildStudentSanctionPanel(req, { usuarioId, person });
  const sanctionCategories = await fetchSanctionCategories({ client: pool });
  return res.render('home/sancion-person-actions', {
    lookupToken,
    personType: 'estudiante',
    person,
    activeSanctionCount: panel.activeSanctionCount,
    sanctionHistory: panel.history,
    sanctionHistoryError: panel.historyError,
    sanctionCategories,
    sga: panel.sga,
    sgaConfigured: panel.sga.configured,
    successFeedback,
  });
}

async function renderStudentSanctionRegistration(req, res, { lookupToken, person }) {
  const con_codigo = person.codigo;
  const con_estado = person.estado;
  const con_documento = person.documento;
  const con_carrera = person.programa;
  const con_nombre = person.nombre;
  const tipo_busqueda = '';

  if (con_estado === 'EGRESADO') {
    return res.render('home/alerta-egresado', {
      message: 'El estudiante es egresado. No se puede continuar.',
    });
  }

  let nombre_lab = '';
  let cc_lab = 0;
  let uals = '';
  if (req.session.user.tipo === 'laboratorista') {
    const sessionDocumento = req.session.user.documento_real || req.session.user.documento;
    const result = await pool.query(
      'SELECT * FROM laboratorista WHERE documento = $1 OR n_usuario = $1',
      [sessionDocumento]
    );
    if (!result.rows.length) {
      throw new Error('No se encontró laboratorista con ese documento');
    }

    const ualsResult = await pool.query(
      `SELECT DISTINCT
        u.ual_id,
        u.nombre,
        u.codigo_abreviacion,
        u.sal_id_espacio,
        u.sal_ocupantes,
        u.facultad_id
      FROM laboratorista_ual lu
      INNER JOIN ual u ON u.ual_id = lu.ual_id
      WHERE lu.laboratorista_documento_id = $1
        AND u.activo = TRUE
      ORDER BY u.nombre ASC`,
      [result.rows[0].documento]
    );
    nombre_lab = result.rows[0].nombre;
    cc_lab = result.rows[0].documento;
    uals = ualsResult.rows;
  } else if (req.session.user.tipo === 'admin') {
    nombre_lab = 'admin';
    const result = await pool.query(
      'SELECT ual_id, nombre, codigo_abreviacion, sal_id_espacio, sal_ocupantes, facultad_id FROM ual WHERE activo = TRUE ORDER BY nombre ASC'
    );
    uals = result.rows;
  } else if (req.session.user.tipo === 'coordinador') {
    const coordinatorResult = await pool.query('SELECT * FROM coordinador WHERE documento = $1', [
      req.session.user.documento,
    ]);
    const coordinator = coordinatorResult.rows[0];
    const facultyId = coordinator.facultad_id;
    const ualsResult = await pool.query(
      'SELECT ual_id, nombre, codigo_abreviacion, sal_id_espacio, sal_ocupantes, facultad_id FROM ual WHERE activo = TRUE AND facultad_id = $1 ORDER BY nombre ASC',
      [facultyId]
    );
    nombre_lab = coordinator.nombre;
    cc_lab = coordinator.documento;
    uals = ualsResult.rows;
  }

  if (Array.isArray(uals) && uals.length > 0) {
    const needsDelegateOptions =
      req.session.user.tipo === 'admin' || req.session.user.tipo === 'coordinador';
    const laboratoristasPorUal = needsDelegateOptions
      ? await fetchLaboratoristasByUalIds(uals.map((ual) => Number(ual.ual_id)))
      : new Map();
    uals = uals.map((ual) => ({
      ...ual,
      _laboratoristas: needsDelegateOptions
        ? laboratoristasPorUal.get(Number(ual.ual_id)) || []
        : [],
    }));
  } else if (uals === null) {
    uals = [];
  }

  return res.render('home/reg_multa', {
    lookupToken,
    sanctionCategories: await fetchSanctionCategories({ client: pool }),
    con_codigo,
    con_estado,
    con_documento,
    tipo_busqueda,
    con_carrera,
    con_nombre,
    nombre_lab,
    cc_lab,
    uals,
    SANCTION_TYPES,
  });
}

router.get('/get', requireFineInfoPageAccess, async function (req, res) {
  res.set('Cache-Control', 'no-store');
  res.render('home/get-info-multa');
});

router.get('/registrar', requireFineInfoPageAccess, async function (req, res) {
  res.set('Cache-Control', 'no-store');

  const lookupToken = String(req.query.lookup_token || '').trim();
  const person = resolveSanctionPersonLookup(req, lookupToken, 'estudiante');
  if (!person) {
    return res.render('home/error-consulta', {
      message: 'La búsqueda expiró o ya no está disponible. Busca nuevamente a la persona.',
    });
  }

  try {
    return await renderStudentSanctionRegistration(req, res, { lookupToken, person });
  } catch (error) {
    console.error(error);
    return res.render('home/error-consulta', {
      message: 'Se ha producido un error',
    });
  }
});

// Regreso a Paso 2 desde las acciones del listado; el token es el mismo de la búsqueda.
router.get('/persona', requireFineInfoPageAccess, async function (req, res) {
  res.set('Cache-Control', 'no-store');

  const lookupToken = String(req.query.lookup_token || '').trim();
  const person = resolveSanctionPersonLookup(req, lookupToken, 'estudiante');
  if (!person) {
    return res.render('home/error-consulta', {
      message: 'La búsqueda expiró o ya no está disponible. Busca nuevamente a la persona.',
    });
  }

  try {
    return await renderStudentSanctionActions(req, res, {
      lookupToken,
      person,
      usuarioId: person.usuarioId,
      successFeedback:
        String(req.query.success || '')
          .trim()
          .toLowerCase() === 'registrada'
          ? 'registrada'
          : sanctionListHelpers.normalizeListSuccessFeedback(req.query.success),
    });
  } catch (error) {
    console.error(error);
    return res.render('home/error-consulta', {
      message: 'Se ha producido un error',
    });
  }
});

router.post('/', requireFineInfoPageAccess, async function (req, res) {
  res.set('Cache-Control', 'no-store');

  const requestBody = req.body || {};
  const { tipo_busqueda, valor_busqueda } = requestBody;
  const lookupToken = String(requestBody.lookup_token || '').trim();
  const searchedPerson = lookupToken
    ? resolveSanctionPersonLookup(req, lookupToken, 'estudiante')
    : null;
  if (lookupToken && !searchedPerson) {
    return res.render('home/error-consulta', {
      message: 'La búsqueda expiró o ya no está disponible. Busca nuevamente a la persona.',
    });
  }
  if (searchedPerson) {
    return res.redirect(
      303,
      `/milab/api/get-info-multa/registrar?lookup_token=${encodeURIComponent(lookupToken)}`
    );
  }

  let con_codigo;
  let con_estado;
  let con_documento;
  let con_carrera;
  let con_nombre;
  let usuarioId;

  // Función para obtener la info del estudiante mediante CC segun consultas a la OAS
  try {
    if (!searchedPerson) {
      let servicePath;
      if (tipo_busqueda === 'codigo') {
        servicePath = getAcademicServicePath(`datos_basicos_estudiante/${valor_busqueda}`);
      } else {
        servicePath = getAcademicServicePath(`datos_basicos_activos_cedula/${valor_busqueda}`);
      }

      const dato1 = await requestOati(servicePath);
      const studentRecords = extractOasStudentRecords(dato1);
      if (!studentRecords.length) {
        throw new Error('Estudiante no encontrado en OAS');
      }

      const studentRecord = studentRecords[studentRecords.length - 1];

      con_codigo = studentRecord.codigo;
      con_estado = studentRecord.estado;
      con_documento =
        studentRecord.documento || studentRecord.numero_documento_identificacion || null;
      if (
        (!con_documento || con_documento === 'undefined' || con_documento === 'null') &&
        tipo_busqueda === 'documento'
      ) {
        con_documento = String(valor_busqueda || '').trim();
      }
      con_carrera = studentRecord.carrera;
      con_nombre = studentRecord.nombre;

      if (!con_documento || con_documento === 'undefined' || con_documento === 'null') {
        return res.render('home/error-consulta', {
          message: 'No se pudo resolver el documento del estudiante.',
        });
      }

      const dato2 = await requestOati(getAcademicServicePath(`estados_codigo/${con_estado}`));
      con_estado = dato2.estado.nombre;

      const dato3 = await requestOati(getAcademicServicePath(`carrera/${con_carrera}`));
      con_carrera = dato3.carrerasCollection.carrera[0].nombre;

      console.log('con_codigo ' + con_codigo);
      console.log('con_estado ' + con_estado);
      console.log('con_documento ' + con_documento);
      console.log('con_carrera ' + con_carrera);
      console.log('con_nombre ' + con_nombre);

      usuarioId = await ensurePerfilEstudiante({
        documento: con_documento,
        nombre: con_nombre,
        codigo: con_codigo,
        programa: con_carrera,
        estado: con_estado,
        correo: null,
      });

      if (!usuarioId) {
        return res.render('home/error-consulta', {
          message: 'No se pudo registrar el perfil del estudiante.',
        });
      }

      if (con_estado === 'EGRESADO') {
        console.log('El estudiante es egresado. No se puede continuar.');
        return res.render('home/alerta-egresado', {
          message: 'El estudiante es egresado. No se puede continuar.',
        });
      }

      const createdLookupToken = createSanctionPersonLookup(req, 'estudiante', {
        usuarioId,
        codigo: con_codigo,
        estado: con_estado,
        documento: con_documento,
        programa: con_carrera,
        nombre: con_nombre,
      });

      return res.redirect(303, buildSanctionPersonReturnPath(createdLookupToken));
    }

    return res.render('home/error-consulta', {
      message: 'No fue posible cargar la información del estudiante.',
    });
  } catch (error) {
    console.error(error);
    return res.render('home/error-consulta', {
      message: 'Se ha producido un error',
    });
  }
});

// Función para consultar multas asignadas al usuario

module.exports = router;
