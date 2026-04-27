const express = require('express');
const pool = require('../../libs/db');
const { publicPageLimiter } = require('../middlewares/public-rate-limit');

var router = express.Router();

// Ruta para la validación de registros de docentes
router.get('/:cc', publicPageLimiter, async (req, res) => {
  const cc = req.params.cc;
  if (!/^[0-9a-fA-F-]{20,64}$/.test(cc)) {
    return res.status(400).render('home/validateqr-error-docente', { cc });
  }

  try {
    const query = 'SELECT * FROM docente WHERE id_certificado = $1';
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
    res.status(500).send('Error al validar el registro.');
  }
});

module.exports = router;
