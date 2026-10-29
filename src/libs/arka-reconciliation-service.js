const crypto = require('node:crypto');
const pool = require('./db');
const {
  ArkaIntegrationError,
  createArkaClient,
  isArkaConfigured,
} = require('./arka-reconciliation-client');
const { buildReconciliationSnapshot } = require('./arka-reconciliation-matcher');
const { sendEmailNotification } = require('./email-notifications');

const LEASE_DURATION_MINUTES = 30;
const INSERT_BATCH_SIZE = 400;

function isReconciliationEnabled() {
  const enabled = String(process.env.ARKA_RECONCILIATION_ENABLED || 'true')
    .trim()
    .toLowerCase();
  return !['false', '0', 'no'].includes(enabled);
}

function getBogotaMonthStart(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return `${year}-${month}-01`;
}

function getSafeError(error) {
  if (error instanceof ArkaIntegrationError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: String(error?.code || 'ARKA_RECONCILIATION_ERROR').slice(0, 80),
    message: 'No fue posible completar la conciliación. Revisa los registros del servidor.',
  };
}

function getAppUrl() {
  const baseUrl = String(process.env.APP_BASE_URL || '')
    .trim()
    .replace(/\/+$/, '');
  if (!baseUrl) return '';
  return `${baseUrl.endsWith('/milab') ? baseUrl : `${baseUrl}/milab`}/inventarios/conciliaciones-arka`;
}

function buildInsertQuery(rows) {
  const placeholders = [];
  const values = [];

  rows.forEach((row) => {
    const rowPlaceholders = row.map((value) => {
      values.push(value);
      return `$${values.length}`;
    });
    placeholders.push(`(${rowPlaceholders.join(', ')})`);
  });

  return {
    text: `VALUES ${placeholders.join(', ')}`,
    values,
  };
}

