const express = require('express');
const router = express.Router();
const { verifyRecaptchaToken } = require('../../libs/recaptcha');
const pool = require('../../libs/db');
const { resolveUsuarioIdForStudent } = require('../../libs/user-identity');

const secretKey = process.env.RECAPTCHA_SECRET_KEY;

router.use(express.json());
router.use(express.urlencoded({ extended: false }));

router.get('/', function (req, res) {
  res.render('home/consulta-invit', {
    estadoResultado: null,
    estadoSinFormato: null,
    error: null,
    siteKey: process.env.RECAPTCHA_SITE_KEY,
  });
});

router.post('/', async (req, res) => {
  const requestBody = req.body || {};
  const { documento, 'g-recaptcha-response': recaptchaResponse } = requestBody;

  if (!documento) {
    return res.render('home/consulta-invit', {
      siteKey: process.env.RECAPTCHA_SITE_KEY,
      error: 'Debes ingresar un documento para realizar la consulta.',
      estadoResultado: null,
      estadoSinFormato: null,
    });
  }

  if (!/^\d{1,20}$/.test(documento)) {
    return res.render('home/consulta-invit', {
      siteKey: process.env.RECAPTCHA_SITE_KEY,
      error: 'El documento ingresado no es válido.',
      estadoResultado: null,
      estadoSinFormato: null,
    });
  }

  if (!recaptchaResponse) {
    return res.render('home/consulta-invit', {
      siteKey: process.env.RECAPTCHA_SITE_KEY,
      error: 'Por favor completa el reCAPTCHA.',
      estadoResultado: null,
      estadoSinFormato: null,
    });
  }

  try {
    const recaptchaData = await verifyRecaptchaToken({
      secretKey,
      token: recaptchaResponse,
    });

    if (!recaptchaData.success) {
      return res.render('home/consulta-invit', {
        siteKey: process.env.RECAPTCHA_SITE_KEY,
        error: 'No se pudo verificar el reCAPTCHA.',
        estadoResultado: null,
        estadoSinFormato: null,
      });
    }

    const usuarioId = await resolveUsuarioIdForStudent({ documento: null, codigo: documento });
    let estado = 'PAZYSALVO';
    if (usuarioId) {
      const result = await pool.query(
        `SELECT 1 FROM multa WHERE usuario_id_sancionado = $1 AND con_estado_multa = 'ACTIVA' LIMIT 1`,
        [usuarioId]
      );
      if (result.rows.length > 0) estado = 'MULTADO';
    }

    res.render('home/consulta-invit', {
      siteKey: process.env.RECAPTCHA_SITE_KEY,
      estadoResultado: `El estudiante está: ${estado}`,
      estadoSinFormato: estado,
      error: null,
    });
  } catch (error) {
    console.error('Error en consulta o verificación:', error.message);
    res.status(500).render('home/consulta-invit', {
      siteKey: process.env.RECAPTCHA_SITE_KEY,
      error: 'Ocurrió un error al procesar la solicitud.',
      estadoResultado: null,
      estadoSinFormato: null,
    });
  }
});

module.exports = router;
