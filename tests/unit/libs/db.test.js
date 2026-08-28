const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../../src/libs/db.js');
const pgPath = require.resolve('pg');
const configPath = path.resolve(__dirname, '../../../src/config/config.js');

function loadDbModule() {
  const originalPg = require.cache[pgPath];
  const originalConfig = require.cache[configPath];

  const instances = [];
  class FakePool {
    constructor(options) {
      this.options = options;
      this.handlers = {};
      instances.push(this);
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

  return {
    pool: require(modulePath),
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

      delete require.cache[modulePath];
    },
  };
}

test('db creates Pool with config values', () => {
  const loaded = loadDbModule();

  try {
    assert.equal(loaded.instances.length, 1);

    const createdPool = loaded.instances[0];
    assert.equal(loaded.pool, createdPool);
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

test('db registers pool error handler that logs unexpected errors', () => {
  const loaded = loadDbModule();
  const originalConsoleError = console.error;
  const calls = [];
  console.error = (...args) => {
    calls.push(args);
  };

  try {
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
