const cron = require('node-cron');
const { isArkaConfigured } = require('../libs/arka-reconciliation-client');
const { createArkaReconciliationService } = require('../libs/arka-reconciliation-service');

const service = createArkaReconciliationService();
let workerTask = null;
let monthlyTask = null;
let isWorkerRunning = false;
const WORKER_BATCH_SIZE = 5;

function isJobEnabled() {
  const enabled = String(process.env.ARKA_RECONCILIATION_ENABLED || 'true')
    .trim()
    .toLowerCase();
  return !['false', '0', 'no'].includes(enabled);
}

async function runWorkerCycle() {
  if (isWorkerRunning) return;
  isWorkerRunning = true;

  try {
    for (let index = 0; index < WORKER_BATCH_SIZE; index += 1) {
      const processed = await service.processNextQueued();
      if (!processed) break;
    }
  } catch (error) {
    console.error('Error en el worker de conciliaciones ARKA:', error);
  } finally {
    isWorkerRunning = false;
  }
}

async function runMonthlyCycle() {
  try {
    const result = await service.enqueueAll({ type: 'mensual' });
    console.info(
      `Conciliación ARKA mensual: ${result.enqueued} corridas encoladas para ${result.coordinators} coordinadores.`
    );
  } catch (error) {
    console.error('Error encolando las conciliaciones ARKA mensuales:', error);
  }
}

function startArkaReconciliationJobs() {
  if (!isJobEnabled()) return null;
  if (workerTask && monthlyTask) return { workerTask, monthlyTask };

  try {
    if (!isArkaConfigured()) {
      console.warn(
        'Jobs de conciliación ARKA no iniciados: configura las URL y OATI_CLIENT_ID/OATI_SECRET.'
      );
      return null;
    }
  } catch (error) {
    console.error('Configuración inválida para los jobs de conciliación ARKA:', error.message);
    return null;
  }

  workerTask = cron.schedule('* * * * *', runWorkerCycle, {
    timezone: 'America/Bogota',
    recoverMissedExecutions: true,
  });
  monthlyTask = cron.schedule('0 2 1 * *', runMonthlyCycle, {
    timezone: 'America/Bogota',
    recoverMissedExecutions: true,
  });

  return { workerTask, monthlyTask };
}

module.exports = {
  startArkaReconciliationJobs,
};
