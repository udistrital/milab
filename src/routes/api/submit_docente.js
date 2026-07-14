require('dotenv').config();

const express = require('express');

const pool = require('../../libs/db');
const { resolveUsuarioIdForDocente } = require('../../libs/user-identity');
const { requireRoles } = require('../middlewares/auth');

var router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: false }));

const requireTeacherFineSubmissionAccess = requireRoles('laboratorista', {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

router.post('/', requireTeacherFineSubmissionAccess, async (req, res) => {
  const requestBody = req.body || {};
  const { cat_multa, con_documento, ual_id, fecha_multa, con_estado_multa, obs_multa } =
    requestBody;
  const today = new Date().toISOString().slice(0, 10);

  try {
    if (!fecha_multa) {
      return res.render('home/message_error', {
        message: 'Fecha de sancion obligatoria.',
        message2: 'Selecciona una fecha valida antes de registrar la sancion.',
        limit: null,
      });
    }

    if (fecha_multa > today) {
      return res.render('home/message_error', {
        message: 'La fecha de la sancion no puede ser futura.',
        message2: 'Selecciona una fecha igual o anterior al dia de hoy.',
        limit: null,
      });
    }

    const usuarioIdSancionado = await resolveUsuarioIdForDocente(con_documento);

    if (!usuarioIdSancionado) {
      return res.render('home/message_error', {
        message: 'No se encontró el docente para registrar la sanción.',
        message2: 'Verifica el documento e intenta nuevamente.',
        limit: null,
      });
    }

    const sessionDocumento = req.session.user.documento_real || req.session.user.documento;
    const laboratoristaResult = await pool.query(
      'SELECT documento FROM laboratorista WHERE documento = $1 OR n_usuario = $1',
      [sessionDocumento]
    );

    if (laboratoristaResult.rows.length === 0) {
      return res.render('home/message_error', {
        message: 'No se encontró laboratorista asociado a la sesión.',
        message2: 'Verifica tu cuenta e intenta nuevamente.',
        limit: null,
      });
    }

    const laboratorista = laboratoristaResult.rows[0];
    const idUal = Number(ual_id);

    if (!Number.isInteger(idUal)) {
      return res.render('home/message_error', {
        message: 'UAL inválida.',
        message2: 'Selecciona una UAL válida antes de registrar la sanción.',
        limit: null,
      });
    }

    const ualResult = await pool.query(
      'SELECT 1 FROM laboratorista_ual WHERE laboratorista_documento_id = $1 AND ual_id = $2',
      [laboratorista.documento, idUal]
    );

    if (ualResult.rows.length === 0) {
      return res.render('home/message_error', {
        message: 'UAL no autorizada para este laboratorista.',
        message2: 'Selecciona una UAL de tu facultad.',
        limit: null,
      });
    }

    await pool.query(
      'INSERT INTO multa (cat_multa, laboratorista_documento_id, usuario_sancionado_id, ual_id, fecha_multa, con_estado_multa, obs_multa) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [
        cat_multa,
        laboratorista.documento,
        usuarioIdSancionado,
        idUal,
        fecha_multa,
        con_estado_multa,
        obs_multa,
      ]
    );

    await pool.query(
      'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
      [req.session.user.tipo, laboratorista.documento, 'Multa pendiente a docente', con_documento]
    );

    return res.render('home/message_success', {
      message: 'Multa registrada correctamente',
      message2: `Documento sancionado: ${con_documento}`,
    });
  } catch (error) {
    console.error('Error al insertar en la base de datos:', error);
    return res.render('home/message_error', {
      message: 'Error al registrar la sanción.',
      message2: 'Inténtalo nuevamente.',
      limit: null,
    });
  }
});

module.exports = router;
