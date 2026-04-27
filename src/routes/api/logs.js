const express = require('express');
const router = express.Router();

const pool = require('../../libs/db');
const { requireRoles } = require('../middlewares/auth');

const requireAdminLogsAccess = requireRoles('admin', {
  message: '¡Acceso denegado!',
  message2: 'No tienes permisos para ver el dashboard',
  limit: 'noSession',
});

router.get('/', requireAdminLogsAccess, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  try {
    await pool.query("SET timezone = 'America/Bogota'");

    const query = `
      SELECT 
        nombre, 
        documento, 
        TO_CHAR(fecha_hora AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY HH24:MI:SS') as fecha_hora,
        accion, 
        persona 
      FROM logs 
      ORDER BY fecha_hora DESC
    `;

    const result = await pool.query(query);
    const logs = result.rows;

    res.render('home/logs', { logs });
  } catch (error) {
    console.error('Error al obtener logs:', error);
    res.status(500).send('Error al obtener logs');
  }
});

module.exports = router;
