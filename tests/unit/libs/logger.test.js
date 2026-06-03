const test = require('node:test');
const assert = require('node:assert/strict');

const {
  installConsoleBridge,
  installProcessHandlers,
  logger,
  maskIdentifier,
  parseBoolean,
  sanitizeValue,
} = require('../../../src/libs/logger');

test('parseBoolean handles truthy/falsy values and fallback default', () => {
  assert.equal(parseBoolean('true', false), true);
  assert.equal(parseBoolean('0', true), false);
  assert.equal(parseBoolean(undefined, true), true);
  assert.equal(parseBoolean('invalid-value', false), false);
});

test('sanitizeValue redacts sensitive keys recursively and handles circular refs', () => {
  const payload = {
    correo: 'persona@udistrital.edu.co',
    nested: {
      password: 'Secret123!',
      token: 'abc123',
      keep: 'ok',
    },
    list: [{ authorization: 'Bearer token' }, { keep: 'value' }],
  };
  payload.self = payload;

  const sanitized = sanitizeValue(payload);

  assert.equal(sanitized.correo, '[REDACTED]');
  assert.equal(sanitized.nested.password, '[REDACTED]');
  assert.equal(sanitized.nested.token, '[REDACTED]');
  assert.equal(sanitized.nested.keep, 'ok');
  assert.equal(sanitized.list[0].authorization, '[REDACTED]');
  assert.equal(sanitized.list[1].keep, 'value');
  assert.equal(sanitized.self, '[Circular]');
});

test('maskIdentifier preserves last 4 chars and masks prefix', () => {
  assert.equal(maskIdentifier('1234567890'), '******7890');
  assert.equal(maskIdentifier('1234'), '1234');
  assert.equal(maskIdentifier(undefined), undefined);
});

test('installConsoleBridge redirects console output to logger methods', () => {
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  const originalLogger = {
    debug: logger.debug,
    info: logger.info,
    warn: logger.warn,
    error: logger.error,
  };

  const calls = [];
  logger.debug = (payload, message) => calls.push({ level: 'debug', payload, message });
  logger.info = (payload, message) => calls.push({ level: 'info', payload, message });
  logger.warn = (payload, message) => calls.push({ level: 'warn', payload, message });
  logger.error = (payload, message) => calls.push({ level: 'error', payload, message });

  try {
    installConsoleBridge();

    console.log('hola', { password: 'x' });
    console.info('info-msg');
    console.warn('warn-msg');
    console.error('error-msg', { token: 'abc' });

    assert.equal(calls.length, 4);
    assert.equal(calls[0].level, 'debug');
    assert.equal(calls[0].message, 'hola');
    assert.equal(calls[0].payload.source, 'console');
    assert.equal(calls[0].payload.payload[0].password, '[REDACTED]');
    assert.equal(calls[3].payload.payload[0].token, '[REDACTED]');
  } finally {
    logger.debug = originalLogger.debug;
    logger.info = originalLogger.info;
    logger.warn = originalLogger.warn;
    logger.error = originalLogger.error;

    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  }
});

test('installProcessHandlers registers listeners only once', () => {
  const beforeUnhandled = process.listeners('unhandledRejection').length;
  const beforeUncaught = process.listeners('uncaughtException').length;

  installProcessHandlers();
  installProcessHandlers();

  const afterUnhandled = process.listeners('unhandledRejection').length;
  const afterUncaught = process.listeners('uncaughtException').length;

  assert.equal(afterUnhandled, beforeUnhandled + 1);
  assert.equal(afterUncaught, beforeUncaught + 1);

  const unhandledListeners = process.listeners('unhandledRejection');
  const uncaughtListeners = process.listeners('uncaughtException');

  process.removeListener('unhandledRejection', unhandledListeners[unhandledListeners.length - 1]);
  process.removeListener('uncaughtException', uncaughtListeners[uncaughtListeners.length - 1]);
});
