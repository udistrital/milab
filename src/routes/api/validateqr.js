const express = require('express');
const pool = require('../../libs/db');
const { publicPageLimiter } = require('../middlewares/public-rate-limit');
const { renderApplicationError, wantsJson } = require('../middlewares/error-handler');

// Variables de entorno
require('dotenv').config();

const router = express.Router();

// Ruta para la validación de registros
router.get('/:codigo', publicPageLimiter, async (req, res) => {
  const codigo = req.params.codigo;
  if (!/^[0-9a-fA-F-]{20,64}$/.test(codigo)) {
    return res.status(400).render('home/validateqr-error', { codigo });
  }
  try {
    const query =
      'SELECT pe.nombre FROM certificado_estudiante ce LEFT JOIN perfil_estudiante pe ON pe.usuario_id = ce.usuario_id WHERE ce.certificado_id = $1';
    const values = [codigo];
    const result = await pool.query(query, values);

    if (result.rows.length > 0) {
      const nombre = result.rows[0].nombre;
      res.status(200).render('home/validateqr-ok', { codigo, nombre });
    } else {
      res.status(200).render('home/validateqr-error', { codigo });
    }
  } catch (error) {
    console.error('Error al validar el registro:', error);

    if (wantsJson(req)) {
      return res.status(500).json({
        ok: false,
        message: 'No fue posible validar el registro.',
        message2: 'Intenta nuevamente en unos minutos.',
      });
    }

    return renderApplicationError(res, {
      status: 500,
      message: 'No fue posible validar el registro.',
      message2: 'Intenta nuevamente en unos minutos.',
      limit: null,
    });
  }
});

module.exports = router;
