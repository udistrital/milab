const express = require('express');
const router = express.Router();

const pool = require('../../libs/db');
const { requireRoles } = require('../middlewares/auth');
const { renderApplicationError, wantsJson } = require('../middlewares/error-handler');

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
        TO_CHAR(fecha_creacion AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY HH24:MI:SS') as fecha_hora,
        accion, 
        persona 
      FROM log 
      ORDER BY fecha_creacion DESC
    `;

    const result = await pool.query(query);
    const logs = result.rows;

    res.render('home/logs', { logs });
  } catch (error) {
    console.error('Error al obtener logs:', error);

    if (wantsJson(req)) {
      return res.status(500).json({
        ok: false,
        message: 'No fue posible cargar los registros del sistema.',
        message2: 'Intenta nuevamente en unos minutos.',
      });
    }

    return renderApplicationError(res, {
      status: 500,
      message: 'No fue posible cargar los registros del sistema.',
      message2: 'Intenta nuevamente en unos minutos.',
      limit: null,
    });
  }
});

module.exports = router;
