const express = require('express');

const pool = require('../../libs/db');
const { getAcademicServicePath, requestOati } = require('../../libs/oati-client');
const { ensurePerfilDocente } = require('../../libs/user-identity');
const {
  buildSanctionPersonReturnPath,
  createSanctionPersonLookup,
  resolveSanctionPersonLookup,
} = require('../../libs/sanction-person-lookup');
const { requireRoles } = require('../middlewares/auth');
const { SANCTION_TYPES } = require('../../libs/multa-config');
// const { SANCTION_TYPES, fetchMultaConfigsForFacultyIds } = require('../../libs/multa-config');
const { fetchSanctionCategories } = require('../../libs/sanction-categories');

require('dotenv').config();

const router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: false }));

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

const requireTeacherFineInfoView = requireRoles(['admin', 'laboratorista', 'coordinador'], {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

async function renderTeacherSanctionActions(
  req,
  res,
  { lookupToken, person, successFeedback = null }
) {
  const activeSanctionsResult = await pool.query(
    "SELECT COUNT(*) AS total FROM multa WHERE usuario_sancionado_id = $1 AND con_estado_multa = 'ACTIVA'",
    [person.usuarioId]
  );

  return res.render('home/sancion-person-actions', {
    lookupToken,
    personType: 'docente',
    person,
    activeSanctionCount: Number(activeSanctionsResult.rows[0]?.total || 0),
    successFeedback,
  });
}

async function renderTeacherSanctionRegistration(req, res, { lookupToken, person }) {
  const con_estado = person.estado;
  const con_documento = person.documento;
  const con_nombre = person.nombre;

  if (con_estado === 'INACTIVO') {
    return res.render('home/message_error', {
      message: 'Docente inactivo',
      message2: 'No se puede continuar con la solicitud.',
      limit: null,
    });
  }

  let nombre_lab = '';
  let cc_lab;
  let uals;
  if (req.session.user.tipo === 'laboratorista') {
    const sessionDocumento = req.session.user.documento_real || req.session.user.documento;
    const laboratoristaResult = await pool.query(
      'SELECT * FROM laboratorista WHERE documento = $1 OR n_usuario = $1',
      [sessionDocumento]
    );
    if (!laboratoristaResult.rows.length) {
      throw new Error('No se encontró laboratorista con ese documento');
    }
    const ualsResult = await pool.query(
      'SELECT ual_id, nombre, codigo_abreviacion, sal_id_espacio, sal_ocupantes, facultad_id FROM ual WHERE activo = TRUE AND facultad_id = $1 ORDER BY nombre ASC',
      [laboratoristaResult.rows[0].facultad_id]
    );
    nombre_lab = laboratoristaResult.rows[0].nombre;
    cc_lab = laboratoristaResult.rows[0].documento;
    uals = ualsResult.rows;
  } else if (req.session.user.tipo === 'admin') {
    nombre_lab = 'admin';
    cc_lab = 0;
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

  return res.render('home/reg_multa_docente', {
    lookupToken,
    sanctionCategories: await fetchSanctionCategories({ client: pool }),
    con_estado,
    con_documento,
    con_nombre,
    nombre_lab,
    cc_lab,
    uals,
    SANCTION_TYPES,
  });
}

router.get('/get', requireTeacherFineInfoView, async function (req, res) {
  res.set('Cache-Control', 'no-store');
  res.render('home/get-info-multa-docente');
});

router.get('/persona', requireTeacherFineInfoView, async function (req, res) {
  res.set('Cache-Control', 'no-store');

  const lookupToken = String(req.query.lookup_token || '').trim();
  const person = resolveSanctionPersonLookup(req, lookupToken, 'docente');
  if (!person) {
    return res.render('home/error-consulta', {
      message: 'La búsqueda expiró o ya no está disponible. Busca nuevamente a la persona.',
    });
  }

  try {
    const successFeedback =
      String(req.query.success || '')
        .trim()
        .toLowerCase() === 'registrada'
        ? 'registrada'
        : null;
    return await renderTeacherSanctionActions(req, res, {
      lookupToken,
      person,
      successFeedback,
    });
  } catch (error) {
    console.error(error);
    return res.render('home/error-consulta', {
      message: 'Se ha producido un error',
    });
  }
});

router.get('/registrar', requireTeacherFineInfoView, async function (req, res) {
  res.set('Cache-Control', 'no-store');

  const lookupToken = String(req.query.lookup_token || '').trim();
  const person = resolveSanctionPersonLookup(req, lookupToken, 'docente');
  if (!person) {
    return res.render('home/error-consulta', {
      message: 'La búsqueda expiró o ya no está disponible. Busca nuevamente a la persona.',
    });
  }

  try {
    return await renderTeacherSanctionRegistration(req, res, { lookupToken, person });
  } catch (error) {
    console.error(error);
    return res.render('home/error-consulta', {
      message: 'Se ha producido un error',
    });
  }
});

router.post('/', requireTeacherFineInfoView, async function (req, res) {
  res.set('Cache-Control', 'no-store');

  const requestBody = req.body || {};
  const lookupToken = String(requestBody.lookup_token || '').trim();
  const searchedPerson = lookupToken
    ? resolveSanctionPersonLookup(req, lookupToken, 'docente')
    : null;
  if (lookupToken && !searchedPerson) {
    return res.render('home/error-consulta', {
      message: 'La búsqueda expiró o ya no está disponible. Busca nuevamente a la persona.',
    });
  }
  if (searchedPerson) {
    return res.redirect(
      303,
      `/milab/api/get-info-multa-docente/registrar?lookup_token=${encodeURIComponent(lookupToken)}`
    );
  }

  const { numero_documento_identificacion } = requestBody;
  let con_estado;
  let con_documento;
  let con_nombre;
  let usuarioId;

  try {
    if (!searchedPerson) {
      const dato1 = await requestOati(
        getAcademicServicePath(`consultar_estado_docente/${numero_documento_identificacion}`)
      );

      console.log('Respuesta completa desde OAS:');
      console.log(JSON.stringify(dato1, null, 2));

      if (
        !dato1 ||
        !dato1.docentesCollection ||
        !dato1.docentesCollection.docente ||
        dato1.docentesCollection.docente.length === 0
      ) {
        return res.render('home/error-consulta', {
          message: 'No se encontraron datos del docente con el documento ingresado.',
        });
      }

      const docenteData = dato1.docentesCollection.docente[0];
      con_estado = docenteData.estado_docente;
      con_documento = numero_documento_identificacion;
      con_nombre = docenteData.nombre;

      console.log('con_estado ' + con_estado);
      console.log('con_documento ' + con_documento);
      console.log('con_nombre ' + con_nombre);

      usuarioId = await ensurePerfilDocente({
        documento: con_documento,
        nombre: con_nombre,
        estado: con_estado,
        correo: null,
      });

      if (!usuarioId) {
        return res.render('home/error-consulta', {
          message: 'No se pudo registrar el perfil del docente.',
        });
      }

      if (con_estado === 'INACTIVO') {
        console.log('El docente esta inactivo. No se puede continuar.');
        return res.render('home/message_error', {
          message: 'Docente inactivo',
          message2: 'No se puede continuar con la solicitud.',
          limit: null,
        });
      }

      const createdLookupToken = createSanctionPersonLookup(req, 'docente', {
        usuarioId,
        estado: con_estado,
        documento: con_documento,
        nombre: con_nombre,
      });

      return res.redirect(303, buildSanctionPersonReturnPath(createdLookupToken, '', 'docente'));
    }

    return res.render('home/error-consulta', {
      message: 'No fue posible cargar la información del docente.',
    });
  } catch (error) {
    console.error('Error durante la consulta o procesamiento:', error);
    return res.render('home/error-consulta', {
      message: 'Se ha producido un error',
    });
  }
});

module.exports = router;
