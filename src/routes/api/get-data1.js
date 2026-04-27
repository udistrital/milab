const axios = require('axios');
const express = require('express');

const pool = require('../../libs/db');
const { verifyRecaptchaToken } = require('../../libs/recaptcha');
const limiter = require('../middlewares/limiter');
const { requireRoles } = require('../middlewares/auth');

// Variables de entorno
require('dotenv').config();

const secretKey = process.env.RECAPTCHA_SECRET_KEY;

var router = express.Router();

const requireStudentSelfServiceAccess = requireRoles(['admin', 'estudiante'], {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

async function resolveStudentEmailForSession(documento, codigo) {
  const codigoParam = codigo ? String(codigo) : null;

  const result = await pool.query(
    `
      SELECT correo
      FROM (
        SELECT u.correo, 1 AS priority
        FROM usuario u
        WHERE u.documento = $1::text
          OR ($2::text IS NOT NULL AND u.codigo::text = $2::text)

        UNION ALL

        SELECT a.correo, 2 AS priority
        FROM auth a
        WHERE a.documento = $1::text

        UNION ALL

        SELECT e.correo, 3 AS priority
        FROM estudiante e
          WHERE e.cc::text = $1::text
            OR ($2::text IS NOT NULL AND e.codigo::text = $2::text)
      ) candidates
      WHERE correo IS NOT NULL
        AND correo <> ''
      ORDER BY priority
      LIMIT 1
    `,
    [documento, codigoParam]
  );

  return result.rows[0]?.correo || '';
}

router.get('/verificacion', requireStudentSelfServiceAccess, async function (req, res) {
  res.set('Cache-Control', 'no-store');
  console.log('sesion: ' + req.session.user.documento);
  var con_codigo = 0;

  const query1 =
    'SELECT documento, nombre, codigo, estado, carrera, correo FROM usuario WHERE documento = $1';
  const values1 = [req.session.user.documento];
  const result1 = await pool.query(query1, values1);
  const profileRow = result1.rows[0] || {};

  if (req.session.user.tipo === 'estudiante') {
    con_codigo = profileRow.codigo || 0;
  }

  console.log('Resultado query: ' + con_codigo);

  const sanctionKeys = [
    String(req.session.user.documento || '').trim(),
    String(con_codigo || '').trim(),
  ].filter(Boolean);
  const query =
    "SELECT COUNT(*) AS multado FROM multas WHERE cod_multado::text = ANY($1::text[]) AND con_estado_multa='ACTIVA'";
  const values = [sanctionKeys];

  const result = await pool.query(query, values);
  const con_multado = result.rows[0].multado > 0;

  let multaInfo = null;
  if (con_multado) {
    const queryMultaInfo =
      "SELECT * FROM multas WHERE cod_multado::text = ANY($1::text[]) AND con_estado_multa='ACTIVA'";
    const valuesMultaInfo = [sanctionKeys];

    const resultMultaInfo = await pool.query(queryMultaInfo, valuesMultaInfo);
    multaInfo = resultMultaInfo.rows;
    console.log(`Cantidad de registros de multas: ${multaInfo.length}`);
    console.log(multaInfo);
  }
  if (con_multado) {
    console.log('El estudiante es multado. No se puede continuar.');
    return res.render('home/alerta-multado', { multaInfo });
  } else {
    const resolvedCorreo = await resolveStudentEmailForSession(
      req.session.user.documento,
      con_codigo
    );

    return res.render('home/get-info2', {
      correo: resolvedCorreo || profileRow.correo || '',
      tipo: req.session.user?.tipo,
      nombre: profileRow.nombre || req.session.user?.nombre || '',
      documento:
        profileRow.documento || req.session.user?.documento_real || req.session.user?.documento,
      carrera: profileRow.carrera || '',
      estado: profileRow.estado || '',
      codigo: profileRow.codigo || '',
    });
  }
});

router.post('/', limiter, async function (req, res) {
  const { numero_documento_identificacion, 'g-recaptcha-response': recaptchaResponse } = req.body;

  // Validar reCAPTCHA
  if (!recaptchaResponse) {
    return res.render('home/register_2', {
      error: 'Por favor completa el reCAPTCHA.',
      confirmacion: null,
      selectedType: 'estudiante',
    });
  }

  try {
    const recaptchaData = await verifyRecaptchaToken({
      secretKey,
      token: recaptchaResponse,
    });

    if (!recaptchaData.success) {
      return res.render('home/register_2', {
        error: 'No se pudo verificar el reCAPTCHA.',
        confirmacion: null,
        selectedType: 'estudiante',
      });
    }
  } catch (error) {
    console.error('Error verificando reCAPTCHA:', error);
    return res.render('home/register_2', {
      error: 'Error al verificar reCAPTCHA.',
      confirmacion: null,
      selectedType: 'estudiante',
    });
  }
  var con_codigo;
  var con_estado;
  var con_documento;
  var con_carrera;
  var con_nombre;
  // con_multado removed (was unused)

  const query1 = 'SELECT * FROM usuario WHERE documento = $1';
  const values1 = [numero_documento_identificacion];
  const result1 = await pool.query(query1, values1);

  if (result1.rows[0]) {
    res.render('home/message_error', {
      message: 'Datos inválidos. Verifica la información e inténtalo nuevamente.',
      message2: 'Revisa los datos ingresados',
      limit: null,
    });
  }
  // Función para obtener la info del estudiante mediante CC segun consultas a la OAS
  try {
    const respuesta1 = await axios.get(
      'https://autenticacion.portaloas.udistrital.edu.co/wso2eiserver/services/servicios_academicos_produccion/datos_basicos_activos_cedula/' +
        numero_documento_identificacion
    );
    const dato1 = respuesta1.data; // Obtener los datos de la respuesta 1
    // dataString removed (was unused)
    var cant_carreras = dato1.datosEstudianteCollection.datosBasicosEstudiante.length;

    con_codigo = dato1.datosEstudianteCollection.datosBasicosEstudiante[cant_carreras - 1].codigo;
    con_estado = dato1.datosEstudianteCollection.datosBasicosEstudiante[cant_carreras - 1].estado;
    //con_documento = dato1.datosEstudianteCollection.datosBasicosEstudiante[cant_carreras-1].documento ;
    con_documento = numero_documento_identificacion;

    con_carrera = dato1.datosEstudianteCollection.datosBasicosEstudiante[cant_carreras - 1].carrera;
    con_nombre = dato1.datosEstudianteCollection.datosBasicosEstudiante[cant_carreras - 1].nombre;

    const respuesta2 = await axios.get(
      'https://autenticacion.portaloas.udistrital.edu.co/wso2eiserver/services/servicios_academicos_produccion/estados_codigo/' +
        con_estado
    );
    const dato2 = respuesta2.data; // Obtener los datos de la respuesta 2
    //      console.log( dato2.estado.nombre + " Estado1");
    //      con_estado = dato2.estado.nombre[0].estado_nombre ;
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

    // client removed (was unused)
    /*await client.connect();
    const query = "SELECT COUNT(*) AS multado FROM multas WHERE cod_multado = $1 AND con_estado_multa='ACTIVA'";
    const values = [con_codigo]; 

    const result = await client.query(query, values);
    con_multado = result.rows[0].multado > 0;

    let multaInfo = null;
    if (con_multado) {
      const queryMultaInfo = "SELECT * FROM multas WHERE cod_multado = $1 AND con_estado_multa='ACTIVA'";
      const valuesMultaInfo = [con_codigo];

      const resultMultaInfo = await client.query(queryMultaInfo, valuesMultaInfo);
      multaInfo = resultMultaInfo.rows;
      console.log(`Cantidad de registros de multas: ${multaInfo.length}`);
      console.log(multaInfo);
    }

    await client.end();*/

    if (con_estado === 'EGRESADO') {
      console.log('El estudiante es egresado. No se puede continuar.');
      return res.render('home/alerta-egresado', {
        message: 'El estudiante es egresado. No se puede continuar.',
      });
    }

    const con_nombre_oculto =
      con_nombre.substring(0, Math.min(4, con_nombre.length)) +
      '*'.repeat(Math.max(0, con_nombre.length - 4));
    const con_documento_oculto =
      con_documento.substring(0, Math.min(3, con_documento.length)) +
      '*'.repeat(Math.max(0, con_documento.length - 3));
    const con_codigo_oculto =
      con_codigo.substring(0, Math.min(3, con_codigo.length)) +
      '*'.repeat(Math.max(0, con_codigo.length - 3));
    const con_estado_oculto =
      con_estado.substring(0, Math.min(3, con_estado.length)) +
      '*'.repeat(Math.max(0, con_estado.length - 3));
    const con_carrera_oculta =
      con_carrera.substring(0, Math.min(8, con_carrera.length)) +
      '*'.repeat(Math.max(0, con_carrera.length - 8));

    req.session.studentData = {
      con_codigo_completo: con_codigo,
      con_estado_completo: con_estado,
      con_documento_completo: con_documento,
      con_carrera_completa: con_carrera,
      con_nombre_completo: con_nombre,
    };

    return res.render('home/register_data', {
      con_codigo: con_codigo_oculto,
      con_estado: con_estado_oculto,
      con_documento: con_documento_oculto,
      con_carrera: con_carrera_oculta,
      con_nombre: con_nombre_oculto,
      confirmacion: null,
      error: null,
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
