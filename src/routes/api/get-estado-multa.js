const express = require('express');

const pool = require('../../libs/db');
const { resolveUsuarioIdForStudent } = require('../../libs/user-identity');
const { publicApiLimiter } = require('../middlewares/public-rate-limit');
const router = express.Router();

router.get('/:codigo', publicApiLimiter, async (req, res) => {
  const codigo = req.params.codigo;

  if (!/^\d{1,20}$/.test(codigo)) {
    return res.status(400).json({ error: 'Código inválido' });
  }

  try {
    const usuarioId = await resolveUsuarioIdForStudent({ documento: null, codigo });

    if (!usuarioId) {
      return res.json({
        codigo: codigo,
        estado: 'PAZYSALVO',
      });
    }

    const query = `
      SELECT 1
      FROM multa
      WHERE usuario_sancionado_id = $1 AND con_estado_multa = 'ACTIVA'
      LIMIT 1
    `;
    const result = await pool.query(query, [usuarioId]);

    if (result.rows.length > 0) {
      res.json({
        codigo: codigo,
        estado: 'MULTADO',
      });
    } else {
      res.json({
        codigo: codigo,
        estado: 'PAZYSALVO',
      });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al consultar el estado de multa' });
  }
});

module.exports = router;
