const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../../src/routes/middlewares/microsoft.js');
const passportPath = require.resolve('passport');
const passportMicrosoftPath = require.resolve('passport-microsoft');
const dotenvPath = require.resolve('dotenv');

function loadMicrosoftMiddleware({ clientId, clientSecret, tenantId } = {}) {
  const originalEnv = {
    MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID,
    MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET,
    MICROSOFT_TENANT_ID: process.env.MICROSOFT_TENANT_ID,
    MICROSOFT_CALLBACK_BASE_URL: process.env.MICROSOFT_CALLBACK_BASE_URL,
    APP_URL: process.env.APP_URL,
  };

  process.env.MICROSOFT_CLIENT_ID = clientId;
  process.env.MICROSOFT_CLIENT_SECRET = clientSecret;
  process.env.MICROSOFT_TENANT_ID = tenantId;
  process.env.MICROSOFT_CALLBACK_BASE_URL = 'https://labs.test';
  process.env.APP_URL = 'https://app.test';

  const originalPassport = require.cache[passportPath];
  const originalPassportMicrosoft = require.cache[passportMicrosoftPath];
  const originalDotenv = require.cache[dotenvPath];

  const uses = [];
  class FakeStrategy {
    constructor(options, verify) {
      this.name = 'auth-microsoft';
      this.options = options;
      this.verify = verify;
    }
  }

  delete require.cache[modulePath];
  require.cache[passportPath] = {
    id: passportPath,
    filename: passportPath,
    loaded: true,
    exports: {
      use: (...args) => {
        uses.push(args);
      },
    },
  };
  require.cache[passportMicrosoftPath] = {
    id: passportMicrosoftPath,
    filename: passportMicrosoftPath,
    loaded: true,
    exports: {
      Strategy: FakeStrategy,
    },
  };
  require.cache[dotenvPath] = {
    id: dotenvPath,
    filename: dotenvPath,
    loaded: true,
    exports: {
      config: () => ({}),
    },
  };

  require(modulePath);

  return {
    uses,
    restore() {
      if (originalPassport) {
        require.cache[passportPath] = originalPassport;
      } else {
        delete require.cache[passportPath];
      }

      if (originalPassportMicrosoft) {
        require.cache[passportMicrosoftPath] = originalPassportMicrosoft;
      } else {
        delete require.cache[passportMicrosoftPath];
      }

      if (originalDotenv) {
        require.cache[dotenvPath] = originalDotenv;
      } else {
        delete require.cache[dotenvPath];
      }

      delete require.cache[modulePath];

      Object.assign(process.env, originalEnv);
    },
  };
}

test('microsoft middleware registers strategy when required env vars exist', () => {
  const loaded = loadMicrosoftMiddleware({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    tenantId: 'tenant-id',
  });

  try {
    assert.equal(loaded.uses.length, 1);
    const [name, strategy] = loaded.uses[0];
    assert.equal(name, 'auth-microsoft');
    assert.equal(strategy.options.clientID, 'client-id');
    assert.equal(strategy.options.clientSecret, 'client-secret');
    assert.equal(strategy.options.callbackURL, 'https://labs.test/auth/microsoft/callback');
  } finally {
    loaded.restore();
  }
});

test('microsoft middleware skips strategy registration when env vars are missing', () => {
  const loaded = loadMicrosoftMiddleware({
    clientId: '',
    clientSecret: '',
    tenantId: 'tenant-id',
  });

  try {
    assert.equal(loaded.uses.length, 0);
  } finally {
    loaded.restore();
  }
});
