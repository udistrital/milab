const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../../src/libs/service-status.js');
const oatiClientPath = path.resolve(__dirname, '../../../src/libs/oati-client.js');
const edxClientPath = path.resolve(__dirname, '../../../src/libs/edx-cert-client.js');

function createLog() {
  const warnings = [];
  const errors = [];
  return {
    warnings,
    errors,
    warn: (payload) => warnings.push(payload),
    error: (payload) => errors.push(payload),
  };
}

function loadServiceStatus({ oatiImpl = async () => ({}), edxHealthy = true } = {}) {
  const originals = new Map();
  const oatiCalls = [];
  const edxCalls = [];
  const stubs = [
    [
      oatiClientPath,
      {
        getAcademicServicePath: (value) => value,
        requestOati: async (value) => {
          oatiCalls.push(value);
          return oatiImpl(value);
        },
      },
    ],
    [
      edxClientPath,
      {
        healthCheck: async () => {
          edxCalls.push(true);
          return edxHealthy;
        },
        BASE_URL: 'http://localhost:4000',
        USE_MOCK: true,
      },
    ],
  ];

  delete require.cache[modulePath];
  for (const [stubPath, exports] of stubs) {
    originals.set(stubPath, require.cache[stubPath]);
    require.cache[stubPath] = { id: stubPath, filename: stubPath, loaded: true, exports };
  }

  return {
    ...require(modulePath),
    oatiCalls,
    edxCalls,
    restore() {
      for (const [stubPath, original] of originals.entries()) {
        if (original) require.cache[stubPath] = original;
        else delete require.cache[stubPath];
      }
      delete require.cache[modulePath];
    },
  };
}

test('checkServiceStatus skips edX in production so it cannot mark the portal down', async () => {
  const loaded = loadServiceStatus({ edxHealthy: false });
  const log = createLog();

  try {
    const status = await loaded.checkServiceStatus(log, { checkEdx: false });

    assert.equal(status.servicesAreUp, true);
    assert.equal(loaded.edxCalls.length, 0);
    assert.deepEqual(loaded.oatiCalls, [
      'datos_basicos_activos_cedula/1023968369',
      'consultar_estado_docente/1023968369',
    ]);
    assert.equal(log.warnings.length, 0);
  } finally {
    loaded.restore();
  }
});

test('checkServiceStatus still validates edX outside production', async () => {
  const loaded = loadServiceStatus({ edxHealthy: false });
  const log = createLog();

  try {
    const status = await loaded.checkServiceStatus(log, { checkEdx: true });

    assert.equal(status.servicesAreUp, false);
    assert.equal(loaded.edxCalls.length, 1);
    assert.ok(
      log.warnings[0].services.some(
        (service) => service.service.startsWith('edx_') && service.available === false
      )
    );
  } finally {
    loaded.restore();
  }
});

test('shouldCheckEdx is false for production and true for non-production environments', () => {
  const loaded = loadServiceStatus();

  try {
    assert.equal(loaded.shouldCheckEdx('production'), false);
    assert.equal(loaded.shouldCheckEdx('PRODUCTION'), false);
    assert.equal(loaded.shouldCheckEdx(''), false);
    for (const environmentName of ['dev', 'development', 'local', 'test', 'staging', 'preprod']) {
      assert.equal(loaded.shouldCheckEdx(environmentName), true);
    }
  } finally {
    loaded.restore();
  }
});

test('checkServiceStatus reports the service down when an academic service fails', async () => {
  const loaded = loadServiceStatus({
    oatiImpl: async (value) => {
      if (value.startsWith('consultar_estado_docente/')) {
        const error = new Error('Gateway timeout');
        error.response = { status: 504 };
        throw error;
      }
      return {};
    },
  });
  const log = createLog();

  try {
    const status = await loaded.checkServiceStatus(log);

    assert.equal(status.servicesAreUp, false);
    assert.equal(log.warnings.length, 1);
  } finally {
    loaded.restore();
  }
});

test('checkServiceStatus reports up without warnings when every service responds', async () => {
  const loaded = loadServiceStatus();
  const log = createLog();

  try {
    const status = await loaded.checkServiceStatus(log);

    assert.equal(status.servicesAreUp, true);
    assert.equal(log.warnings.length, 0);
    assert.ok(status.timestamp);
  } finally {
    loaded.restore();
  }
});
