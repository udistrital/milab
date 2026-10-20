const cron = require('node-cron');

const pool = require('../libs/db');
const { sendEmailNotification } = require('../libs/email-notifications');
const {
  buildMultaScopeFilter,
  hasCoordinatorScope,
  resolveCoordinatorScopeByRecord,
} = require('../libs/faculty-scope');

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

async function fetchScopeFacultyNames(scope) {
  const result = scope.ualIds.length
    ? await pool.query(
        `
          SELECT DISTINCT f.nombre
          FROM ual u
          JOIN dependencia_facultad f
            ON f.dependencia_facultad_id = u.facultad_id
          WHERE u.ual_id = ANY($1::int[])
          ORDER BY f.nombre
        `,
        [scope.ualIds]
      )
    : await pool.query(
        `
          SELECT nombre
          FROM dependencia_facultad
          WHERE dependencia_facultad_id = ANY($1::int[])
          ORDER BY nombre
        `,
        [scope.facultyIds]
      );

  return result.rows.map((row) => row.nombre).join(', ');
}

async function fetchScopedPendingCount(scope) {
  const filter = buildMultaScopeFilter(scope, 1);
  const result = await pool.query(
    `
      SELECT COUNT(DISTINCT m.id)::int AS pendientes
      FROM multa m
      JOIN ual u
        ON u.ual_id = m.ual_id
      WHERE m.con_estado_multa IN ('Pendiente', 'POR SALDAR')
        AND ${filter.sql}
    `,
    [filter.value]
  );

  return result.rows[0]?.pendientes || 0;
}

async function fetchCoordinatorsWithPendingCounts() {
  const result = await pool.query(
    `
      SELECT
        c.documento,
        c.nombre,
        c.nombre_u,
        c.correo,
        c.usuario_id,
        COALESCE(NULLIF(TRIM(c.nombre), ''), NULLIF(TRIM(u.nombre), ''), 'Coordinador') AS coordinador_nombre,
        LOWER(COALESCE(NULLIF(TRIM(c.correo), ''), NULLIF(TRIM(u.correo), ''))) AS coordinador_correo
      FROM coordinador c
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
      WHERE COALESCE(NULLIF(TRIM(c.correo), ''), NULLIF(TRIM(u.correo), '')) IS NOT NULL
        AND COALESCE(role_state.activo, TRUE) = TRUE
      ORDER BY c.documento ASC
    `
  );

  const pendingByCoordinator = [];
  for (const coordinator of result.rows) {
    const scope = await resolveCoordinatorScopeByRecord(pool, coordinator);
    if (!hasCoordinatorScope(scope)) {
      continue;
    }

    const pendientes = await fetchScopedPendingCount(scope);
    if (pendientes > 0) {
      pendingByCoordinator.push({
        coordinador_documento: coordinator.documento,
        coordinador_nombre: coordinator.coordinador_nombre,
        coordinador_correo: coordinator.coordinador_correo,
        facultades: await fetchScopeFacultyNames(scope),
        pendientes,
      });
    }
  }

  return pendingByCoordinator;
}

async function sendCoordinatorDigest(pendingInfo, now) {
  const recipient = String(pendingInfo.coordinador_correo || '')
    .trim()
    .toLowerCase();
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
