const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../../src/routes/middlewares/security-logger.js');
const fsPath = require.resolve('fs');
const loggerPath = path.resolve(__dirname, '../../../src/libs/logger.js');

function loadModule({ readContent = '' } = {}) {
  const originalFs = require.cache[fsPath];
  const originalLogger = require.cache[loggerPath];

  const warned = [];
  const errored = [];
  const appended = [];

  delete require.cache[modulePath];
  require.cache[fsPath] = {
    id: fsPath,
    filename: fsPath,
    loaded: true,
    exports: {
      existsSync: () => true,
      mkdirSync: () => {},
      appendFile: (file, line, cb) => {
        appended.push({ file, line });
        cb(null);
      },
      readFileSync: () => readContent,
    },
  };
  require.cache[loggerPath] = {
    id: loggerPath,
    filename: loggerPath,
    loaded: true,
    exports: {
      parseBoolean: (value, defaultValue) => {
        if (value === undefined) return defaultValue;
        return String(value).toLowerCase() === 'true';
      },
      sanitizeValue: (v) => v,
      maskIdentifier: (v) => `masked:${v}`,
      logger: {
        child: () => ({
          warn: (...args) => warned.push(args),
          error: (...args) => errored.push(args),
        }),
      },
    },
  };

  const exported = require(modulePath);
  return {
    exported,
    warned,
    errored,
    appended,
    restore() {
      if (originalFs) {
        require.cache[fsPath] = originalFs;
      } else {
        delete require.cache[fsPath];
      }

      if (originalLogger) {
        require.cache[loggerPath] = originalLogger;
      } else {
        delete require.cache[loggerPath];
      }

      delete require.cache[modulePath];
    },
  };
}

test('securityLogger logs non institutional email and weak password attempts', () => {
  const loaded = loadModule();

  try {
    const req = {
      ip: '127.0.0.1',
      method: 'POST',
      originalUrl: '/milab/api/register',
      url: '/milab/api/register',
      body: {
        correo: 'usuario@gmail.com',
        password: 'weak',
      },
      rateLimit: { remaining: 1 },
      sessionID: 'session-1',
      requestId: 'req-1',
      connection: { remoteAddress: '127.0.0.1' },
      get: () => 'UA',
    };
    const res = {
      render(view, payload) {
        return { view, payload };
      },
    };
    let nextCalled = false;

    loaded.exported.securityLogger(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(loaded.warned.length >= 3, true);
    assert.equal(loaded.appended.length >= 3, true);
  } finally {
    loaded.restore();
  }
});

test('securityLogger wraps render and logs validation and unauthorized messages', () => {
  const loaded = loadModule();

  try {
    const req = {
      ip: '127.0.0.1',
      method: 'GET',
      originalUrl: '/milab/api/test',
      url: '/milab/api/test',
      body: {},
      sessionID: 'session-2',
      requestId: 'req-2',
      connection: { remoteAddress: '127.0.0.1' },
      get: () => 'UA',
    };
    let renderedPayload;
    const res = {
      render(view, payload) {
        renderedPayload = { view, payload };
        return renderedPayload;
      },
    };

    loaded.exported.securityLogger(req, res, () => {});
    res.render('home/message_error', { message: 'Algo ha salido mal' });

    assert.equal(renderedPayload.view, 'home/message_error');
    assert.equal(loaded.warned.length >= 1, true);
  } finally {
    loaded.restore();
  }
});

test('getSecurityLogs parses valid lines and flags invalid entries', () => {
  const loaded = loadModule({
    readContent:
      '{"eventType":"VALIDATION_BYPASS_ATTEMPT"}\n{"eventType":"WEAK_PASSWORD_ATTEMPT"}\ninvalid-json',
  });

  try {
    const logs = loaded.exported.getSecurityLogs(10);

    assert.equal(logs.length, 3);
    assert.equal(logs[0].eventType, 'VALIDATION_BYPASS_ATTEMPT');
    assert.equal(logs[1].eventType, 'WEAK_PASSWORD_ATTEMPT');
    assert.equal(logs[2].error, 'Invalid log entry');
  } finally {
    loaded.restore();
  }
});
