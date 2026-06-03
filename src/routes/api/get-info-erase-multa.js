const express = require('express');

const pool = require('../../libs/db');
const { getAcademicServicePath, requestOati } = require('../../libs/oati-client');
const { ensurePerfilEstudiante } = require('../../libs/user-identity');
const { requireRoles } = require('../middlewares/auth');

require('dotenv').config();

var router = express.Router();

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

const requireLaboratoristaEraseAccess = requireRoles('laboratorista', {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

router.post('/', requireLaboratoristaEraseAccess, async function (req, res) {
  res.set('Cache-Control', 'no-store');

  const requestBody = req.body || {};
  const { tipo_busqueda, valor_busqueda } = requestBody;

  let con_codigo, con_estado, con_documento, con_carrera, con_nombre;
  let multaInfo;

  try {
    // Consulta 1 - Datos básicos del estudiante
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

    // Consulta 2 - Estado académico
    const estadoData = await requestOati(getAcademicServicePath(`estados_codigo/${con_estado}`));
    con_estado = estadoData.estado.nombre;

    // Consulta 3 - Carrera
    const carreraData = await requestOati(getAcademicServicePath(`carrera/${con_carrera}`));
    con_carrera = carreraData.carrerasCollection.carrera[0].nombre;

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

    const query =
      "SELECT COUNT(*) AS multado FROM multa WHERE usuario_id_sancionado = $1 AND con_estado_multa = 'ACTIVA'";
    const values = [usuarioId];
    const result = await pool.query(query, values);

    if (result.rows[0].multado > 0) {
      const queryMultaInfo =
        "SELECT m.*, us.documento AS documento_sancionado, u.nombre AS ual, l.nombre AS nombre_laboratorista, l.documento AS cc_laboratorista FROM multa m LEFT JOIN usuario us ON us.id = m.usuario_id_sancionado LEFT JOIN ual u ON u.ual_id = m.ual_id LEFT JOIN laboratorista l ON l.documento = m.documento_laboratorista WHERE m.usuario_id_sancionado = $1 AND m.con_estado_multa = 'ACTIVA'";
      const valuesMultaInfo = [usuarioId];
      const resultMultaInfo = await pool.query(queryMultaInfo, valuesMultaInfo);
      multaInfo = resultMultaInfo.rows;

      console.log(`Cantidad de multas activas encontradas para retiro: ${multaInfo.length}`);
      console.log(multaInfo);
      // ...existing code...
    } else {
      console.log('El estudiante no tiene multas activas.');
      return res.render('home/alerta-no-multado', {
        message: 'El estudiante no tiene multas activas.',
      });
    }

    // Verificar si es egresado
    if (con_estado === 'EGRESADO') {
      console.log('El estudiante es egresado. No se puede continuar.');
      return res.render('home/alerta-egresado', {
        message: 'El estudiante es egresado. No se puede continuar.',
      });
    }

    // Renderizar vista con datos
    return res.render('home/reg_multa_erase', {
      con_codigo,
      con_estado,
      con_documento,
      con_carrera,
      con_nombre,
      multaInfo,
    });
  } catch (error) {
    console.error('Error durante la consulta:', error);
    return res.render('home/error-consulta', {
      message: 'Se ha producido un error',
    });
  }
});

module.exports = router;
