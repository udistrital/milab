// ...existing code...
const express = require('express');
const pool = require('../../libs/db');
const { fetchUserById } = require('../../libs/user-identity');
const { requireRoles } = require('../middlewares/auth');
const { resolveMultaConfigForMultaId } = require('../../libs/multa-config');

const router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: true }));

const requireFineRemovalAccess = requireRoles(['admin', 'laboratorista', 'coordinador'], {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

router.post('/', requireFineRemovalAccess, async (req, res) => {
  const { con_id } = req.body;
  console.log('ID antes de la consulta', con_id);
  let con_estado_saldado = 'POR SALDAR';
  let accionLog = 'Cambiar estado de multa a SALDADO';
  let mensajeSuccess = 'Multa actualizada correctamente';
  let mensajeSuccess2 = '';

  try {
    // Primero obtenemos el usuario sancionado de la multa
    const multaResult = await pool.query(
      'SELECT usuario_sancionado_id, con_estado_multa FROM multa WHERE id = $1',
      [con_id]
    );

    if (multaResult.rows.length === 0) {
      return res.render('home/message_error', {
        message: '¡Multa no encontrada!',
        message2: 'Inténtalo nuevamente',
        limit: 'noSession',
      });
    }

    const multaActual = multaResult.rows[0];
    if (
      multaActual.con_estado_multa === 'SALDADA' ||
      multaActual.con_estado_multa === 'POR SALDAR'
    ) {
      return res.render('home/message_error', {
        message: 'La sanción ya está en proceso de retiro o saldada.',
        message2: 'Verifica el estado de la sanción e intenta nuevamente.',
        limit: 'noSession',
      });
    }

    const cfg = await resolveMultaConfigForMultaId(con_id);
    const permiteSaldarDirecto = Boolean(cfg && cfg.permite_saldar_multas_directas);
    if (permiteSaldarDirecto) {
      con_estado_saldado = 'SALDADA';
      accionLog = 'Cambiar estado de multa a SALDADA';
      mensajeSuccess = 'Multa saldada directamente';
      mensajeSuccess2 =
        'La facultad cuenta con autorización para saldar sin aprobación del coordinador.';
    }

    const usuarioSancionadoId = multaActual.usuario_sancionado_id;
    const usuarioSancionado = await fetchUserById(usuarioSancionadoId);
    const referenciaSancionado = usuarioSancionado?.documento || 'desconocido';

    // Actualizamos el estado de la multa
    await pool.query('UPDATE multa SET con_estado_multa = $1 WHERE id = $2', [
      con_estado_saldado,
      con_id,
    ]);
    console.log('1 record updated');

    let documentoReal = req.session.user.documento;
    if (req.session.user.tipo === 'laboratorista') {
      const result = await pool.query(
        'SELECT documento FROM laboratorista WHERE documento = $1 OR n_usuario = $1',
        [req.session.user.documento]
      );
      if (result.rows.length > 0) {
        documentoReal = result.rows[0].documento;
      }
    }

    await pool.query(
      'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
      [req.session.user.tipo, documentoReal, accionLog, referenciaSancionado]
    );

    return res.render('home/message_success', {
      message: mensajeSuccess,
      message2: mensajeSuccess2 || `Sancionado registrado: ${referenciaSancionado}`,
    });
  } catch (error) {
    console.error('Error:', error);
    res.render('home/message_error', {
      message: '¡Error en la operación!',
      message2: 'Inténtalo nuevamente',
      limit: 'noSession',
    });
  }
});

module.exports = router;
