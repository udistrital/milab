const express = require('express');

const pool = require('../../libs/db');
const { getAcademicServicePath, requestOati } = require('../../libs/oati-client');
const { verifyRecaptchaToken } = require('../../libs/recaptcha');
const limiter = require('../middlewares/limiter');
require('dotenv').config();

const secretKey = process.env.RECAPTCHA_SECRET_KEY;

const router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: true }));

router.post('/', limiter, async function (req, res) {
  const { numero_documento_identificacion, 'g-recaptcha-response': recaptchaResponse } = req.body;

  // Validar reCAPTCHA
  if (!recaptchaResponse) {
    return res.render('home/register_2', {
      error: 'Por favor completa el reCAPTCHA.',
      confirmacion: null,
      selectedType: 'docente',
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
        selectedType: 'docente',
      });
    }
  } catch (error) {
    console.error('Error verificando reCAPTCHA:', error);
    return res.render('home/register_2', {
      error: 'Error al verificar reCAPTCHA.',
      confirmacion: null,
      selectedType: 'docente',
    });
  }

  // Verificamos si el docente ya está registrado en la base de datos
  const query1 = 'SELECT * FROM usuario WHERE documento = $1';
  const values1 = [numero_documento_identificacion];
  const result1 = await pool.query(query1, values1);

  if (result1.rows.length > 0) {
    // Si ya existe en la base de datos, mostramos mensaje de error
    return res.render('home/message_error', {
      message: 'Datos inválidos. Verifica la información e inténtalo nuevamente.',
      message2: 'Revisa los datos ingresados',
      limit: null,
    });
  }

  // Si no existe en la base de datos, consultamos al servicio OAS
  try {
    const dato1 = await requestOati(
      getAcademicServicePath(`consultar_estado_docente/${numero_documento_identificacion}`)
    );

    // Log the entire dato1 object to inspect its structure
    console.log('Datos del docente:', dato1);

    // Convertir los datos del docente a una cadena JSON
    // (dataString was unused and removed)

    // Acceder a los datos dentro del array
    const docenteData = dato1.docentesCollection.docente[0];
    const con_estado = docenteData.estado_docente;
    const con_documento = numero_documento_identificacion;
    const con_nombre = docenteData.nombre;

    console.log('con_estado:', con_estado);
    console.log('con_documento:', con_documento);
    console.log('con_nombre:', con_nombre);

    if (con_estado === 'INACTIVO') {
      return res.render('home/message_error', {
        message: 'Docente inactivo',
        message2: 'No se puede continuar con la solicitud.',
        limit: null,
      });
    }

    const con_nombre_oculto =
      con_nombre.substring(0, Math.min(4, con_nombre.length)) +
      '*'.repeat(Math.max(0, con_nombre.length - 4));
    const con_documento_oculto =
      con_documento.substring(0, Math.min(3, con_documento.length)) +
      '*'.repeat(Math.max(0, con_documento.length - 3));
    const con_estado_oculto =
      con_estado.substring(0, Math.min(3, con_estado.length)) +
      '*'.repeat(Math.max(0, con_estado.length - 3));

    // Almacenar datos completos en la sesión para seguridad
    req.session.teacherData = {
      con_estado_completo: con_estado,
      con_documento_completo: con_documento,
      con_nombre_completo: con_nombre,
    };

    return res.render('home/register_data1', {
      con_estado: con_estado_oculto,
      con_documento: con_documento_oculto,
      con_nombre: con_nombre_oculto,
      confirmacion: null,
      error: null,
    });
  } catch (error) {
    console.error('Error al consultar al OAS:', error);
    return res.render('home/error-consulta', {
      message: 'Se ha producido un error al consultar la información del docente.',
    });
  }
});

module.exports = router;
