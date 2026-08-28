// ...existing code...
const express = require('express');
const pool = require('../../libs/db');
const { fetchUserById } = require('../../libs/user-identity');
const { requireRoles } = require('../middlewares/auth');

var router = express.Router();

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
  const con_estado_saldado = 'POR SALDAR';

  try {
    // Primero obtenemos el usuario sancionado de la multa
    const multaResult = await pool.query('SELECT usuario_sancionado_id FROM multa WHERE id = $1', [
      con_id,
    ]);

    if (multaResult.rows.length === 0) {
      return res.render('home/message_error', {
        message: '¡Multa no encontrada!',
        message2: 'Inténtalo nuevamente',
        limit: 'noSession',
      });
    }

    const usuarioSancionadoId = multaResult.rows[0].usuario_sancionado_id;
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
      [
        req.session.user.tipo,
        documentoReal,
        'Cambiar estado de multa a SALDADO',
        referenciaSancionado,
      ]
    );

    return res.render('home/message_success', {
      message: 'Multa actualizada correctamente',
      message2: `Sancionado registrado: ${referenciaSancionado}`,
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
