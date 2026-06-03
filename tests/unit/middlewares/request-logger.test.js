const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const modulePath = path.resolve(__dirname, '../../../src/routes/middlewares/request-logger.js');
const loggerPath = path.resolve(__dirname, '../../../src/libs/logger.js');

function loadModule({ loggerConfigOverrides = {} } = {}) {
  const originalLogger = require.cache[loggerPath];
  const calls = [];

  const childLogger = {
    info: (payload, msg) => calls.push({ level: 'info', payload, msg }),
    warn: (payload, msg) => calls.push({ level: 'warn', payload, msg }),
    error: (payload, msg) => calls.push({ level: 'error', payload, msg }),
  };

  delete require.cache[modulePath];
  require.cache[loggerPath] = {
    id: loggerPath,
    filename: loggerPath,
    loaded: true,
    exports: {
      createRequestId: () => 'req-123',
      maskIdentifier: (v) => `masked:${v}`,
      loggerConfig: {
        requestLoggingEnabled: true,
        requestSampleRate: 1,
        slowRequestMs: 1000,
        ...loggerConfigOverrides,
      },
      logger: {
        child: () => childLogger,
      },
    },
  };

  return {
    requestLogger: require(modulePath).requestLogger,
    calls,
    restore() {
      if (originalLogger) {
        require.cache[loggerPath] = originalLogger;
      } else {
        delete require.cache[loggerPath];
      }

      delete require.cache[modulePath];
    },
  };
}

class FakeResponse extends EventEmitter {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = {};
    this.writableEnded = false;
  }

  setHeader(name, value) {
    this.headers[name.toLowerCase()] = value;
  }
}

test('requestLogger sets request id and logs completed request on finish', () => {
  const loaded = loadModule();

  try {
    const req = {
      method: 'GET',
      originalUrl: '/milab/api/dashboard',
      url: '/milab/api/dashboard',
      ip: '127.0.0.1',
      get: () => '',
      session: { user: { documento: '1024467835' } },
      sessionID: 'session-1',
    };
    const res = new FakeResponse();
    let nextCalled = false;

    loaded.requestLogger(req, res, () => {
      nextCalled = true;
    });

    res.emit('finish');

    assert.equal(nextCalled, true);
    assert.equal(req.requestId, 'req-123');
    assert.equal(res.headers['x-request-id'], 'req-123');
    assert.equal(loaded.calls.length, 1);
    assert.equal(loaded.calls[0].level, 'info');
    assert.equal(loaded.calls[0].payload.event, 'request_completed');
  } finally {
    loaded.restore();
  }
});

test('requestLogger skips static assets and does not log on finish', () => {
  const loaded = loadModule();

  try {
    const req = {
      method: 'GET',
      originalUrl: '/public/js/scripts.js',
      url: '/public/js/scripts.js',
      ip: '127.0.0.1',
      get: () => '',
      session: {},
      sessionID: 'session-1',
    };
    const res = new FakeResponse();

    loaded.requestLogger(req, res, () => {});
    res.emit('finish');

    assert.equal(loaded.calls.length, 0);
  } finally {
    loaded.restore();
  }
});

test('requestLogger logs request_aborted on close when response not ended', () => {
  const loaded = loadModule();

  try {
    const req = {
      method: 'POST',
      originalUrl: '/milab/api/register',
      url: '/milab/api/register',
      ip: '127.0.0.1',
      get: () => '',
      session: {},
      sessionID: 'session-2',
    };
    const res = new FakeResponse();

    loaded.requestLogger(req, res, () => {});
    res.emit('close');

    assert.equal(loaded.calls.length, 1);
    assert.equal(loaded.calls[0].level, 'warn');
    assert.equal(loaded.calls[0].payload.event, 'request_aborted');
  } finally {
    loaded.restore();
  }
});
