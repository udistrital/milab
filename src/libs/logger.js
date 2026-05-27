const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pino = require('pino');

const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'correo',
  'documento',
  'password',
  'newpassword',
  'token',
  'access_token',
  'refresh_token',
  'secret',
  'client_secret',
  'smtp_pass',
]);

function parseBoolean(value, defaultValue) {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

function parseNumber(value, defaultValue) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

const DEV_ENVS = new Set(['dev', 'development', 'local']);
const isDevEnvironment = DEV_ENVS.has((process.env.NODE_ENV || '').toLowerCase());

const loggerConfig = {
  level: process.env.LOG_LEVEL || (isDevEnvironment ? 'silent' : 'info'),
  destination: process.env.LOG_DESTINATION || 'stdout',
  filePath: process.env.LOG_FILE_PATH || path.join(process.cwd(), 'logs', 'app.log'),
  requestLoggingEnabled: parseBoolean(process.env.LOG_REQUESTS, !isDevEnvironment),
  slowRequestMs: parseNumber(process.env.LOG_SLOW_REQUEST_MS, 1000),
  requestSampleRate: Math.max(
    0,
    Math.min(1, parseNumber(process.env.LOG_REQUEST_SAMPLE_RATE, 0.2))
  ),
  bridgeConsole: parseBoolean(process.env.LOG_BRIDGE_CONSOLE, true),
};

function buildDestination() {
  if (loggerConfig.destination === 'file') {
    fs.mkdirSync(path.dirname(loggerConfig.filePath), { recursive: true });
    return pino.destination({ dest: loggerConfig.filePath, sync: false });
  }

  return pino.destination(1);
}

function serializeError(error) {
  if (!(error instanceof Error)) {
    return error;
  }

  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
}

function sanitizeValue(value, seen = new WeakSet()) {
  if (value === null || value === undefined) {
    return value;
  }

  if (value instanceof Error) {
    return serializeError(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen));
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return '[Circular]';
  }

  seen.add(value);

  const sanitized = {};
  Object.entries(value).forEach(([key, nestedValue]) => {
    if (SENSITIVE_KEYS.has(String(key).toLowerCase())) {
      sanitized[key] = '[REDACTED]';
      return;
    }

    sanitized[key] = sanitizeValue(nestedValue, seen);
  });

  seen.delete(value);
  return sanitized;
}

function summarizeArgs(args) {
  const stringParts = [];
  const structuredParts = [];

  args.forEach((arg) => {
    const sanitized = sanitizeValue(arg);

    if (typeof sanitized === 'string') {
      stringParts.push(sanitized);
      return;
    }

    structuredParts.push(sanitized);
  });

  return {
    message: stringParts.join(' ').trim() || 'Legacy console log',
    payload: structuredParts.length > 0 ? structuredParts : undefined,
  };
}

function maskIdentifier(value) {
  if (value === null || value === undefined) {
    return undefined;
  }

  const normalized = String(value);
  if (normalized.length <= 4) {
    return normalized;
  }

  return `${'*'.repeat(normalized.length - 4)}${normalized.slice(-4)}`;
}

const logger = pino(
  {
    level: loggerConfig.level,
    timestamp: pino.stdTimeFunctions.isoTime,
    base: {
      service: 'milabud',
      env: process.env.NODE_ENV || 'development',
      pid: process.pid,
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        'req.body.newPassword',
        'req.body.correo',
        'req.body.documento',
        'body.password',
        'body.newPassword',
        'body.correo',
        'body.documento',
        'headers.authorization',
        'headers.cookie',
      ],
      censor: '[REDACTED]',
    },
  },
  buildDestination()
);

let consoleBridgeInstalled = false;
function installConsoleBridge() {
  if (consoleBridgeInstalled || !loggerConfig.bridgeConsole) {
    return;
  }

  const bridge =
    (level) =>
    (...args) => {
      const { message, payload } = summarizeArgs(args);

      if (payload) {
        logger[level]({ source: 'console', payload }, message);
        return;
      }

      logger[level]({ source: 'console' }, message);
    };

  console.log = bridge('debug');
  console.info = bridge('info');
  console.warn = bridge('warn');
  console.error = bridge('error');

  consoleBridgeInstalled = true;
}

let processHandlersInstalled = false;
function installProcessHandlers() {
  if (processHandlersInstalled) {
    return;
  }

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: sanitizeValue(reason) }, 'Unhandled promise rejection');
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: sanitizeValue(error) }, 'Uncaught exception');
  });

  processHandlersInstalled = true;
}

function createRequestId() {
  return crypto.randomUUID();
}

module.exports = {
  createRequestId,
  installConsoleBridge,
  installProcessHandlers,
  logger,
  loggerConfig,
  maskIdentifier,
  parseBoolean,
  sanitizeValue,
};
