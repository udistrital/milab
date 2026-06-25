const express = require('express');

const pool = require('../../libs/db');
const { getAcademicServicePath, requestOati } = require('../../libs/oati-client');
const { ensurePerfilEstudiante } = require('../../libs/user-identity');
const { requireRoles } = require('../middlewares/auth');

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

const requireLaboratoristaFineInfoView = requireRoles('laboratorista', {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

router.get('/get', requireLaboratoristaFineInfoView, async function (req, res) {
  res.set('Cache-Control', 'no-store');
  res.render('home/get-info-multa');
});

router.post('/', requireLaboratoristaFineInfoView, async function (req, res) { // NOSONAR - legacy flow kept for compatibility
  res.set('Cache-Control', 'no-store');

  const requestBody = req.body || {};
  const { tipo_busqueda, valor_busqueda } = requestBody;
  let con_codigo;
  let con_estado;
  let con_documento;
  let con_carrera;
  let con_nombre;

  // Función para obtener la info del estudiante mediante CC segun consultas a la OAS
  try {
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

    const usuarioId = await ensurePerfilEstudiante({
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

    //--- DB
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

    //DATOS LAB
    let nombre_lab = '';
    let cc_lab = 0;
    let uals = '';
    if (req.session.user.tipo === 'laboratorista') {
      const sessionDocumento = req.session.user.documento_real || req.session.user.documento;
      const query2 = 'SELECT * FROM laboratorista WHERE documento = $1 OR n_usuario = $1';
      const values2 = [sessionDocumento];
      const result2 = await pool.query(query2, values2);
      if (result2.rows.length === 0) {
        throw new Error('No se encontró laboratorista con ese documento');
      }
      const query3 =
        'SELECT ual_id, nombre, codigo_abreviacion, sal_id_espacio, sal_ocupantes FROM ual WHERE activo = TRUE AND facultad_id = $1 ORDER BY nombre ASC';
      const values3 = [result2.rows[0].facultad_id];
      const result3 = await pool.query(query3, values3);
      nombre_lab = result2.rows[0].nombre;
      cc_lab = result2.rows[0].documento;
      uals = result3.rows;
    } else if (req.session.user.tipo === 'admin') {
      nombre_lab = 'admin';
      uals = null;
    } else if (req.session.user.tipo === 'coordinador') {
      const query = 'SELECT * FROM coordinador WHERE documento = $1';
      const values = [req.session.user.documento];
      const result = await pool.query(query, values);

      const facultadId = result.rows[0].facultad_id;
      const queryUals =
        'SELECT ual_id, nombre, codigo_abreviacion, sal_id_espacio, sal_ocupantes FROM ual WHERE activo = TRUE AND facultad_id = $1 ORDER BY nombre ASC';
      const resultUals = await pool.query(queryUals, [facultadId]);

      nombre_lab = result.rows[0].nombre;
      cc_lab = result.rows[0].documento;
      uals = resultUals.rows;
    }

    if (con_estado === 'EGRESADO') {
      console.log('El estudiante es egresado. No se puede continuar.');
      return res.render('home/alerta-egresado', {
        message: 'El estudiante es egresado. No se puede continuar.',
      });
    }

    return res.render('home/reg_multa', {
      con_codigo,
      con_estado,
      con_documento,
      tipo_busqueda,
      con_carrera,
      con_nombre,
      nombre_lab,
      cc_lab,
      uals,
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
