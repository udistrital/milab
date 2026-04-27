const axios = require('axios');
const express = require('express');

const pool = require('../../libs/db');
const { requireRoles } = require('../middlewares/auth');

// Variables de entorno
require('dotenv').config();

var router = express.Router();

const requireLaboratoristaFineInfoView = requireRoles('laboratorista', {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

router.get('/get', requireLaboratoristaFineInfoView, async function (req, res) {
  res.set('Cache-Control', 'no-store');
  res.render('home/get-info-multa');
});

router.post('/', requireLaboratoristaFineInfoView, async function (req, res) {
  res.set('Cache-Control', 'no-store');

  const { tipo_busqueda, valor_busqueda } = req.body;
  var con_codigo;
  var con_estado;
  var con_documento;
  var con_carrera;
  var con_nombre;
  // let con_multado = false; // Inicialmente asumimos que no está multado

  // Función para obtener la info del estudiante mediante CC segun consultas a la OAS
  try {
    let urlBase;
    if (tipo_busqueda === 'codigo') {
      urlBase =
        'https://autenticacion.portaloas.udistrital.edu.co/wso2eiserver/services/servicios_academicos_produccion/datos_basicos_estudiante/' +
        valor_busqueda;
    } else {
      urlBase =
        'https://autenticacion.portaloas.udistrital.edu.co/wso2eiserver/services/servicios_academicos_produccion/datos_basicos_activos_cedula/' +
        valor_busqueda;
    }

    const respuesta1 = await axios.get(urlBase);
    const dato1 = respuesta1.data; // Obtener los datos de la respuesta 1
    // const dataString = JSON.stringify(dato1, null, 2);
    var cant_carreras = dato1.datosEstudianteCollection.datosBasicosEstudiante.length;

    con_codigo = dato1.datosEstudianteCollection.datosBasicosEstudiante[cant_carreras - 1].codigo;
    con_estado = dato1.datosEstudianteCollection.datosBasicosEstudiante[cant_carreras - 1].estado;
    con_documento =
      dato1.datosEstudianteCollection.datosBasicosEstudiante[cant_carreras - 1]
        .numero_documento_identificacion;
    con_carrera = dato1.datosEstudianteCollection.datosBasicosEstudiante[cant_carreras - 1].carrera;
    con_nombre = dato1.datosEstudianteCollection.datosBasicosEstudiante[cant_carreras - 1].nombre;

    // La API OAS no devuelve numero_documento_identificacion, usar el valor de búsqueda original
    if (!con_documento || con_documento === 'undefined' || con_documento === 'null') {
      con_documento = String(valor_busqueda || '');
    }

    const respuesta2 = await axios.get(
      'https://autenticacion.portaloas.udistrital.edu.co/wso2eiserver/services/servicios_academicos_produccion/estados_codigo/' +
        con_estado
    );
    const dato2 = respuesta2.data; // Obtener los datos de la respuesta 2
    con_estado = dato2.estado.nombre;

    const respuesta3 = await axios.get(
      'https://autenticacion.portaloas.udistrital.edu.co/wso2eiserver/services/servicios_academicos_produccion/carrera/' +
        con_carrera
    );
    const dato3 = respuesta3.data; // Obtener los datos de la respuesta 3
    con_carrera = dato3.carrerasCollection.carrera[0].nombre;

    console.log('con_codigo ' + con_codigo);
    console.log('con_estado ' + con_estado);
    console.log('con_documento ' + con_documento);
    console.log('con_carrera ' + con_carrera);
    console.log('con_nombre ' + con_nombre);

    //--- DB
    // Buscar multas por CÓDIGO Y DOCUMENTO (para capturar cualquiera de ambas)
    const sanctionKeys = [
      String(con_codigo || '').trim(),
      String(con_documento || '').trim(),
    ].filter(Boolean);
    const query =
      'SELECT COUNT(*) AS multado FROM multas WHERE cod_multado::text = ANY($1::text[])';
    const values = [sanctionKeys];

    let con_multado = false;
    const result = await pool.query(query, values);
    con_multado = result.rows[0].multado > 0;

    let multaInfo = null;
    if (con_multado) {
      const queryMultaInfo = 'SELECT * FROM multas WHERE cod_multado::text = ANY($1::text[])';
      const valuesMultaInfo = [sanctionKeys];

      const resultMultaInfo = await pool.query(queryMultaInfo, valuesMultaInfo);
      multaInfo = resultMultaInfo.rows;
      console.log(`Cantidad de registros de multas: ${multaInfo.length}`);
      console.log(multaInfo);
    }

    //DATOS LAB
    var nombre_lab = '';
    var cc_lab = 0;
    var uals = '';
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
      con_carrera,
      con_nombre,
      nombre_lab,
      cc_lab,
      uals,
      n_usuario,
    });

    // Guardar en la base de datos la solicitud de certificado

    //let data_to_submit = {nombre:con_nombre, cc:con_documento, codigo:con_codigo, programa:con_carrera, estado_estudiante:con_estado, fecha_creacion: con_fecha, fecha_vencimiento: fechaVencimiento, id_certificado:uniqueId, correo: "correo", multa:con_multado};
    //submit_data(data_to_submit);
  } catch (error) {
    console.error(error);
    return res.render('home/error-consulta', {
      message: 'Se ha producido un error',
    });
  }
});

// Función para consultar multas asignadas al usuario

module.exports = router;
