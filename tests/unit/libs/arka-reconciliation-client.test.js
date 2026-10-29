const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ArkaIntegrationError,
  DEFAULT_TEST_ARKA_API_BASE_URL,
  DEFAULT_TEST_TERCEROS_API_BASE_URL,
  createArkaClient,
  getArkaConfiguration,
  isArkaConfigured,
} = require('../../../src/libs/arka-reconciliation-client');

function createConfiguration(overrides = {}) {
  return {
    arkaBaseUrl: DEFAULT_TEST_ARKA_API_BASE_URL,
    tercerosBaseUrl: DEFAULT_TEST_TERCEROS_API_BASE_URL,
    hasOatiCredentials: true,
    requestTimeoutMs: 20000,
    maxResponseBytes: 52428800,
    ...overrides,
  };
}

function createTestClient(options = {}) {
  return createArkaClient({
    accessTokenProvider: async () => 'test-token-value',
    ...options,
  });
}

test('client resolves the third party with document-only query and maps ArkaMid items', async () => {
  const calls = [];
  const httpClient = {
    async get(url, options) {
      calls.push({ url, options });
      if (url.endsWith('/tercero/identificacion')) {
        return { data: [{ compuesto: 'CC 1030672', tercero_id: 1165 }] };
      }
      return {
        data: {
          Elementos: [
            {
              Id: 41,
              ElementoActaId: 7,
              Placa: 'ARKA-001',
              Serie: 'SER-001',
              Nombre: 'Microscopio',
              Marca: 'Acme',
              Valor: 1234,
            },
          ],
          Tercero: [{ Identificacion: { Numero: '1030672' } }],
        },
      };
    },
  };
  const client = createTestClient({
    configuration: createConfiguration(),
    httpClient,
  });

  const result = await client.getCoordinatorInventory('1030672');

  assert.equal(result.terceroId, 1165);
  assert.deepEqual(result.items, [
    {
      sourceIndex: 0,
      arkaId: 41,
      elementoActaId: 7,
      placa: 'ARKA-001',
      serie: 'SER-001',
      nombre: 'Microscopio',
      marca: 'Acme',
      valor: 1234,
    },
  ]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.params.query, '1030672');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token-value');
  assert.match(calls[1].url, /\/traslados\/funcionario\/1165$/);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer test-token-value');
});

test('client rejects missing or ambiguous third-party identifiers', async (t) => {
  for (const [data, expectedCode] of [
    [[], 'ARKA_THIRD_PARTY_NOT_FOUND'],
    [[{ tercero_id: 1 }, { tercero_id: 2 }], 'ARKA_AMBIGUOUS_THIRD_PARTY'],
  ]) {
    await t.test(expectedCode, async () => {
      const client = createTestClient({
        configuration: createConfiguration(),
        httpClient: { get: async () => ({ data }) },
      });

      await assert.rejects(client.resolveThirdPartyId('1030672'), (error) => {
        assert.equal(error.code, expectedCode);
        return true;
      });
    });
  }
});

test('client rejects invalid API response shapes without exposing request credentials', async () => {
  const client = createTestClient({
    configuration: createConfiguration(),
    httpClient: {
      async get(url) {
        if (url.endsWith('/tercero/identificacion')) {
          return { data: [{ tercero_id: 1165 }] };
        }
        return { data: { Elementos: [null] } };
      },
    },
  });

  await assert.rejects(client.getCoordinatorInventory('1030672'), (error) => {
    assert.equal(error.code, 'ARKA_INVALID_INVENTORY_ITEM');
    assert.doesNotMatch(error.message, /test-token-value|1030672/);
    return true;
  });
});

test('client converts HTTP failures into safe integration errors', async () => {
  const client = createTestClient({
    configuration: createConfiguration(),
    httpClient: {
      async get() {
        const error = new Error('request failed with Bearer test-token-value');
        error.response = { status: 401 };
        throw error;
      },
    },
  });

  await assert.rejects(client.resolveThirdPartyId('1030672'), (error) => {
    assert.ok(error instanceof ArkaIntegrationError);
    assert.equal(error.code, 'ARKA_AUTHENTICATION_ERROR');
    assert.doesNotMatch(error.message, /test-token-value|1030672/);
    return true;
  });
});

test('production does not silently fall back to the test API URLs', () => {
  const configuration = getArkaConfiguration({
    NODE_ENV: 'production',
    OATI_CLIENT_ID: 'test-client-id',
    OATI_SECRET: 'test-client-secret',
  });

  assert.equal(configuration.arkaBaseUrl, '');
  assert.equal(configuration.tercerosBaseUrl, '');
  assert.equal(
    isArkaConfigured({
      NODE_ENV: 'production',
      OATI_CLIENT_ID: 'test-client-id',
      OATI_SECRET: 'test-client-secret',
    }),
    false
  );
});

test('test environments use the configured OATI credentials and test API bases', () => {
  const environment = {
    NODE_ENV: 'test',
    OATI_CLIENT_ID: 'test-client-id',
    OATI_SECRET: 'test-client-secret',
  };
  const configuration = getArkaConfiguration(environment);

  assert.equal(configuration.arkaBaseUrl, DEFAULT_TEST_ARKA_API_BASE_URL);
  assert.equal(configuration.tercerosBaseUrl, DEFAULT_TEST_TERCEROS_API_BASE_URL);
  assert.equal(configuration.hasOatiCredentials, true);
  assert.equal(isArkaConfigured(environment), true);
});

test('client refuses non-HTTPS API bases', () => {
  assert.throws(
    () =>
      createTestClient({
        configuration: createConfiguration({ arkaBaseUrl: 'http://example.test/arka_mid/v1' }),
      }),
    (error) => error.code === 'ARKA_CONFIGURATION_ERROR'
  );
});

test('client turns OAuth failures into safe integration errors', async () => {
  const client = createArkaClient({
    configuration: createConfiguration(),
    accessTokenProvider: async () => {
      throw new Error('test-client-secret');
    },
    httpClient: {
      get() {
        assert.fail('No debe consultarse ARKA si la obtención del token falla.');
      },
    },
  });

  await assert.rejects(client.resolveThirdPartyId('1030672'), (error) => {
    assert.equal(error.code, 'ARKA_TOKEN_ERROR');
    assert.doesNotMatch(error.message, /test-client-secret|1030672/);
    return true;
  });
});
