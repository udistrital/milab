const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../../src/libs/db.js');
const pgPath = require.resolve('pg');
const configPath = path.resolve(__dirname, '../../../src/config/config.js');
const credentialsPath = path.resolve(__dirname, '../../../src/libs/db-credentials.js');

function loadDbModule({ resolvedCredentials } = {}) {
  const originalPg = require.cache[pgPath];
  const originalConfig = require.cache[configPath];
  const originalCredentials = require.cache[credentialsPath];

  const instances = [];
  class FakePool {
    constructor(options) {
      this.options = options;
      this.handlers = {};
      instances.push(this);
    }

    query() {
      return Promise.resolve({ rows: [] });
    }

    connect() {
      return Promise.resolve({ release() {} });
    }

    end() {
      return Promise.resolve();
    }

    on(eventName, callback) {
      this.handlers[eventName] = callback;
    }
  }

  delete require.cache[modulePath];
  require.cache[pgPath] = {
    id: pgPath,
    filename: pgPath,
    loaded: true,
    exports: {
      Pool: FakePool,
    },
  };
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: {
      config: {
        dbHost: 'db.test',
        dbPort: 5432,
        dbUser: 'usuario_test',
        dbPassword: 'secret_test',
        dbName: 'milab_test',
        options: '-c search_path=milab',
      },
    },
  };
  require.cache[credentialsPath] = {
    id: credentialsPath,
    filename: credentialsPath,
    loaded: true,
    exports: {
      resolveDatabaseCredentials: () =>
        Promise.resolve(
          resolvedCredentials || {
            user: 'usuario_test',
            password: 'secret_test',
          }
        ),
    },
  };

  return {
    db: require(modulePath),
    instances,
    restore() {
      if (originalPg) {
        require.cache[pgPath] = originalPg;
      } else {
        delete require.cache[pgPath];
      }

      if (originalConfig) {
        require.cache[configPath] = originalConfig;
      } else {
        delete require.cache[configPath];
      }

      if (originalCredentials) {
        require.cache[credentialsPath] = originalCredentials;
      } else {
        delete require.cache[credentialsPath];
      }

      delete require.cache[modulePath];
    },
  };
}

test('db creates Pool lazily with config values', async () => {
  const loaded = loadDbModule();

  try {
    assert.equal(loaded.instances.length, 0);

    await loaded.db.query('SELECT 1');
    assert.equal(loaded.instances.length, 1);

    const createdPool = loaded.instances[0];
    assert.deepEqual(createdPool.options, {
      host: 'db.test',
      port: 5432,
      user: 'usuario_test',
      password: 'secret_test',
      database: 'milab_test',
      options: '-c search_path=milab',
    });
  } finally {
    loaded.restore();
  }
});

test('db registers pool error handler that logs unexpected errors', async () => {
  const loaded = loadDbModule();
  const originalConsoleError = console.error;
  const calls = [];
  console.error = (...args) => {
    calls.push(args);
  };

  try {
    await loaded.db.query('SELECT 1');

    const createdPool = loaded.instances[0];
    assert.equal(typeof createdPool.handlers.error, 'function');

    const boom = new Error('pool offline');
    createdPool.handlers.error(boom);

    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'Error inesperado en el pool de PostgreSQL:');
    assert.equal(calls[0][1], boom);
  } finally {
    console.error = originalConsoleError;
    loaded.restore();
  }
});

test('db uses resolved credentials from secret provider', async () => {
  const loaded = loadDbModule({
    resolvedCredentials: {
      user: 'secret_user',
      password: 'secret_password',
    },
  });

  try {
    await loaded.db.query('SELECT 1');

    const createdPool = loaded.instances[0];
    assert.equal(createdPool.options.user, 'secret_user');
    assert.equal(createdPool.options.password, 'secret_password');
  } finally {
    loaded.restore();
  }
});
