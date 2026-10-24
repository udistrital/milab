const express = require('express');
const router = express.Router();
const { verifyRecaptchaToken } = require('../../libs/recaptcha');
const pool = require('../../libs/db');
const { resolveUsuarioIdForStudent } = require('../../libs/user-identity');
const { sgaDebtService } = require('../../libs/oati-debts');
const { respondOatiUnavailable } = require('../middlewares/error-handler');

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

    let usuarioId;
    try {
      usuarioId = await resolveUsuarioIdForStudent({ documento: null, codigo: documento });
    } catch (err) {
      if (err?.code === 'OATI_UNAVAILABLE') {
        return respondOatiUnavailable(req, res);
      }
      // Si el error es 404 o similar, mostrar mensaje controlado
      if (err && (err.status === 404 || (err.response && err.response.status === 404))) {
        return res.render('home/consulta-invit', {
          siteKey: process.env.RECAPTCHA_SITE_KEY,
          error: 'No se encontró información para el documento ingresado.',
          estadoResultado: null,
          estadoSinFormato: null,
        });
      }
      // Otros errores inesperados
      console.error('Error en consulta o verificación:', err.message);
      return res.status(500).render('home/consulta-invit', {
        siteKey: process.env.RECAPTCHA_SITE_KEY,
        error: 'Ocurrió un error al procesar la solicitud.',
        estadoResultado: null,
        estadoSinFormato: null,
      });
    }

    if (!usuarioId) {
      return res.render('home/consulta-invit', {
        siteKey: process.env.RECAPTCHA_SITE_KEY,
        error: 'No se encontró información para el documento ingresado.',
        estadoResultado: null,
        estadoSinFormato: null,
      });
    }

    let estado = 'PAZ_Y_SALVO';
    let errorConsultaSga = null;
    try {
      const result = await pool.query(
        `SELECT 1 FROM multa WHERE usuario_sancionado_id = $1 AND con_estado_multa = 'ACTIVA' LIMIT 1`,
        [usuarioId]
      );
      let sgaMultaActiva = false;

      if (sgaDebtService.isConfigured()) {
        try {
          const sgaResult = await sgaDebtService.queryStudent({ codigo: documento });
          sgaMultaActiva = sgaResult.debts.length > 0;
          if (!['found', 'clear'].includes(sgaResult.status)) {
            errorConsultaSga = sgaResult.message;
          }
        } catch (sgaError) {
          if (sgaError?.code === 'OATI_UNAVAILABLE') {
            return respondOatiUnavailable(req, res);
          }
          console.error('Error consultando multas SGA en consulta anónima:', sgaError.message);
          errorConsultaSga = 'No fue posible confirmar las sanciones de laboratorio en SGA.';
        }
      } else {
        errorConsultaSga =
          'El servicio SGA no está configurado; no es posible confirmar el estado completo.';
      }

      if (result.rows.length > 0 || sgaMultaActiva) estado = 'MULTADO';
      if (errorConsultaSga && result.rows.length === 0 && !sgaMultaActiva) {
        return res.status(503).render('home/consulta-invit', {
          siteKey: process.env.RECAPTCHA_SITE_KEY,
          error: errorConsultaSga,
          estadoResultado: null,
          estadoSinFormato: null,
        });
      }
    } catch (err) {
      // Si hay error en la consulta de multas, mostrar error controlado
      console.error('Error consultando multas:', err.message);
      return res.status(500).render('home/consulta-invit', {
        siteKey: process.env.RECAPTCHA_SITE_KEY,
        error: 'Ocurrió un error al consultar el estado de multas.',
        estadoResultado: null,
        estadoSinFormato: null,
      });
    }

    res.render('home/consulta-invit', {
      siteKey: process.env.RECAPTCHA_SITE_KEY,
      estadoResultado: `El estudiante está: ${estado}`,
      estadoSinFormato: estado,
      error: errorConsultaSga,
    });
  } catch (error) {
    if (error?.code === 'OATI_UNAVAILABLE') {
      return respondOatiUnavailable(req, res);
    }
    // Si el error es 404 o similar, mostrar mensaje controlado
    if (error && (error.status === 404 || (error.response && error.response.status === 404))) {
      return res.render('home/consulta-invit', {
        siteKey: process.env.RECAPTCHA_SITE_KEY,
        error: 'No se encontró información para el documento ingresado.',
        estadoResultado: null,
        estadoSinFormato: null,
      });
    }
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
