require('dotenv').config();

const express = require('express');

const pool = require('../../libs/db');
const { requireRoles } = require('../middlewares/auth');

var router = express.Router();

const requireFineSubmissionAccess = requireRoles(['admin', 'laboratorista', 'coordinador'], {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

router.post('/', requireFineSubmissionAccess, async (req, res) => {
  const {
    cat_multa,
    nombre_laboratorista,
    cc_laboratorista,
    cod_multado,
    numero_documento_identificacion,
    ual,
    fecha_multa,
    con_estado_multa,
    obs_multa,
    n_usuario,
  } = req.body;

  const documentoMultado =
    String(numero_documento_identificacion || '').trim() || String(cod_multado || '').trim();

  pool.query(
    'INSERT INTO multas (cat_multa, nombre_laboratorista, cc_laboratorista, cod_multado, ual, fecha_multa, con_estado_multa, obs_multa,n_usuario) VALUES ($1, $2, $3, $4, $5, $6, $7, $8,$9) RETURNING *',
    [
      cat_multa,
      nombre_laboratorista,
      cc_laboratorista,
      documentoMultado,
      ual,
      fecha_multa,
      con_estado_multa,
      obs_multa,
      n_usuario,
    ],
    (error) => {
      if (error) {
        throw error;
      }
    }
  );

  pool.query(
    'INSERT INTO logs (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
    [req.session.user.tipo, cc_laboratorista, 'Multa pendiente a estudiante', documentoMultado],
    (error) => {
      if (error) {
        throw error;
      }
    }
  );

  return res.render('home/message_success', {
    message: 'Multa registrada correctamente',
    message2: `Documento sancionado: ${documentoMultado}`,
  });
});

module.exports = router;
