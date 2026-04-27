const express = require('express');
const axios = require('axios');
const router = express.Router();
const { buildAppUrl } = require('../../libs/app-url');
const { verifyRecaptchaToken } = require('../../libs/recaptcha');

const secretKey = process.env.RECAPTCHA_SECRET_KEY;

router.get('/', function (req, res) {
  res.render('home/consulta-invit', {
    estadoResultado: null,
    estadoSinFormato: null,
    error: null,
    siteKey: process.env.RECAPTCHA_SITE_KEY,
  });
});

router.post('/', async (req, res) => {
  const { documento, 'g-recaptcha-response': recaptchaResponse } = req.body;

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

    const apiUrl = buildAppUrl(`/api/get-estado-multa/${documento}`);
    const apiResponse = await axios.get(apiUrl);

    const estado = apiResponse.data.estado;

    res.render('home/consulta-invit', {
      siteKey: process.env.RECAPTCHA_SITE_KEY,
      estadoResultado: `El estudiante está: ${estado}`,
      estadoSinFormato: estado,
      error: null,
    });
  } catch (error) {
    console.error('Error en consulta o verificación:', error.message);

    if (error.response && error.response.status === 404) {
      res.render('home/consulta-invit', {
        siteKey: process.env.RECAPTCHA_SITE_KEY,
        error: 'No se encontró información para el documento ingresado.',
        estadoResultado: null,
        estadoSinFormato: null,
      });
    } else {
      res.status(500).render('home/consulta-invit', {
        siteKey: process.env.RECAPTCHA_SITE_KEY,
        error: 'Ocurrió un error al procesar la solicitud.',
        estadoResultado: null,
        estadoSinFormato: null,
      });
    }
  }
});

module.exports = router;
