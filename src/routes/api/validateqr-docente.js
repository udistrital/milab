const express = require('express');
const pool = require('../../libs/db');
const { publicPageLimiter } = require('../middlewares/public-rate-limit');
const { renderApplicationError, wantsJson } = require('../middlewares/error-handler');

var router = express.Router();

// Ruta para la validación de registros de docentes
router.get('/:cc', publicPageLimiter, async (req, res) => {
  const cc = req.params.cc;
  if (!/^[0-9a-fA-F-]{20,64}$/.test(cc)) {
    return res.status(400).render('home/validateqr-error-docente', { cc });
  }

  try {
    const query =
      'SELECT pd.nombre FROM certificado_docente cd LEFT JOIN perfil_docente pd ON pd.usuario_id = cd.usuario_id WHERE cd.certificado_id = $1';
    const values = [cc];
    const result = await pool.query(query, values);

    if (result.rows.length > 0) {
      const nombre = result.rows[0].nombre;
      res.status(200).render('home/validateqr-ok-docente', { cc, nombre });
    } else {
      res.status(200).render('home/validateqr-error-docente', { cc });
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
