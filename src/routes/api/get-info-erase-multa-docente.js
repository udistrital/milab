const axios = require('axios');
const express = require('express');

const pool = require('../../libs/db');
const { requireRoles } = require('../middlewares/auth');

require('dotenv').config();

var router = express.Router();

const requireLaboratoristaTeacherEraseAccess = requireRoles('laboratorista', {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

router.post('/', requireLaboratoristaTeacherEraseAccess, async function (req, res) {
  res.set('Cache-Control', 'no-store');

  const { numero_documento_identificacion } = req.body;
  let con_estado;
  let con_documento;
  let con_nombre;

  try {
    // Consulta al OAS
    const respuesta1 = await axios.get(
      'https://autenticacion.portaloas.udistrital.edu.co/wso2eiserver/services/servicios_academicos_produccion/consultar_estado_docente/' +
        numero_documento_identificacion
    );
    const dato1 = respuesta1.data;

    const docenteData = dato1.docentesCollection.docente[0];
    con_estado = docenteData.estado_docente;
    con_documento = numero_documento_identificacion;
    con_nombre = docenteData.nombre;

    console.log('con_estado ' + con_estado);
    console.log('con_documento ' + con_documento);
    console.log('con_nombre ' + con_nombre);

    // Consulta solo multas ACTIVAS
    const query =
      'SELECT COUNT(*) AS multado FROM multas WHERE cod_multado = $1 AND con_estado_multa = $2';
    const values = [con_documento, 'ACTIVA'];

    const result = await pool.query(query, values);
    const con_multado = result.rows[0].multado > 0;

    let multaInfo = null;
    if (con_multado) {
      const queryMultaInfo =
        'SELECT * FROM multas WHERE cod_multado = $1 AND con_estado_multa = $2';
      const valuesMultaInfo = [con_documento, 'ACTIVA'];
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
