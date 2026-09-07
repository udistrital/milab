const express = require('express');

const pool = require('../../libs/db');
const { resolveCoordinatorScope } = require('../../libs/faculty-scope');
const { ensureMonitorSchema } = require('../../libs/monitor-registry');
const {
  ensureOperationalRoleAssignmentsSchema,
} = require('../../libs/operational-role-assignments');
const { APP_PERMISSIONS } = require('../../libs/permissions');
const { requirePermissions } = require('../middlewares/auth');

const router = express.Router();

const requireAdminOrCoordinatorMonitorAccess = requirePermissions(
  APP_PERMISSIONS.USERS_MONITOR_VIEW,
  {
    message: '¡Acceso denegado!',
    message2: 'No tienes permisos para consultar los monitores registrados.',
    limit: 'noSession',
  }
);

router.get('/', requireAdminOrCoordinatorMonitorAccess, async function (req, res) {
  try {
    await ensureOperationalRoleAssignmentsSchema();
    await ensureMonitorSchema();

    const baseQuery = `
      SELECT
        u.id AS usuario_id,
        COALESCE(m.nombre, u.nombre) AS nombre,
        COALESCE(m.documento, u.documento) AS documento,
        COALESCE(m.correo, u.correo) AS correo,
        pe.codigo,
        m.numero_contrato,
        m.tipo_vinculacion,
        m.fecha_inicio,
        m.fecha_fin,
        m.soporte_contrato,
        COALESCE(STRING_AGG(DISTINCT fac.nombre, ', ' ORDER BY fac.nombre), '') AS facultades,
        COALESCE(STRING_AGG(DISTINCT ua.nombre, ', ' ORDER BY ua.nombre), '') AS uales
      FROM usuario_ual_rol_operativo a
      JOIN rol r
        ON r.id = a.rol_id
       AND r.nombre = 'monitor'
      JOIN usuario u
        ON u.id = a.usuario_id
      LEFT JOIN monitor m
        ON m.usuario_id = u.id
       AND m.activo = TRUE
      LEFT JOIN perfil_estudiante pe
        ON pe.usuario_id = u.id
      JOIN ual ua
        ON ua.ual_id = a.ual_id
       AND ua.activo = TRUE
      LEFT JOIN facultad fac
        ON fac.facultad_id = ua.facultad_id
      WHERE a.activo = TRUE
    `;

    let result;
    if (req.session.user.tipo === 'admin') {
      result = await pool.query(
        `${baseQuery}
         GROUP BY u.id, u.nombre, u.documento, u.correo, pe.codigo,
                  m.nombre, m.documento, m.correo, m.numero_contrato, m.tipo_vinculacion,
                  m.fecha_inicio, m.fecha_fin, m.soporte_contrato
         ORDER BY u.nombre ASC`
      );
    } else {
      const scope = await resolveCoordinatorScope(pool, req.session.user.documento);
      const facultyIds = (scope.facultyIds || []).map(Number).filter(Number.isInteger);

      if (!facultyIds.length) {
        return res.render('home/monitores_registrados', {
          monitores: [],
          successMessage: null,
        });
      }

      result = await pool.query(
        `${baseQuery}
           AND ua.facultad_id = ANY($1::int[])
         GROUP BY u.id, u.nombre, u.documento, u.correo, pe.codigo,
                  m.nombre, m.documento, m.correo, m.numero_contrato, m.tipo_vinculacion,
                  m.fecha_inicio, m.fecha_fin, m.soporte_contrato
         ORDER BY u.nombre ASC`,
        [facultyIds]
      );
    }

    return res.render('home/monitores_registrados', {
      monitores: result.rows || [],
      successMessage: null,
    });
  } catch (error) {
    console.error('Error al obtener monitores registrados:', error);
    return res.render('home/message_error', {
      message: 'Error al obtener monitores',
      message2: 'Por favor intenta nuevamente',
      limit: null,
    });
  }
});

module.exports = router;
