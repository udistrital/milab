const express = require('express');

const pool = require('../../libs/db');
const { verifyRecaptchaToken } = require('../../libs/recaptcha');
const { ensurePerfilEstudiante, resolveUsuarioIdForStudent } = require('../../libs/user-identity');
const limiter = require('../middlewares/limiter');
const { requireRoles } = require('../middlewares/auth');
const { getAcademicServicePath, requestOati } = require('../../libs/oati-client');

// Variables de entorno
require('dotenv').config();

const secretKey = process.env.RECAPTCHA_SECRET_KEY;

let router = express.Router();
router.use(express.json());
router.use(express.urlencoded({ extended: true }));

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

router.get('/verificacion', requireStudentSelfServiceAccess, async function (req, res) { // NOSONAR - legacy flow kept for compatibility
  res.set('Cache-Control', 'no-store');
  console.log('sesion: ' + req.session.user.documento);
  let con_codigo = 0;

  const query1 =
    'SELECT documento, nombre, codigo, estado, carrera, correo FROM usuario WHERE documento = $1';
  const values1 = [req.session.user.documento];
  const result1 = await pool.query(query1, values1);
  const profileRow = result1.rows[0] || {};

  if (req.session.user.tipo === 'estudiante') {
    con_codigo = profileRow.codigo || 0;
  }

  console.log('Resultado query: ' + con_codigo);

  let usuarioId = await resolveUsuarioIdForStudent({
    documento: req.session.user.documento,
    codigo: con_codigo,
  });
  if (!usuarioId && profileRow?.documento) {
    usuarioId = await ensurePerfilEstudiante({
      documento: profileRow.documento,
      nombre: profileRow.nombre || req.session.user?.nombre || '',
      codigo: profileRow.codigo || con_codigo,
      programa: profileRow.carrera || '',
      estado: profileRow.estado || '',
      correo: profileRow.correo || '',
    });
  }
  const query =
    "SELECT COUNT(*) AS multado FROM multa WHERE usuario_sancionado_id = $1 AND con_estado_multa='ACTIVA'";
  const values = [usuarioId];

  const result = await pool.query(query, values);
  const con_multado = result.rows[0].multado > 0;

  let multaInfo = null;
  if (con_multado && usuarioId) {
    const queryMultaInfo =
      "SELECT m.*, us.documento AS documento_sancionado, u.nombre AS ual, l.nombre AS nombre_laboratorista, l.documento AS cc_laboratorista FROM multa m LEFT JOIN usuario us ON us.id = m.usuario_sancionado_id LEFT JOIN ual u ON u.ual_id = m.ual_id LEFT JOIN laboratorista l ON l.documento = m.laboratorista_documento_id WHERE m.usuario_sancionado_id = $1 AND m.con_estado_multa='ACTIVA'";
    const valuesMultaInfo = [usuarioId];

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

router.post('/', limiter, async function (req, res) { // NOSONAR - legacy flow kept for compatibility
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
  let con_codigo;
  let con_estado;
  let con_documento;
  let con_carrera;
  let con_nombre;
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
    const dato1 = await requestOati(
      getAcademicServicePath(`datos_basicos_activos_cedula/${numero_documento_identificacion}`)
    );
    // dataString removed (was unused)
    let cant_carreras = dato1.datosEstudianteCollection.datosBasicosEstudiante.length;

    con_codigo = dato1.datosEstudianteCollection.datosBasicosEstudiante[cant_carreras - 1].codigo;
    con_estado = dato1.datosEstudianteCollection.datosBasicosEstudiante[cant_carreras - 1].estado;
    con_documento = numero_documento_identificacion;

    con_carrera = dato1.datosEstudianteCollection.datosBasicosEstudiante[cant_carreras - 1].carrera;
    con_nombre = dato1.datosEstudianteCollection.datosBasicosEstudiante[cant_carreras - 1].nombre;

    const dato2 = await requestOati(getAcademicServicePath(`estados_codigo/${con_estado}`));
    con_estado = dato2.estado.nombre;

    const dato3 = await requestOati(getAcademicServicePath(`carrera/${con_carrera}`));
    con_carrera = dato3.carrerasCollection.carrera[0].nombre;

    console.log('con_codigo ' + con_codigo);
    console.log('con_estado ' + con_estado);
    console.log('con_documento ' + con_documento);
    console.log('con_carrera ' + con_carrera);
    console.log('con_nombre ' + con_nombre);

    //--- DB

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

  } catch (error) {
    console.error(error);
    return res.render('home/error-consulta', {
      message: 'Se ha producido un error',
    });
  }
});

// Función para consultar multas asignadas al usuario

module.exports = router;
