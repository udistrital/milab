const axios = require('axios');
const express = require('express');

const pool = require('../../libs/db');
const { requireRoles } = require('../middlewares/auth');

require('dotenv').config();

var router = express.Router();

const requireTeacherFineInfoView = requireRoles(['admin', 'laboratorista'], {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

const requireTeacherFineInfoAction = requireRoles('laboratorista', {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

router.get('/get', requireTeacherFineInfoView, async function (req, res) {
  res.set('Cache-Control', 'no-store');
  res.render('home/get-info-multa-docente');
});

router.post('/', requireTeacherFineInfoAction, async function (req, res) {
  res.set('Cache-Control', 'no-store');

  const { numero_documento_identificacion } = req.body;
  var con_estado;
  var con_documento;
  var con_nombre;
  // let con_multado = false;
  // let con_estado_multa = false; // - Estado de la multa

  try {
    const respuesta1 = await axios.get(
      'https://autenticacion.portaloas.udistrital.edu.co/wso2eiserver/services/servicios_academicos_produccion/consultar_estado_docente/' +
        numero_documento_identificacion
    );
    const dato1 = respuesta1.data;

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

    // --- Base de datos
    const query = 'SELECT COUNT(*) AS multado FROM multas WHERE cod_multado = $1';
    const values = [con_documento];
    let con_multado = false;
    const result = await pool.query(query, values);
    con_multado = result.rows[0].multado > 0;

    let multaInfo = null;
    if (con_multado) {
      const queryMultaInfo = 'SELECT * FROM multas WHERE cod_multado = $1';
      const valuesMultaInfo = [con_documento];
      const resultMultaInfo = await pool.query(queryMultaInfo, valuesMultaInfo);
      multaInfo = resultMultaInfo.rows;
      console.log(`Cantidad de registros de multas: ${multaInfo.length}`);
      console.log(multaInfo);
    }

    let nombre_lab = '';
    let cc_lab = 0;
    let uals = '';

    if (req.session.user.tipo === 'laboratorista') {
      const query2 = 'SELECT * FROM laboratorista WHERE n_usuario = $1';
      const values2 = [req.session.user.documento];
      const result2 = await pool.query(query2, values2);

      if (result2.rows.length === 0) {
        throw new Error('No se encontró laboratorista con ese n_usuario');
      }

      const query3 = 'SELECT * FROM ual WHERE id_facultad = $1';
      const values3 = [result2.rows[0].id_facultad];
      const result3 = await pool.query(query3, values3);

      nombre_lab = result2.rows[0].nombre;
      cc_lab = result2.rows[0].documento;
      uals = result3.rows;
      var n_usuario = result2.rows[0].n_usuario;
    } else if (req.session.user.tipo === 'admin') {
      nombre_lab = 'admin';
      cc_lab = 0;
      uals = null;
    } else if (req.session.user.tipo === 'coordinador') {
      const query = 'SELECT * FROM coordinador_laboratorio WHERE documento = $1';
      const values = [req.session.user.documento];
      const result = await pool.query(query, values);

      const id_facultad = result.rows[0].id_facultad;
      const queryUals = 'SELECT * FROM ual WHERE id_facultad = $1';
      const resultUals = await pool.query(queryUals, [id_facultad]);

      nombre_lab = result.rows[0].nombre;
      cc_lab = result.rows[0].documento;
      uals = resultUals.rows;
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
      n_usuario,
    });
  } catch (error) {
    console.error('Error durante la consulta o procesamiento:', error);
    return res.render('home/error-consulta', {
      message: 'Se ha producido un error',
    });
  }
});

module.exports = router;