function createArkaReconciliationService({
  database = pool,
  arkaClientFactory = createArkaClient,
  sendNotification = sendEmailNotification,
  logger = console,
} = {}) {
  async function enqueueAll({
    type = 'manual',
    requestedByDocument = null,
    now = new Date(),
  } = {}) {
    if (!['manual', 'mensual'].includes(type)) {
      throw new TypeError('El tipo de corrida ARKA no es válido.');
    }

    if (!isReconciliationEnabled()) {
      throw new ArkaIntegrationError(
        'Las conciliaciones ARKA están deshabilitadas en este ambiente.',
        'ARKA_RECONCILIATION_DISABLED'
      );
    }

    if (!isArkaConfigured()) {
      throw new ArkaIntegrationError(
        'ARKA no está configurado. Verifica las URL y las credenciales OATI_CLIENT_ID y OATI_SECRET.',
        'ARKA_CONFIGURATION_ERROR'
      );
    }

    const coordinators = await database.query(
      `
        SELECT DISTINCT encargado.coordinador_documento
        FROM coordinador_ual_encargado encargado
        JOIN coordinador c
          ON c.documento = encargado.coordinador_documento
         AND c.activo = TRUE
        JOIN ual u
          ON u.ual_id = encargado.ual_id
         AND u.activo = TRUE
        ORDER BY encargado.coordinador_documento
      `
    );
    const documents = coordinators.rows.map((row) => row.coordinador_documento);
    if (!documents.length) return { enqueued: 0, coordinators: 0 };

    const period = type === 'mensual' ? getBogotaMonthStart(now) : null;
    const result = await database.query(
      `
        INSERT INTO arka_conciliacion_corrida (
          coordinador_documento,
          tipo,
          periodo_mensual,
          estado,
          solicitada_por_documento
        )
        SELECT documento, $2, $3::date, 'en_cola', $4
        FROM UNNEST($1::varchar[]) AS pendientes(documento)
        ON CONFLICT DO NOTHING
        RETURNING id
      `,
      [documents, type, period, requestedByDocument]
    );

    return { enqueued: result.rowCount, coordinators: documents.length };
  }

  async function claimNext() {
    const leaseToken = crypto.randomUUID();
    const result = await database.query(
      `
        WITH siguiente AS (
          SELECT id
          FROM arka_conciliacion_corrida
          WHERE estado = 'en_cola'
             OR (estado = 'procesando' AND lease_hasta < CURRENT_TIMESTAMP)
          ORDER BY fecha_solicitud, id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE arka_conciliacion_corrida corrida
        SET estado = 'procesando',
            fecha_inicio = COALESCE(corrida.fecha_inicio, CURRENT_TIMESTAMP),
            lease_token = $1::uuid,
            lease_hasta = CURRENT_TIMESTAMP + ($2::int * INTERVAL '1 minute'),
            codigo_error = NULL,
            mensaje_error = NULL
        FROM siguiente
        WHERE corrida.id = siguiente.id
        RETURNING corrida.id, corrida.coordinador_documento, corrida.lease_token
      `,
      [leaseToken, LEASE_DURATION_MINUTES]
    );
    return result.rows[0] || null;
  }

  async function fetchCoordinator(databaseClient, document) {
    const result = await databaseClient.query(
      `
        SELECT
          c.documento,
          COALESCE(NULLIF(TRIM(c.nombre), ''), NULLIF(TRIM(u.nombre), ''), 'Coordinador') AS nombre,
          LOWER(NULLIF(TRIM(u.correo), '')) AS correo
        FROM coordinador c
        LEFT JOIN LATERAL (
          SELECT id, nombre, correo
          FROM usuario
          WHERE id = c.usuario_id
             OR documento = c.documento
          ORDER BY CASE WHEN id = c.usuario_id THEN 1 ELSE 2 END, id
          LIMIT 1
        ) u ON TRUE
        WHERE c.documento = $1
          AND c.activo = TRUE
        LIMIT 1
      `,
      [document]
    );
    return result.rows[0] || null;
  }

  async function fetchCoordinatorInventory(databaseClient, document) {
    const result = await databaseClient.query(
      `
        SELECT
          u.ual_id,
          i.id AS inventario_id,
          i.placa,
          i.serie,
          i.nombre_bien AS nombre,
          COALESCE(
            ARRAY_AGG(DISTINCT ii.valor_normalizado)
              FILTER (WHERE ii.tipo = 'identificador_id'),
            ARRAY[]::varchar[]
          ) AS arka_ids,
          COALESCE(
            ARRAY_AGG(DISTINCT ii.valor_normalizado)
              FILTER (WHERE ii.tipo = 'placa_arka'),
            ARRAY[]::varchar[]
          ) AS placas,
          COALESCE(
            ARRAY_AGG(DISTINCT ii.valor_normalizado)
              FILTER (WHERE ii.tipo = 'serie'),
            ARRAY[]::varchar[]
          ) AS series
        FROM coordinador_ual_encargado encargado
        JOIN ual u
          ON u.ual_id = encargado.ual_id
         AND u.activo = TRUE
        LEFT JOIN inventario_estado_laboratorio estado
          ON estado.ual_id = u.ual_id
         AND estado.tipo_inventario = 'equipo_arka'
         AND estado.estado = 'aprobado'
        LEFT JOIN inventario i
          ON estado.ual_id IS NOT NULL
         AND i.laboratorio_ual_id = u.ual_id
         AND i.tipo_inventario = 'equipo_arka'
         AND i.estado_aprobacion = 'aprobado'
         AND i.activo = TRUE
        LEFT JOIN inventario_identificador ii
          ON ii.inventario_id = i.id
         AND ii.ual_id = u.ual_id
         AND ii.activo = TRUE
         AND ii.tipo IN ('identificador_id', 'placa_arka', 'serie')
        WHERE encargado.coordinador_documento = $1
        GROUP BY u.ual_id, i.id
        ORDER BY u.ual_id, i.id
      `,
      [document]
    );

    const ualIds = Array.from(new Set(result.rows.map((row) => row.ual_id)));
    const inventoryItems = result.rows
      .filter((row) => row.inventario_id !== null)
      .map((row) => ({
        inventarioId: row.inventario_id,
        ualId: row.ual_id,
        placa: row.placa || '',
        serie: row.serie || '',
        nombre: row.nombre || '',
        arkaIds: row.arka_ids || [],
        plates: row.placas || [],
        series: row.series || [],
      }));

    return { inventoryItems, ualIds };
  }

  async function insertDetails(client, runId, details) {
    const columnNames = [
      'corrida_id',
      'indice_arka',
      'arka_id',
      'arka_elemento_acta_id',
      'arka_placa',
      'arka_serie',
      'arka_nombre',
      'arka_marca',
      'inventario_id',
      'ual_id',
      'inventario_placa',
      'inventario_serie',
      'inventario_nombre',
      'tipo_coincidencia',
      'estado',
      'clave_alerta',
    ];

    for (let offset = 0; offset < details.length; offset += INSERT_BATCH_SIZE) {
      const batch = details.slice(offset, offset + INSERT_BATCH_SIZE);
      const rows = batch.map((detail) => [
        runId,
        detail.sourceIndex ?? null,
        detail.arkaId,
        detail.arkaElementoActaId,
        detail.arkaPlaca,
        detail.arkaSerie,
        detail.arkaNombre,
        detail.arkaMarca,
        detail.inventarioId,
        detail.ualId,
        detail.inventarioPlaca,
        detail.inventarioSerie,
        detail.inventarioNombre,
        detail.matchType,
        detail.status,
        detail.alertKey || null,
      ]);
      const query = buildInsertQuery(rows);
      await client.query(
        `INSERT INTO arka_conciliacion_detalle (${columnNames.join(', ')}) ${query.text}`,
        query.values
      );
    }
  }

  async function insertUalSummaries(client, runId, summaryByUal) {
    const rows = Array.from(summaryByUal.entries()).map(([ualId, summary]) => [
      runId,
      ualId,
      summary.milabTotal,
      summary.matchedTotal,
      summary.unmatchedTotal,
    ]);
    if (!rows.length) return;

    const query = buildInsertQuery(rows);
    await client.query(
      `
        INSERT INTO arka_conciliacion_ual (
          corrida_id, ual_id, total_milab, total_coincidencias, total_no_coincidentes
        )
        ${query.text}
      `,
      query.values
    );
  }

  async function persistSnapshot({ job, arkaItems, coordinator, details, summaryByUal }) {
    const databaseClient = await database.connect();
    let transactionStarted = false;
    const alertCount = details.filter((detail) => detail.status !== 'coincide').length;

    try {
      await databaseClient.query('BEGIN');
      transactionStarted = true;
      const lease = await databaseClient.query(
        `
          SELECT id
          FROM arka_conciliacion_corrida
          WHERE id = $1
            AND estado = 'procesando'
            AND lease_token = $2::uuid
          FOR UPDATE
        `,
        [job.id, job.lease_token]
      );
      if (!lease.rowCount) {
        throw new Error('La corrida perdió su lease antes de guardar el snapshot.');
      }

      await insertDetails(databaseClient, job.id, details);
      await insertUalSummaries(databaseClient, job.id, summaryByUal);

      await databaseClient.query(
        `
          UPDATE arka_conciliacion_alerta
          SET estado = 'resuelta',
              fecha_resolucion = CURRENT_TIMESTAMP
          WHERE coordinador_documento = $1
            AND estado = 'activa'
        `,
        [job.coordinador_documento]
      );
      await databaseClient.query(
        `
          INSERT INTO arka_conciliacion_alerta (
            coordinador_documento, clave_alerta, corrida_id, ual_id, estado,
            primera_aparicion, ultima_aparicion
          )
          SELECT DISTINCT ON (detalle.clave_alerta)
            $1,
            detalle.clave_alerta,
            $2,
            detalle.ual_id,
            'activa',
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          FROM arka_conciliacion_detalle detalle
          WHERE detalle.corrida_id = $2
            AND detalle.clave_alerta IS NOT NULL
          ORDER BY detalle.clave_alerta, detalle.id
          ON CONFLICT (coordinador_documento, clave_alerta)
          DO UPDATE SET
            corrida_id = EXCLUDED.corrida_id,
            ual_id = EXCLUDED.ual_id,
            estado = 'activa',
            ultima_aparicion = CURRENT_TIMESTAMP,
            fecha_resolucion = NULL
        `,
        [job.coordinador_documento, job.id]
      );
      await databaseClient.query(
        `
          UPDATE arka_conciliacion_corrida
          SET estado = 'completado',
              fecha_fin = CURRENT_TIMESTAMP,
              lease_token = NULL,
              lease_hasta = NULL,
              total_arka = $3,
              total_alertas = $4,
              codigo_error = NULL,
              mensaje_error = NULL
          WHERE id = $1
            AND lease_token = $2::uuid
        `,
        [job.id, job.lease_token, arkaItems.length, alertCount]
      );
      await databaseClient.query('COMMIT');
      transactionStarted = false;
    } catch (error) {
      if (transactionStarted) {
        await databaseClient.query('ROLLBACK');
      }
      throw error;
    } finally {
      databaseClient.release();
    }

    if (alertCount > 0) {
      await sendAlertEmail({
        coordinator,
        jobId: job.id,
        alertCount,
      });
    }

    return { alertCount };
  }

  async function sendAlertEmail({ coordinator, jobId, alertCount }) {
    const recipient = String(coordinator?.correo || '')
      .trim()
      .toLowerCase();
    if (!recipient) {
      await database.query(
        `UPDATE arka_conciliacion_corrida
         SET error_correo = 'No hay correo registrado en el usuario de MiLab.'
         WHERE id = $1`,
        [jobId]
      );
      logger.warn(
        `Conciliación ARKA ${jobId}: el coordinador no tiene correo en su usuario de MiLab.`
      );
      return;
    }

    try {
      await sendNotification({
        sourceSystem: 'inventarios',
        templateName: 'inventarios/arka_conciliacion_alerta',
        recipient,
        subject: `MILab: tienes ${alertCount} elementos de inventario por conciliar en ARKA`,
        variables: {
          coordinadorNombre: coordinator.nombre,
          cantidadAlertas: alertCount,
          conciliacionUrl: getAppUrl(),
          fechaCorte: new Intl.DateTimeFormat('es-CO', {
            timeZone: 'America/Bogota',
            dateStyle: 'full',
            timeStyle: 'short',
          }).format(new Date()),
        },
        correlationId: `arka-conciliacion-${jobId}`,
        throwOnError: true,
      });
    } catch (error) {
      logger.error(`Conciliación ARKA ${jobId}: no fue posible notificar al coordinador.`, error);
      await database.query(
        `UPDATE arka_conciliacion_corrida
         SET error_correo = $2
         WHERE id = $1`,
        [jobId, String(error?.message || 'Error al enviar el correo.').slice(0, 2000)]
      );
    }
  }

  async function markFailed(job, error) {
    const safeError = getSafeError(error);
    await database.query(
      `
        UPDATE arka_conciliacion_corrida
        SET estado = 'fallido',
            fecha_fin = CURRENT_TIMESTAMP,
            lease_token = NULL,
            lease_hasta = NULL,
            codigo_error = $3,
            mensaje_error = $4
        WHERE id = $1
          AND lease_token = $2::uuid
      `,
      [job.id, job.lease_token, safeError.code, safeError.message]
    );
    logger.error(`Error en conciliación ARKA ${job.id}: ${safeError.message}`, error);
  }

  async function processClaimedJob(job) {
    const arkaClient = arkaClientFactory();
    const result = await arkaClient.getCoordinatorInventory(job.coordinador_documento);

    const databaseClient = await database.connect();
    let coordinator;
    let inventory;
    try {
      coordinator = await fetchCoordinator(databaseClient, job.coordinador_documento);
      if (!coordinator) {
        throw new ArkaIntegrationError(
          'El coordinador de la corrida ya no está activo en MiLab.',
          'ARKA_COORDINATOR_NOT_FOUND'
        );
      }
      inventory = await fetchCoordinatorInventory(databaseClient, job.coordinador_documento);
    } finally {
      databaseClient.release();
    }

    const snapshot = buildReconciliationSnapshot({
      arkaItems: result.items,
      inventoryItems: inventory.inventoryItems,
      ualIds: inventory.ualIds,
    });
    await persistSnapshot({
      job,
      arkaItems: result.items,
      coordinator,
      details: snapshot.details,
      summaryByUal: snapshot.summaryByUal,
    });
    return true;
  }

  async function processNextQueued() {
    const job = await claimNext();
    if (!job) return false;

    try {
      await processClaimedJob(job);
    } catch (error) {
      await markFailed(job, error);
    }
    return true;
  }

  return {
    enqueueAll,
    processNextQueued,
  };
}

module.exports = {
  createArkaReconciliationService,
  getBogotaMonthStart,
};
