const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../../src/libs/oati-client.js');
const axiosPath = require.resolve('axios');
const configPath = path.resolve(__dirname, '../../../src/config/config.js');

function loadOatiClient({ postImpl, getImpl }) {
  const originalAxios = require.cache[axiosPath];
  const originalConfig = require.cache[configPath];

  delete require.cache[modulePath];
  require.cache[axiosPath] = {
    id: axiosPath,
    filename: axiosPath,
    loaded: true,
    exports: {
      post: postImpl,
      get: getImpl,
    },
  };
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: {
      config: {
        oatiClientId: 'client-id',
        oatiSecret: 'secret',
        oatiBaseUrl: 'https://oati.test',
        oatiTokenUrl: 'https://oati.test/oauth2/token',
        oatiRejectUnauthorized: false,
      },
    },
  };

  return {
    oatiClient: require(modulePath),
    restore() {
      if (originalAxios) {
        require.cache[axiosPath] = originalAxios;
      } else {
        delete require.cache[axiosPath];
      }

      if (originalConfig) {
        require.cache[configPath] = originalConfig;
      } else {
        delete require.cache[configPath];
      }

      delete require.cache[modulePath];
    },
  };
}

test('requestOati retries transient ECONNREFUSED errors and returns the next successful response', async () => {
  let postCalls = 0;
  let getCalls = 0;
  const loaded = loadOatiClient({
    postImpl: async () => {
      postCalls += 1;
      return {
        data: {
          access_token: 'token-123',
          expires_in: 300,
        },
      };
    },
    getImpl: async () => {
      getCalls += 1;

      if (getCalls < 4) {
        const error = new Error('connect ECONNREFUSED 172.30.5.103:443');
        error.code = 'ECONNREFUSED';
        throw error;
      }

      return {
        data: {
          ok: true,
        },
      };
    },
  });

  try {
    const response = await loaded.oatiClient.requestOati('wso2eiserver/services/test');

    assert.deepEqual(response, { ok: true });
    assert.equal(postCalls, 1);
    assert.equal(getCalls, 4);
  } finally {
    loaded.restore();
  }
});

test('requestOati does not retry non-retryable 404 responses', async () => {
  let getCalls = 0;
  const loaded = loadOatiClient({
    postImpl: async () => ({
      data: {
        access_token: 'token-123',
        expires_in: 300,
      },
    }),
    getImpl: async () => {
      getCalls += 1;
      const error = new Error('not found');
      error.response = { status: 404 };
      throw error;
    },
  });

  try {
    await assert.rejects(loaded.oatiClient.requestOati('wso2eiserver/services/test'), /not found/);
    assert.equal(getCalls, 1);
  } finally {
    loaded.restore();
  }
});
