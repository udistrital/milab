const express = require('express');

const pool = require('../../libs/db');
const { getAcademicServicePath, requestOati } = require('../../libs/oati-client');
const { ensurePerfilDocente } = require('../../libs/user-identity');
const { requireRoles } = require('../middlewares/auth');

require('dotenv').config();

var router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: false }));

const requireLaboratoristaTeacherEraseAccess = requireRoles('laboratorista', {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

router.post('/', requireLaboratoristaTeacherEraseAccess, async function (req, res) {
  res.set('Cache-Control', 'no-store');

  const requestBody = req.body || {};
  const { numero_documento_identificacion } = requestBody;
  let con_estado;
  let con_documento;
  let con_nombre;

  try {
    // Consulta al OAS
    const dato1 = await requestOati(
      getAcademicServicePath(`consultar_estado_docente/${numero_documento_identificacion}`)
    );

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

    // Consulta solo multas ACTIVAS
    const query =
      'SELECT COUNT(*) AS multado FROM multa WHERE usuario_sancionado_id = $1 AND con_estado_multa = $2';
    const values = [usuarioId, 'ACTIVA'];

    const result = await pool.query(query, values);
    const con_multado = result.rows[0].multado > 0;

    let multaInfo = null;
    if (con_multado) {
      const queryMultaInfo =
        'SELECT m.*, us.documento AS documento_sancionado, u.nombre AS ual, l.nombre AS nombre_laboratorista, l.documento AS cc_laboratorista FROM multa m LEFT JOIN usuario us ON us.id = m.usuario_sancionado_id LEFT JOIN ual u ON u.ual_id = m.ual_id LEFT JOIN laboratorista l ON l.documento = m.laboratorista_documento_id WHERE m.usuario_sancionado_id = $1 AND m.con_estado_multa = $2';
      const valuesMultaInfo = [usuarioId, 'ACTIVA'];
      const resultMultaInfo = await pool.query(queryMultaInfo, valuesMultaInfo);
      multaInfo = resultMultaInfo.rows;

      console.log(`Cantidad de registros de multas ACTIVAS: ${multaInfo.length}`);
      console.log(multaInfo);
    } else {
      console.log('El docente no tiene multas activas');
      return res.render('home/alerta-no-multado', {
        message: 'El docente no tiene multas activas.',
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

    return res.render('home/reg_multa_erase_docente', {
      con_documento,
      con_estado,
      con_nombre,
      multaInfo,
    });
  } catch (error) {
    console.error(error);
    return res.render('home/error-consulta', {
      message: 'Se ha producido un error',
    });
  }
});

module.exports = router;
