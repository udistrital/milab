require('dotenv').config();

const express = require('express');

const pool = require('../../libs/db');
const { requireRoles } = require('../middlewares/auth');

var router = express.Router();

const requireTeacherFineSubmissionAccess = requireRoles(['admin', 'laboratorista', 'coordinador'], {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

router.post('/', requireTeacherFineSubmissionAccess, async (req, res) => {
  const {
    cat_multa,
    nombre_laboratorista,
    cc_laboratorista,
    con_documento,
    ual,
    fecha_multa,
    con_estado_multa,
    obs_multa,
    n_usuario,
  } = req.body;

  const cod_multado = con_documento;

  pool.query(
    `INSERT INTO multas 
        (cat_multa, nombre_laboratorista, cc_laboratorista, cod_multado, ual, fecha_multa, con_estado_multa, obs_multa, n_usuario) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [
      cat_multa,
      nombre_laboratorista,
      cc_laboratorista,
      cod_multado,
      ual,
      fecha_multa,
      con_estado_multa,
      obs_multa,
      n_usuario,
    ],
    (error) => {
      if (error) {
        console.error('Error al insertar en la base de datos:', error);
        throw error;
      }
    }
  );

  pool.query(
    'INSERT INTO logs (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
    [req.session.user.tipo, cc_laboratorista, 'Multa pendiente a docente', con_documento],
    (error) => {
      if (error) {
        throw error;
      }
    }
  );

  return res.render('home/message_success', {
    message: 'Multa registrada correctamente',
    message2: `Documento sancionado: ${con_documento}`,
  });
});

module.exports = router;
