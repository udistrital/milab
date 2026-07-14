const { randomInt } = require('node:crypto');
const { createRequestId, logger, loggerConfig, maskIdentifier } = require('../../libs/logger');

const STATIC_ASSET_PATTERN = /\.(?:css|js|mjs|png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|map)$/i;

function shouldSkipRequestLog(req) {
  const requestPath = req.originalUrl || req.url || '';

  return (
    req.method === 'OPTIONS' ||
    requestPath.startsWith('/public/') ||
    STATIC_ASSET_PATTERN.test(requestPath)
  );
}

function shouldSample(statusCode) {
  if (statusCode >= 400) {
    return true;
  }

  if (loggerConfig.requestSampleRate >= 1) {
    return true;
  }

  return randomInt(0, 10000) / 10000 <= loggerConfig.requestSampleRate;
}

function resolveRequestLevel(statusCode, durationMs) {
  if (statusCode >= 500) {
    return 'error';
  }

  if (statusCode >= 400 || durationMs >= loggerConfig.slowRequestMs) {
    return 'warn';
  }

  return 'info';
}

function getRequestPrincipal(req) {
  return (
    req.session?.user?.documento ||
    req.session?.documento ||
    req.session?.usuario_no_verificado?.documento ||
    req.user?.documento ||
    undefined
  );
}

function requestLogger(req, res, next) {
  const requestId = req.get('x-request-id') || createRequestId();
  const start = process.hrtime.bigint();

  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  req.log = logger.child({ requestId, component: 'http' });

  res.on('finish', () => {
    if (
      !loggerConfig.requestLoggingEnabled ||
      shouldSkipRequestLog(req) ||
      !shouldSample(res.statusCode)
    ) {
      return;
    }

    const durationMs = Number(process.hrtime.bigint() - start) / 1000000;
    const principal = getRequestPrincipal(req);
    const level = resolveRequestLevel(res.statusCode, durationMs);

    req.log[level](
      {
        event: 'request_completed',
        method: req.method,
        path: req.originalUrl || req.url,
        statusCode: res.statusCode,
        durationMs: Number(durationMs.toFixed(1)),
        ip: req.ip,
        user: principal ? maskIdentifier(principal) : undefined,
        sessionId: req.sessionID ? maskIdentifier(req.sessionID) : undefined,
      },
      'HTTP request completed'
    );
  });

  res.on('close', () => {
    if (res.writableEnded || !loggerConfig.requestLoggingEnabled || shouldSkipRequestLog(req)) {
      return;
    }

    const durationMs = Number(process.hrtime.bigint() - start) / 1000000;

    req.log.warn(
      {
        event: 'request_aborted',
        method: req.method,
        path: req.originalUrl || req.url,
        durationMs: Number(durationMs.toFixed(1)),
        ip: req.ip,
      },
      'HTTP request aborted before completion'
    );
  });

  next();
}

module.exports = {
  requestLogger,
};
