// ...existing code...
const express = require('express');
const pool = require('../../libs/db');
const { requireRoles } = require('../middlewares/auth');

var router = express.Router();

const requireFineRemovalAccess = requireRoles(['admin', 'laboratorista', 'coordinador'], {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

router.post('/', requireFineRemovalAccess, async (req, res) => {
  const { con_id } = req.body;
  console.log('ID antes de la consulta', con_id);
  const con_estado_saldado = 'POR SALDAR';

  try {
    // Primero obtenemos el cod_multado de la base de datos
    const multaResult = await pool.query('SELECT cod_multado FROM multas WHERE id = $1', [con_id]);

    if (multaResult.rows.length === 0) {
      return res.render('home/message_error', {
        message: '¡Multa no encontrada!',
        message2: 'Inténtalo nuevamente',
        limit: 'noSession',
      });
    }

    const cod_multado_db = multaResult.rows[0].cod_multado;

    // Actualizamos el estado de la multa
    await pool.query('UPDATE multas SET con_estado_multa = $1 WHERE id = $2', [
      con_estado_saldado,
      con_id,
    ]);
    console.log('1 record updated');

    let documentoReal = req.session.user.documento;
    if (req.session.user.tipo === 'laboratorista') {
      const result = await pool.query('SELECT documento FROM laboratorista WHERE n_usuario = $1', [
        req.session.user.documento,
      ]);
      if (result.rows.length > 0) {
        documentoReal = result.rows[0].documento;
      }
    }

    await pool.query(
      'INSERT INTO logs (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
      [req.session.user.tipo, documentoReal, 'Cambiar estado de multa a SALDADO', cod_multado_db]
    );

    return res.render('home/message_success', {
      message: 'Multa actualizada correctamente',
      message2: `Documento sancionado: ${cod_multado_db}`,
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
