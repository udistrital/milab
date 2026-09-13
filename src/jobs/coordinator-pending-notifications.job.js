const cron = require('node-cron');

const pool = require('../libs/db');
const { sendEmailNotification } = require('../libs/email-notifications');

let coordinatorPendingNotificationsTask = null;

function getMilabAppUrl() {
  let raw = String(process.env.APP_BASE_URL || '').trim();

  while (raw.endsWith('/')) {
    raw = raw.slice(0, -1);
  }

  if (!raw) {
    return '';
  }

  return raw.endsWith('/milab') ? raw : `${raw}/milab`;
}

function buildCorrelationId(coordinatorDocument, now) {
  const datePart = now.toISOString().slice(0, 10);
  return `coordinador-pendientes-${coordinatorDocument}-${datePart}`;
}

async function fetchCoordinatorsWithPendingCounts() {
  const result = await pool.query(
    `
      SELECT
        c.documento AS coordinador_documento,
        COALESCE(NULLIF(TRIM(c.nombre), ''), NULLIF(TRIM(u.nombre), ''), 'Coordinador') AS coordinador_nombre,
        LOWER(COALESCE(NULLIF(TRIM(c.correo), ''), NULLIF(TRIM(u.correo), ''))) AS coordinador_correo,
        STRING_AGG(DISTINCT f.nombre, ', ' ORDER BY f.nombre) AS facultades,
        COUNT(DISTINCT m.id)::int AS pendientes
      FROM coordinador c
      JOIN coordinador_facultad cf
        ON cf.coordinador_documento_id = c.documento
      JOIN facultad f
        ON f.facultad_id = cf.facultad_id
      LEFT JOIN LATERAL (
        SELECT id, nombre, correo
        FROM usuario
        WHERE id = c.usuario_id
          OR documento = c.documento
          OR (c.correo IS NOT NULL AND LOWER(correo) = LOWER(c.correo))
        ORDER BY
          CASE
            WHEN id = c.usuario_id THEN 1
            WHEN documento = c.documento THEN 2
            ELSE 3
          END,
          id ASC
        LIMIT 1
      ) u ON TRUE
      LEFT JOIN LATERAL (
        SELECT ur.activo
        FROM usuario_rol ur
        INNER JOIN rol r
          ON r.id = ur.rol_id
        WHERE ur.usuario_id = u.id
          AND r.nombre = 'coordinador'
        ORDER BY ur.id DESC
        LIMIT 1
      ) role_state ON TRUE
      LEFT JOIN ual ul
        ON ul.facultad_id = cf.facultad_id
      LEFT JOIN multa m
        ON m.ual_id = ul.ual_id
       AND m.con_estado_multa IN ('Pendiente', 'POR SALDAR')
      WHERE COALESCE(NULLIF(TRIM(c.correo), ''), NULLIF(TRIM(u.correo), '')) IS NOT NULL
        AND COALESCE(role_state.activo, TRUE) = TRUE
      GROUP BY c.documento, c.nombre, c.correo, u.nombre, u.correo
      HAVING COUNT(DISTINCT m.id) > 0
      ORDER BY c.documento ASC
    `
  );

  return result.rows;
}

async function sendCoordinatorDigest(pendingInfo, now) {
  const recipient = String(pendingInfo.coordinador_correo || '').trim().toLowerCase();
  if (!recipient) {
    return;
  }

  const appUrl = getMilabAppUrl();

  await sendEmailNotification({
    sourceSystem: 'prestamos',
    templateName: 'prestamos/coordinador_resumen_pendientes',
    recipient,
    subject: `MILab: tienes ${pendingInfo.pendientes} notificaciones pendientes por atender`,
    variables: {
      coordinadorNombre: pendingInfo.coordinador_nombre,
      pendientes: Number(pendingInfo.pendientes || 0),
      facultades: pendingInfo.facultades || 'Sin facultades asociadas',
      appUrl,
      gestionUrl: appUrl ? `${appUrl}/api/aprobacion_multa` : '',
      fechaCorte: new Intl.DateTimeFormat('es-CO', {
        timeZone: process.env.TZ || 'America/Bogota',
        dateStyle: 'full',
        timeStyle: 'short',
      }).format(now),
    },
    correlationId: buildCorrelationId(pendingInfo.coordinador_documento, now),
  });
}

async function runCoordinatorPendingNotificationsCycle() {
  const now = new Date();
  const coordinators = await fetchCoordinatorsWithPendingCounts();

  for (const coordinator of coordinators) {
    try {
      await sendCoordinatorDigest(coordinator, now);
    } catch (error) {
      console.error(
        `Error enviando resumen de pendientes a coordinador ${coordinator.coordinador_documento}:`,
        error
      );
    }
  }
}

function startCoordinatorPendingNotificationsJob() {
  const enabled = String(process.env.COORDINATOR_PENDING_NOTIFICATIONS_ENABLED || 'true')
    .toLowerCase()
    .trim();

  if (enabled === 'false' || enabled === '0' || enabled === 'no') {
    return null;
  }

  if (coordinatorPendingNotificationsTask) {
    return coordinatorPendingNotificationsTask;
  }

  const schedule = String(process.env.COORDINATOR_PENDING_NOTIFICATIONS_CRON || '0 8 * * 3').trim();
  let isRunning = false;

  coordinatorPendingNotificationsTask = cron.schedule(
    schedule,
    async () => {
      if (isRunning) {
        return;
      }

      isRunning = true;
      try {
        await runCoordinatorPendingNotificationsCycle();
      } catch (error) {
        console.error('Error en el job de notificaciones pendientes de coordinadores:', error);
      } finally {
        isRunning = false;
      }
    },
    {
      timezone: process.env.TZ || 'America/Bogota',
      recoverMissedExecutions: true,
    }
  );

  return coordinatorPendingNotificationsTask;
}

module.exports = {
  startCoordinatorPendingNotificationsJob,
};
