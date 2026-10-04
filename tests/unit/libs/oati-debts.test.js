const test = require('node:test');
const assert = require('node:assert/strict');

const { config } = require('../../../src/config/config');
const { SgaDebtService, sgaDebtService } = require('../../../src/libs/oati-debts');

function createService({ serviceName = 'academica_pruebas', studentResponse, debtResponse } = {}) {
  const calls = { academic: [], post: [] };
  const service = new SgaDebtService({
    serviceConfig: { oatiDebtorsServiceName: serviceName },
    academicServicePath: (servicePath) => servicePath,
    requestAcademicData: async (servicePath) => {
      calls.academic.push(servicePath);
      return studentResponse || {};
    },
    requestPost: async (...args) => {
      calls.post.push(args);
      return debtResponse || '<deudas/>';
    },
  });

  return { service, calls };
}

test('SgaDebtService parses repeated SGA estudiante records', () => {
  const { service } = createService();
  const result = service.parseResponse(`
    <deudas xmlns="http://ws.wso2.org/dataservice/qry_deudores">
      <estudiantes>
        <DEU_EST_COD>2024100001</DEU_EST_COD>
        <DEU_ESTADO>2</DEU_ESTADO>
        <DEU_MULTA>650100</DEU_MULTA>
      </estudiantes>
      <estudiantes>
        <DEU_EST_COD>2024100001</DEU_EST_COD>
        <DEU_ESTADO>3</DEU_ESTADO>
        <DEU_FECHA_PAGO>2026-09-23T00:00:00.000+00:00</DEU_FECHA_PAGO>
      </estudiantes>
    </deudas>
  `);

  assert.equal(result.length, 2);
  assert.equal(result[0].DEU_EST_COD, '2024100001');
  assert.equal(result[0].DEU_MULTA, '650100');
  assert.equal(result[1].DEU_ESTADO, '3');
});

test('SgaDebtService returns an empty list for a valid no-debts response', () => {
  const { service } = createService();
  assert.deepEqual(service.parseResponse('<deudas/>'), []);
});

test('SgaDebtService accepts the object Axios creates from an XML response', () => {
  const { service } = createService();
  const activeDebt = { DEU_EST_COD: '20161104039', DEU_ESTADO: '2' };

  assert.deepEqual(service.parseResponse({ deudas: { estudiantes: [activeDebt] } }), [activeDebt]);
});

test('SgaDebtService rejects responses without the expected root', () => {
  const { service } = createService();
  assert.throws(() => service.parseResponse('<error>unavailable</error>'), /resultado de deudas/i);
});

test('SgaDebtService considers only state 2 active', () => {
  const { service } = createService();
  assert.equal(service.isActiveDebt({ DEU_ESTADO: '2' }), true);
  assert.equal(service.isActiveDebt({ DEU_ESTADO: ' 2 ' }), true);
  assert.equal(service.isActiveDebt({ DEU_ESTADO: '3' }), false);
  assert.equal(service.isActiveDebt({ DEU_ESTADO: null }), false);
});

test('SgaDebtService detects whether the environment configured the service', () => {
  const { service } = createService({ serviceName: '' });
  assert.equal(service.isConfigured(), false);
  assert.equal(sgaDebtService.isConfigured(), Boolean(config.oatiDebtorsServiceName));
});

test('SgaDebtService resolves a document to student code and fetches active SGA debts', async () => {
  const { service, calls } = createService({
    studentResponse: {
      datosEstudianteCollection: {
        datosBasicosEstudiante: [{ codigo: '2024100001', documento: '79520182' }],
      },
    },
    debtResponse: `
      <deudas xmlns="http://ws.wso2.org/dataservice/qry_deudores">
        <estudiantes><DEU_EST_COD>2024100001</DEU_EST_COD><DEU_ESTADO>2</DEU_ESTADO></estudiantes>
        <estudiantes><DEU_EST_COD>2024100001</DEU_EST_COD><DEU_ESTADO>3</DEU_ESTADO></estudiantes>
      </deudas>
    `,
  });

  const activeDebts = await service.getActiveDebts({ documento: '79520182' });

  assert.equal(activeDebts.length, 1);
  assert.equal(activeDebts[0].DEU_ESTADO, '2');
  assert.deepEqual(calls.academic, ['datos_basicos_estudiante/79520182']);
  assert.equal(calls.post[0][0], 'wso2eiserver/services/academica_pruebas/deudores/2024100001');
  assert.match(calls.post[0][1], /<xs:codigo_estudiante>2024100001<\/xs:codigo_estudiante>/);
});

test('SgaDebtService handles Axios-parsed debts and returns only state-2 records', async () => {
  const activeDebt = { DEU_EST_COD: '20161104039', DEU_ESTADO: '2', DEU_ID: '75806' };
  const paidDebt = { DEU_EST_COD: '20161104039', DEU_ESTADO: '3', DEU_ID: '92915' };
  const { service } = createService({
    debtResponse: { deudas: { estudiantes: [activeDebt, paidDebt] } },
  });

  const result = await service.getActiveDebts({
    codigo: '20161104039',
    documento: '1089907605',
  });

  assert.deepEqual(result, [activeDebt]);
});

test('SgaDebtService skips SGA and academic requests when not configured', async () => {
  const { service, calls } = createService({ serviceName: '' });

  assert.deepEqual(await service.getActiveDebts({ documento: '79520182' }), []);
  assert.equal(calls.academic.length, 0);
  assert.equal(calls.post.length, 0);
});

test('SgaDebtService uses an explicit environment service name', () => {
  const originalServiceName = config.oatiDebtorsServiceName;

  try {
    config.oatiDebtorsServiceName = 'academica_pruebas';
    assert.equal(sgaDebtService.isConfigured(), true);

    config.oatiDebtorsServiceName = '';
    assert.equal(sgaDebtService.isConfigured(), false);
  } finally {
    config.oatiDebtorsServiceName = originalServiceName;
  }
});
