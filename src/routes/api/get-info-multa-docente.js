const express = require('express');

const pool = require('../../libs/db');
const { getAcademicServicePath, requestOati } = require('../../libs/oati-client');
const { ensurePerfilDocente } = require('../../libs/user-identity');
const { requireRoles } = require('../middlewares/auth');
const { SANCTION_TYPES, fetchMultaConfigsForFacultyIds } = require('../../libs/multa-config');

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

router.get('/get', requireTeacherFineInfoView, async function (req, res) {
  res.set('Cache-Control', 'no-store');
  res.render('home/get-info-multa-docente');
});

router.post('/', requireTeacherFineInfoView, async function (req, res) {
  res.set('Cache-Control', 'no-store');

  const requestBody = req.body || {};
  const { numero_documento_identificacion } = requestBody;
  let con_estado;
  let con_documento;
  let con_nombre;

  try {
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

    const usuarioId = await ensurePerfilDocente({
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

    const query = 'SELECT COUNT(*) AS multado FROM multa WHERE usuario_sancionado_id = $1';
    const values = [usuarioId];
    let con_multado = false;
    const result = await pool.query(query, values);
    con_multado = result.rows[0].multado > 0;

    let multaInfo = null;
    if (con_multado) {
      const queryMultaInfo =
        'SELECT m.*, us.documento AS documento_sancionado, u.nombre AS ual, l.nombre AS nombre_laboratorista, l.documento AS cc_laboratorista FROM multa m LEFT JOIN usuario us ON us.id = m.usuario_sancionado_id LEFT JOIN ual u ON u.ual_id = m.ual_id LEFT JOIN laboratorista l ON l.documento = m.laboratorista_documento_id WHERE m.usuario_sancionado_id = $1';
      const valuesMultaInfo = [usuarioId];
      const resultMultaInfo = await pool.query(queryMultaInfo, valuesMultaInfo);
      multaInfo = resultMultaInfo.rows;
      console.log(`Cantidad de registros de multas: ${multaInfo.length}`);
      console.log(multaInfo);
    }

    let nombre_lab = '';
    let cc_lab;
    let uals;

    if (req.session.user.tipo === 'laboratorista') {
      const sessionDocumento = req.session.user.documento_real || req.session.user.documento;
      const query2 = 'SELECT * FROM laboratorista WHERE documento = $1 OR n_usuario = $1';
      const values2 = [sessionDocumento];
      const result2 = await pool.query(query2, values2);

      if (result2.rows.length === 0) {
        throw new Error('No se encontró laboratorista con ese documento');
      }

      const query3 =
        'SELECT ual_id, nombre, codigo_abreviacion, sal_id_espacio, sal_ocupantes, facultad_id FROM ual WHERE activo = TRUE AND facultad_id = $1 ORDER BY nombre ASC';
      const values3 = [result2.rows[0].facultad_id];
      const result3 = await pool.query(query3, values3);

      nombre_lab = result2.rows[0].nombre;
      cc_lab = result2.rows[0].documento;
      uals = result3.rows;
    } else if (req.session.user.tipo === 'admin') {
      nombre_lab = 'admin';
      cc_lab = 0;
      const queryUalsTodas =
        'SELECT ual_id, nombre, codigo_abreviacion, sal_id_espacio, sal_ocupantes, facultad_id FROM ual WHERE activo = TRUE ORDER BY nombre ASC';
      const resultAdminUals = await pool.query(queryUalsTodas);
      uals = resultAdminUals.rows;
    } else if (req.session.user.tipo === 'coordinador') {
      const query = 'SELECT * FROM coordinador WHERE documento = $1';
      const values = [req.session.user.documento];
      const result = await pool.query(query, values);

      const facultadId = result.rows[0].facultad_id;
      const queryUals =
        'SELECT ual_id, nombre, codigo_abreviacion, sal_id_espacio, sal_ocupantes, facultad_id FROM ual WHERE activo = TRUE AND facultad_id = $1 ORDER BY nombre ASC';
      const resultUals = await pool.query(queryUals, [facultadId]);

      nombre_lab = result.rows[0].nombre;
      cc_lab = result.rows[0].documento;
      uals = resultUals.rows;
    }

    if (Array.isArray(uals) && uals.length > 0) {
      const facultyIds = [
        ...new Set(uals.map((u) => Number(u.facultad_id)).filter((n) => Number.isFinite(n))),
      ];
      const configMap = await fetchMultaConfigsForFacultyIds(facultyIds);
      const needsDelegateOptions =
        req.session.user.tipo === 'admin' || req.session.user.tipo === 'coordinador';
      const laboratoristasPorUal = needsDelegateOptions
        ? await fetchLaboratoristasByUalIds(uals.map((u) => Number(u.ual_id)))
        : new Map();
      uals = uals.map((u) => {
        const cfg = Number.isFinite(Number(u.facultad_id))
          ? configMap.get(Number(u.facultad_id))
          : null;
        return {
          ...u,
          _permiteCrearActivaDirecta: Boolean(cfg && cfg.permite_crear_multas_activas_directas),
          _laboratoristas: needsDelegateOptions
            ? laboratoristasPorUal.get(Number(u.ual_id)) || []
            : [],
        };
      });
    } else if (uals === null) {
      uals = [];
    }

    if (con_estado === 'INACTIVO') {
      console.log('El docente esta inactivo. No se puede continuar.');
      return res.render('home/message_error', {
        message: 'Docente inactivo',
        message2: 'No se puede continuar con la solicitud.',
        limit: null,
      });
    }

    return res.render('home/reg_multa_docente', {
      con_estado,
      con_documento,
      con_nombre,
      nombre_lab,
      cc_lab,
      uals,
      multaInfo,
      SANCTION_TYPES,
    });
  } catch (error) {
    console.error('Error durante la consulta o procesamiento:', error);
    return res.render('home/error-consulta', {
      message: 'Se ha producido un error',
    });
  }
});

module.exports = router;
