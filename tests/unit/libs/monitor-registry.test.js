const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ensureMonitorSchema,
  fetchMonitorByDocumento,
  upsertMonitorProfile,
} = require('../../../src/libs/monitor-registry');

function createExecutor(results = []) {
  const calls = [];

  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return results.shift() || { rows: [] };
    },
  };
}

test('ensureMonitorSchema creates table and index only once per process', async () => {
  const executor = createExecutor();

  await ensureMonitorSchema(executor);
  const firstCallCount = executor.calls.length;
  await ensureMonitorSchema(executor);

  assert.equal(firstCallCount, 2);
  assert.equal(executor.calls.length, 2);
});

test('fetchMonitorByDocumento returns null for empty documento', async () => {
  const executor = createExecutor();

  const result = await fetchMonitorByDocumento('   ', executor);

  assert.equal(result, null);
  assert.equal(executor.calls.some((call) => call.sql.includes('FROM monitor')), false);
});

test('fetchMonitorByDocumento returns the first matching row', async () => {
  const executor = createExecutor([
    {
      rows: [
        {
          documento: '123',
          nombre: 'Monitor Uno',
          correo: 'monitor@udistrital.edu.co',
          usuario_id: 7,
          activo: true,
        },
      ],
    },
  ]);

  const result = await fetchMonitorByDocumento('123', executor);

  assert.equal(result.documento, '123');
  assert.equal(result.correo, 'monitor@udistrital.edu.co');
});

test('upsertMonitorProfile rejects missing base monitor data', async () => {
  const executor = createExecutor();

  await assert.rejects(
    upsertMonitorProfile({ documento: '', nombre: 'Monitor', correo: '' }, executor),
    /Los datos base del monitor son obligatorios\./
  );
});

test('upsertMonitorProfile normalizes correo and optional fields before persisting', async () => {
  const executor = createExecutor();

  await upsertMonitorProfile(
    {
      documento: '123',
      nombre: 'Monitor Uno',
      correo: '  MONITOR@UDISTRITAL.EDU.CO ',
      numeroContrato: ' CPS-001 ',
      tipoVinculacion: 'Monitoria',
      fechaInicio: '2026-01-15',
      soporteContrato: ' soporte.pdf ',
      usuarioId: '8',
      activo: true,
    },
    executor
  );

  const insertCall = executor.calls.find((call) => call.sql.includes('INSERT INTO monitor'));

  assert.deepEqual(insertCall.params, [
    '123',
    'Monitor Uno',
    'monitor@udistrital.edu.co',
    'CPS-001',
    'Monitoria',
    '2026-01-15',
    null,
    'soporte.pdf',
    8,
    true,
  ]);
});