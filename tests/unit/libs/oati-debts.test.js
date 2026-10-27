const test = require('node:test');
const assert = require('node:assert/strict');

const { config } = require('../../../src/config/config');
const {
  resolveSgaDebtorsServiceName,
  SGA_DEBTORS_SERVICE_NAMES,
} = require('../../../src/config/sga-services');
const {
  SgaDebtService,
  isLaboratoryConceptName,
  sgaDebtService,
  resolveSgaConceptName,
  resolveSgaConceptType,
  resolveSgaLaboratoryConceptName,
} = require('../../../src/libs/oati-debts');

function createService({ serviceName = 'academica_pruebas', studentResponse, debtResponse } = {}) {
  const calls = { academic: [], post: [] };
  const service = new SgaDebtService({
    serviceConfig: { oatiDebtorsServiceName: serviceName },
    academicServicePath: (servicePath) => servicePath,
    requestAcademicData: async (servicePath) => {
      calls.academic.push(servicePath);
      return typeof studentResponse === 'function'
        ? studentResponse(servicePath)
        : studentResponse || {};
    },
    requestPost: async (...args) => {
      calls.post.push(args);
      return typeof debtResponse === 'function'
        ? debtResponse(...args)
        : debtResponse || '<deudas/>';
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

test('SGA concept codes resolve the full catalog and keep laboratory classification separate', () => {
  const catalogCodes = [
    ...Array.from({ length: 24 }, (_, index) => String(index + 1)),
    ...Array.from({ length: 43 }, (_, index) => String(index + 30)),
  ];
  assert.equal(catalogCodes.length, 67);
  assert.ok(catalogCodes.every((code) => resolveSgaConceptName(code)));
  assert.ok(catalogCodes.every((code) => resolveSgaConceptType(code)));
  assert.equal(resolveSgaConceptName('1'), 'BIBLIOTECA INGENIERÍA');
  assert.equal(resolveSgaConceptName('9'), 'BIENESTAR UNIVERSITARIO');
  assert.equal(resolveSgaConceptName('4'), 'LABORATORIO DE QUIMICA');
  assert.equal(resolveSgaConceptName('04'), 'LABORATORIO DE QUIMICA');
  assert.equal(resolveSgaConceptName('8'), 'LABORATORIO DE FOTOGAMETRIA (VIVERO)');
  assert.equal(resolveSgaConceptName('14'), 'CENTRO INVEST. GEOG. CIIGER');
  assert.equal(resolveSgaConceptName('21'), 'DEPORTES - VIVERO');
  assert.equal(resolveSgaConceptName('23'), 'CENTRO DE DOCUMENTACIÓN DE ARTES');
  assert.equal(resolveSgaConceptName('24'), 'LAB. INGENIERÍA');
  assert.equal(resolveSgaConceptName('35'), 'XILOTECA VIVERO');
  assert.equal(resolveSgaConceptName('52'), 'BIBLIOTECA ADUANILLA DE PAIBA');
  assert.equal(resolveSgaConceptName('60'), 'LAB. CALIDAD DEL AGUA (BOSA)');
  assert.equal(resolveSgaConceptName('71'), 'LAB. TOPOGRAFIA (BOSA)');
  assert.equal(resolveSgaConceptName('72'), 'LAB. QUÍMICA ORGÁNICA (BOSA)');
  assert.equal(resolveSgaLaboratoryConceptName('4'), 'LABORATORIO DE QUIMICA');
  assert.equal(resolveSgaLaboratoryConceptName('14'), 'CENTRO INVEST. GEOG. CIIGER');
  assert.equal(resolveSgaLaboratoryConceptName('21'), 'DEPORTES - VIVERO');
  assert.equal(resolveSgaLaboratoryConceptName('23'), 'CENTRO DE DOCUMENTACIÓN DE ARTES');
  assert.equal(resolveSgaLaboratoryConceptName('35'), 'XILOTECA VIVERO');
  assert.equal(resolveSgaLaboratoryConceptName('55'), 'ZOONOSIS (FAMARENA)');
  assert.equal(resolveSgaLaboratoryConceptName('56'), 'CENTRO DE DOCUMENTACION SOCIALES');
  assert.equal(resolveSgaLaboratoryConceptName('1'), null);
  assert.equal(resolveSgaLaboratoryConceptName('9'), null);
  assert.equal(resolveSgaConceptType('4'), 'LABORATORIO');
  assert.equal(resolveSgaConceptType('1'), 'BIBLIOTECA');
  assert.equal(resolveSgaConceptType('9'), 'BIENESTAR');
  assert.equal(resolveSgaConceptName('999'), null);
  assert.equal(resolveSgaConceptName(''), null);
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

test('SgaDebtService considers states 1 and 2 active for numeric and string values', () => {
  const { service } = createService();
  assert.equal(service.isActiveDebt({ DEU_ESTADO: '1' }), true);
  assert.equal(service.isActiveDebt({ DEU_ESTADO: ' 1 ' }), true);
  assert.equal(service.isActiveDebt({ DEU_ESTADO: 1 }), true);
  assert.equal(service.isActiveDebt({ DEU_ESTADO: '2' }), true);
  assert.equal(service.isActiveDebt({ DEU_ESTADO: ' 2 ' }), true);
  assert.equal(service.isActiveDebt({ DEU_ESTADO: 2 }), true);
  assert.equal(service.isActiveDebt({ DEU_ESTADO: '3' }), false);
  assert.equal(service.isActiveDebt({ DEU_ESTADO: 3 }), false);
  assert.equal(service.isActiveDebt({ DEU_ESTADO: 0 }), false);
  assert.equal(service.isActiveDebt({ DEU_ESTADO: '4' }), false);
  assert.equal(service.isActiveDebt({}), false);
  assert.equal(service.isActiveDebt({ DEU_ESTADO: null }), false);
});

test('SgaDebtService includes the state-1 XML debt with nil fields reported by SGA', async () => {
  const { service, calls } = createService({
    serviceName: 'servicios_academicos_produccion',
    debtResponse: `
      <deudas xmlns="academica.co.edu.udistrital/qry_deudores">
        <estudiantes>
          <DEU_MATERIAL>Vaso precipitado 100 mL OMSONS</DEU_MATERIAL>
          <DEU_ESTAMENTO xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:nil="true"/>
          <DEU_ESTADO>1</DEU_ESTADO>
          <DEU_FECHA_PAGO xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:nil="true"/>
          <DEU_PER>3</DEU_PER>
          <DEU_FECHA>2026-08-28T00:00:00.000+00:00</DEU_FECHA>
          <DEU_ANO>2026</DEU_ANO>
          <DEU_MULTA>1</DEU_MULTA>
          <DEU_CPTO_COD>4</DEU_CPTO_COD>
          <DEU_ID>111957</DEU_ID>
          <DEU_EST_COD>20262109003</DEU_EST_COD>
        </estudiantes>
      </deudas>
    `,
  });

  const debts = await service.getActiveDebts({ codigo: '20262109003' });

  assert.equal(debts.length, 1);
  assert.equal(debts[0].DEU_ID, '111957');
  assert.equal(debts[0].DEU_ESTADO, '1');
  assert.equal(debts[0].DEU_MULTA, '1');
  assert.equal(debts[0].DEU_CPTO_NOMBRE, 'LABORATORIO DE QUIMICA');
  assert.equal(debts[0].DEU_MATERIAL, 'Vaso precipitado 100 mL OMSONS');
  assert.equal(debts[0].DEU_FECHA_PAGO, '');
  assert.equal(calls.post[0][0], service.buildServicePath('20262109003'));
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
        <estudiantes><DEU_EST_COD>2024100001</DEU_EST_COD><DEU_ESTADO>2</DEU_ESTADO><DEU_CPTO_COD>4</DEU_CPTO_COD></estudiantes>
        <estudiantes><DEU_EST_COD>2024100001</DEU_EST_COD><DEU_ESTADO>3</DEU_ESTADO></estudiantes>
      </deudas>
    `,
  });

  const activeDebts = await service.getActiveDebts({ documento: '79520182' });

  assert.equal(activeDebts.length, 1);
  assert.equal(activeDebts[0].DEU_ESTADO, '2');
  assert.equal(activeDebts[0].DEU_CPTO_NOMBRE, 'LABORATORIO DE QUIMICA');
  assert.deepEqual(calls.academic, ['datos_basicos_activos_cedula/79520182']);
  assert.equal(calls.post[0][0], 'wso2eiserver/services/academica_pruebas/deudores/2024100001');
  assert.match(calls.post[0][1], /<xs:codigo_estudiante>2024100001<\/xs:codigo_estudiante>/);
});

test('SgaDebtService handles Axios-parsed debts and returns mapped state-1 and state-2 records', async () => {
  const newDebt = {
    DEU_EST_COD: '20161104039',
    DEU_ESTADO: 1,
    DEU_ID: '111951',
    DEU_CPTO_COD: '4',
  };
  const activeDebt = {
    DEU_EST_COD: '20161104039',
    DEU_ESTADO: '2',
    DEU_ID: '75806',
    DEU_CPTO_COD: '7',
  };
  const paidDebt = { DEU_EST_COD: '20161104039', DEU_ESTADO: '3', DEU_ID: '92915' };
  const { service } = createService({
    debtResponse: { deudas: { estudiantes: [newDebt, activeDebt, paidDebt] } },
  });

  const result = await service.getActiveDebts({ codigo: '20161104039' });

  assert.deepEqual(
    result.map((debt) => [debt.DEU_ID, debt.DEU_CPTO_NOMBRE]),
    [
      ['111951', 'LABORATORIO DE QUIMICA'],
      ['75806', 'AUDIOVISUALES'],
    ]
  );
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

test('SGA debtors use the production service in every environment and ignore .env overrides', () => {
  const originalOverride = process.env.OATI_DEBT_SERVICE_NAME;
  process.env.OATI_DEBT_SERVICE_NAME = 'otro_servicio';

  try {
    for (const environmentName of [
      'production',
      'PRODUCTION',
      '',
      'dev',
      'development',
      'local',
      'test',
      'testing',
      'staging',
      'preprod',
    ]) {
      assert.equal(
        resolveSgaDebtorsServiceName(environmentName),
        'servicios_academicos_produccion'
      );
    }
    assert.ok(Object.isFrozen(SGA_DEBTORS_SERVICE_NAMES));
  } finally {
    if (originalOverride === undefined) delete process.env.OATI_DEBT_SERVICE_NAME;
    else process.env.OATI_DEBT_SERVICE_NAME = originalOverride;
  }
});

test('SgaDebtService builds the production debtors path', () => {
  const { service } = createService({ serviceName: 'servicios_academicos_produccion' });
  assert.equal(service.isConfigured(), true);
  assert.equal(
    service.buildServicePath('20161104039'),
    'wso2eiserver/services/servicios_academicos_produccion/deudores/20161104039'
  );
});

test('SgaDebtService keeps only active debts with concept codes in the allowed catalog', async () => {
  const labDebt = {
    DEU_ID: '1',
    DEU_ESTADO: '2',
    DEU_CPTO_COD: '4',
    DEU_MATERIAL: 'TABLET LENOVO PLACA 123',
  };
  const libraryDebts = [
    { DEU_ID: '5', DEU_ESTADO: '1', DEU_CPTO_COD: '1', DEU_MATERIAL: 'Biblioteca' },
    { DEU_ID: '2', DEU_ESTADO: '2', DEU_CPTO_COD: '1', DEU_MATERIAL: 'Biblioteca' },
    { DEU_ID: '3', DEU_ESTADO: '2', DEU_CPTO_COD: '999', DEU_MATERIAL: 'MULTA BIBLIOTECA CENTRAL' },
    {
      DEU_ID: '4',
      DEU_ESTADO: '2',
      DEU_CPTO_COD: '999',
      DEU_MATERIAL: 'libro no devuelto - bibliotéca',
    },
  ];
  const { service } = createService({
    debtResponse: { deudas: { estudiantes: [labDebt, ...libraryDebts] } },
  });

  const result = await service.getActiveDebts({ codigo: '20161104039' });

  assert.equal(result.length, 1);
  assert.equal(result[0].DEU_ID, labDebt.DEU_ID);
  assert.equal(result[0].DEU_CPTO_NOMBRE, 'LABORATORIO DE QUIMICA');
});

test('SgaDebtService classifies library debts by the reported detail', () => {
  const { service } = createService();

  assert.equal(service.isLibraryDebt({ DEU_MATERIAL: 'Biblioteca' }), true);
  assert.equal(service.isLibraryDebt({ DEU_MATERIAL: 'BIBLIOTECA' }), true);
  assert.equal(service.isLibraryDebt({ DEU_MATERIAL: 'Préstamo de BIBLIOTÉCA' }), true);
  assert.equal(service.isLibraryDebt({ DEU_MATERIAL: 'Osciloscopio' }), false);
  assert.equal(service.isLibraryDebt({ DEU_MATERIAL: null }), false);
  assert.equal(service.isLibraryDebt({}), false);
  assert.equal(
    service.isBlockingDebt({ DEU_ESTADO: '2', DEU_CPTO_COD: '4', DEU_MATERIAL: 'Biblioteca' }),
    false
  );
  assert.equal(
    service.isBlockingDebt({ DEU_ESTADO: '1', DEU_CPTO_COD: '4', DEU_MATERIAL: 'Osciloscopio' }),
    true
  );
  assert.equal(
    service.isBlockingDebt({ DEU_ESTADO: '3', DEU_CPTO_COD: '4', DEU_MATERIAL: 'Osciloscopio' }),
    false
  );
  assert.equal(
    service.isBlockingDebt({ DEU_ESTADO: '2', DEU_CPTO_COD: '999', DEU_MATERIAL: 'Osciloscopio' }),
    false
  );
});

test('laboratory concept matching uses whole words and ignores case and accents', () => {
  assert.equal(isLaboratoryConceptName('LABORATORIO DE QUÍMICA'), true);
  assert.equal(isLaboratoryConceptName('Lab. Topografía'), true);
  assert.equal(isLaboratoryConceptName('AUDIOVISUALES LAB'), true);
  assert.equal(isLaboratoryConceptName('ELABORADO POR LABORATORIO'), true);
  assert.equal(isLaboratoryConceptName('ELABORADO'), false);
  assert.equal(isLaboratoryConceptName('LABORATORIAL'), false);
  assert.equal(isLaboratoryConceptName(''), false);
});

test('queryStudent filters by allowed concept code and deduplicates SGA debts', async () => {
  const { service, calls } = createService({
    studentResponse: {
      datosEstudianteCollection: {
        datosBasicosEstudiante: [
          {
            codigo: '2024100001',
            documento: '79520182',
            nombre: 'Estudiante vigente',
            carrera: 'Ingeniería',
          },
          {
            codigo: '2015100001',
            documento: '79520182',
            estado: 'E',
            nombre: 'Estudiante histórico',
          },
        ],
      },
    },
    debtResponse: {
      deudas: {
        estudiantes: [
          {
            DEU_ID: '111',
            DEU_ESTADO: '2',
            DEU_CPTO_COD: '4',
            CPTO_NOMBRE: 'Laboratorio de Química',
            DEU_MATERIAL: 'Vaso de precipitados',
            DEU_MULTA: '650100',
            DEU_ANO: '2026',
            DEU_PER: '1',
          },
          {
            DEU_ID: '222',
            DEU_ESTADO: '1',
            DEU_CPTO_COD: '7',
            CPTO_NOMBRE: 'AUDIOVISUALES',
            DEU_MATERIAL: 'Proyector',
          },
          {
            DEU_ID: '333',
            DEU_CPTO_COD: '999',
            DEU_ESTADO: '3',
            CPTO_NOMBRE: 'LABORATORIO DE FISICA',
          },
          {
            DEU_ID: '444',
            DEU_ESTADO: '2',
            DEU_CPTO_COD: '999',
            CPTO_NOMBRE: 'LABORATORIO DE QUIMICA',
            DEU_MATERIAL: 'Concepto fuera del catálogo',
          },
        ],
      },
    },
  });

  const result = await service.queryStudent({
    codigo: '2024100001',
    documento: '79520182',
  });

  assert.equal(result.status, 'found');
  assert.deepEqual(result.codes, ['2024100001', '2015100001']);
  assert.equal(result.studentRecord.nombre, 'Estudiante vigente');
  assert.equal(result.studentRecord.carrera, 'Ingeniería');
  assert.equal(result.debts.length, 2);
  assert.equal(result.debts[0].id_sga, '111');
  assert.equal(result.debts[0].nombre_concepto, 'LABORATORIO DE QUIMICA');
  assert.equal(result.debts[0].codigo_estudiante, '2024100001');
  assert.equal(result.debts[0].valor, '650100');
  assert.equal(result.debts[1].nombre_concepto, 'AUDIOVISUALES');
  assert.equal(result.nonLaboratoryCount, 0);
  assert.equal(result.unclassifiedCount, 0);
  assert.equal(calls.post.length, 2);
  assert.ok(calls.academic.every((path) => path === 'datos_basicos_activos_cedula/79520182'));
});

test('queryStudent classifies a mapped concept when OATI omits its name', async () => {
  const { service } = createService({
    studentResponse: {
      datosEstudianteCollection: {
        datosBasicosEstudiante: [{ codigo: '2024100001', documento: '79520182' }],
      },
    },
    debtResponse: {
      deudas: {
        estudiantes: [{ DEU_ID: '1', DEU_ESTADO: '2', DEU_CPTO_COD: '4' }],
      },
    },
  });

  const result = await service.queryStudent({
    codigo: '2024100001',
    documento: '79520182',
  });

  assert.equal(result.status, 'found');
  assert.equal(result.debts.length, 1);
  assert.equal(result.debts[0].nombre_concepto, 'LABORATORIO DE QUIMICA');
  assert.equal(result.unclassifiedCount, 0);
});

test('queryStudent returns active non-laboratory debts only when explicitly requested', async () => {
  const { service } = createService({
    studentResponse: {
      datosEstudianteCollection: {
        datosBasicosEstudiante: [{ codigo: '2024100001', documento: '79520182' }],
      },
    },
    debtResponse: {
      deudas: {
        estudiantes: [
          {
            DEU_ID: 'lab-1',
            DEU_EST_COD: '2024100001',
            DEU_ESTADO: '2',
            DEU_CPTO_COD: '4',
          },
          {
            DEU_ID: 'other-1',
            DEU_EST_COD: '2024100001',
            DEU_ESTADO: '2',
            DEU_CPTO_COD: '1',
            CPTO_NOMBRE: 'BIBLIOTECA INGENIERÍA',
            DEU_MATERIAL: 'Libro pendiente',
          },
          {
            DEU_ID: 'other-2',
            DEU_EST_COD: '2024100001',
            DEU_ESTADO: '1',
            DEU_CPTO_COD: '9',
            CPTO_NOMBRE: 'BIENESTAR UNIVERSITARIO',
          },
          {
            DEU_ID: 'inactive',
            DEU_EST_COD: '2024100001',
            DEU_ESTADO: '3',
            DEU_CPTO_COD: '1',
          },
          {
            DEU_ID: 'library-detail',
            DEU_EST_COD: '2024100001',
            DEU_ESTADO: '2',
            DEU_CPTO_COD: '7',
            DEU_MATERIAL: 'Biblioteca audiovisual',
          },
          {
            DEU_ID: 'unknown-1',
            DEU_EST_COD: '2024100001',
            DEU_ESTADO: '2',
            DEU_CPTO_COD: '999',
            CPTO_NOMBRE: 'CONCEPTO DESCONOCIDO',
          },
        ],
      },
    },
  });

  const result = await service.queryStudent({
    documento: '79520182',
    includeOtherDebts: true,
  });

  assert.equal(result.status, 'found');
  assert.deepEqual(
    result.debts.map((debt) => debt.id_sga),
    ['lab-1']
  );
  assert.deepEqual(
    result.otherDebts.map((debt) => debt.id_sga),
    ['other-1', 'other-2', 'library-detail']
  );
  assert.equal(result.otherDebts[0].nombre_concepto, 'BIBLIOTECA INGENIERÍA');
  assert.equal(result.otherDebts[0].tipo_concepto, 'BIBLIOTECA');
  assert.equal(result.otherDebts[1].nombre_concepto, 'BIENESTAR UNIVERSITARIO');
  assert.equal(result.otherDebts[1].tipo_concepto, 'BIENESTAR');
  assert.equal(result.otherDebts[0].codigo_estudiante, '2024100001');
});

test('other active SGA debts do not count as laboratory fines', async () => {
  const { service } = createService({
    studentResponse: {
      datosEstudianteCollection: {
        datosBasicosEstudiante: [{ codigo: '2024100001', documento: '79520182' }],
      },
    },
    debtResponse: {
      deudas: {
        estudiantes: [
          {
            DEU_ID: 'other-1',
            DEU_EST_COD: '2024100001',
            DEU_ESTADO: '2',
            DEU_CPTO_COD: '1',
            CPTO_NOMBRE: 'BIBLIOTECA INGENIERÍA',
          },
        ],
      },
    },
  });

  const result = await service.queryStudent({
    documento: '79520182',
    includeOtherDebts: true,
  });

  assert.equal(result.status, 'clear');
  assert.deepEqual(result.debts, []);
  assert.equal(result.otherDebts.length, 1);
});

test('queryStudent silently discards active debts with concept codes outside the allowed catalog', async () => {
  const { service } = createService({
    studentResponse: {
      datosEstudianteCollection: {
        datosBasicosEstudiante: [{ codigo: '2024100001', documento: '79520182' }],
      },
    },
    debtResponse: {
      deudas: {
        estudiantes: [
          {
            DEU_ID: '1',
            DEU_ESTADO: '2',
            DEU_CPTO_COD: '999',
            CPTO_NOMBRE: 'LABORATORIO DE QUIMICA',
          },
        ],
      },
    },
  });

  const result = await service.queryStudent({
    codigo: '2024100001',
    documento: '79520182',
  });

  assert.equal(result.status, 'clear');
  assert.deepEqual(result.debts, []);
  assert.deepEqual(result.otherDebts, []);
  assert.equal(result.unclassifiedCount, 0);
});

test('queryStudent does not query SGA when identity lookup is unavailable', async () => {
  let debtRequests = 0;
  const { service } = createService({
    studentResponse: async () => {
      const error = new Error('OATI offline');
      error.code = 'OATI_UNAVAILABLE';
      throw error;
    },
    debtResponse: () => {
      debtRequests += 1;
      return {
        deudas: {
          estudiantes: [
            {
              DEU_ID: '1',
              DEU_EST_COD: '2024100001',
              DEU_ESTADO: '2',
              DEU_CPTO_NOMBRE: 'LAB. TOPOGRAFIA',
            },
          ],
        },
      };
    },
  });

  const result = await service.queryStudent({
    codigo: '2024100001',
    documento: '79520182',
  });

  assert.equal(result.status, 'error');
  assert.deepEqual(result.debts, []);
  assert.equal(result.errors[0].code, 'OATI_UNAVAILABLE');
  assert.equal(debtRequests, 0);
});

test('queryStudent does not query SGA when an identifier cannot be resolved to a student', async () => {
  const { service, calls } = createService({
    studentResponse: { datosEstudianteCollection: { datosBasicosEstudiante: [] } },
  });

  const result = await service.queryStudent({ identificador: '10000000' });

  assert.equal(result.status, 'unresolved');
  assert.deepEqual(result.codes, []);
  assert.equal(calls.post.length, 0);
  assert.deepEqual(calls.academic, [
    'datos_basicos_estudiante/10000000',
    'datos_basicos_activos_cedula/10000000',
  ]);
});

test('queryStudent does not attribute a supplied code that OAS does not associate with the document', async () => {
  const { service, calls } = createService({
    studentResponse: {
      datosEstudianteCollection: {
        datosBasicosEstudiante: [{ codigo: '2015100001', documento: '79520182' }],
      },
    },
    debtResponse: '<deudas/>',
  });

  const result = await service.queryStudent({
    codigo: '2024100001',
    documento: '79520182',
  });

  assert.equal(result.status, 'partial');
  assert.deepEqual(result.codes, ['2015100001']);
  assert.equal(result.errors[0].code, 'STUDENT_CODE_DOCUMENT_ASSOCIATION_UNCONFIRMED');
  assert.deepEqual(
    calls.post.map(([path]) => path),
    [service.buildServicePath('2015100001')]
  );
});

test('queryStudent rejects an identifier that resolves to two different students', async () => {
  const { service, calls } = createService({
    studentResponse: (servicePath) => {
      const codigoLookup = servicePath.startsWith('datos_basicos_estudiante/');
      return {
        datosEstudianteCollection: {
          datosBasicosEstudiante: codigoLookup
            ? [{ codigo: '12345', documento: '20001' }]
            : [{ codigo: '67890', documento: '12345' }],
        },
      };
    },
  });

  const result = await service.queryStudent({ identificador: '12345' });

  assert.equal(result.status, 'unresolved');
  assert.deepEqual(result.codes, []);
  assert.equal(result.errors[0].code, 'AMBIGUOUS_STUDENT_IDENTITY');
  assert.equal(calls.post.length, 0);
});
