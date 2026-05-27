const fs = require('fs');
const path = require('path');
const { logger, maskIdentifier, parseBoolean, sanitizeValue } = require('../../libs/logger');

const securityLogToFile = parseBoolean(process.env.SECURITY_LOG_TO_FILE, true);
const securityLogFile =
  process.env.SECURITY_LOG_FILE || path.join(__dirname, '../../logs/security.log');

if (securityLogToFile) {
  const logsDir = path.dirname(securityLogFile);
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
}

const securityAppLogger = logger.child({ component: 'security' });

function logSecurityEvent(eventType, details, req) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    eventType,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent') || 'Unknown',
    method: req.method,
    url: req.originalUrl || req.url,
    details: sanitizeValue(details),
    sessionId: req.sessionID ? maskIdentifier(req.sessionID) : 'No session',
    requestId: req.requestId,
  };

  securityAppLogger.warn({ event: 'security_event', ...logEntry }, 'Security event detected');

  if (!securityLogToFile) {
    return;
  }

  const logLine = JSON.stringify(logEntry) + '\n';
  fs.appendFile(securityLogFile, logLine, (err) => {
    if (err) {
      securityAppLogger.error({ err: sanitizeValue(err) }, 'Error writing security log file');
    }
  });
}

// Middleware para detectar intentos de bypass de validaciones
function securityLogger(req, res, next) {
  const originalRender = res.render;
  res.render = function (view, options, callback) {
    if (
      options &&
      options.message &&
      (options.message.includes('Error de validación') ||
        options.message.includes('correo') ||
        options.message.includes('contraseña'))
    ) {
      logSecurityEvent('VALIDATION_BYPASS_ATTEMPT', `Validation error: ${options.message}`, req);
    }

    // Detectar intentos de acceso no autorizado
    if (
      options &&
      options.message &&
      (options.message.includes('Ha ocurrido un error') ||
        options.message.includes('Algo ha salido mal'))
    ) {
      logSecurityEvent(
        'UNAUTHORIZED_ACCESS_ATTEMPT',
        `Unauthorized access attempt: ${options.message}`,
        req
      );
    }

    return originalRender.call(this, view, options, callback);
  };

  // Detectar intentos de envío de datos no institucionales
  if (req.body && req.body.correo && !req.body.correo.endsWith('@udistrital.edu.co')) {
    logSecurityEvent(
      'NON_INSTITUTIONAL_EMAIL_ATTEMPT',
      `Attempt to use non-institutional email: ${maskIdentifier(req.body.correo)}`,
      req
    );
  }

  // Detectar contraseñas débiles
  if (req.body && req.body.password) {
    const password = req.body.password;
    if (
      password.length < 8 ||
      !/[A-Z]/.test(password) ||
      !/[a-z]/.test(password) ||
      !/\d/.test(password) ||
      !/[!@#$%^&*(),.?":{}|<>]/.test(password)
    ) {
      logSecurityEvent(
        'WEAK_PASSWORD_ATTEMPT',
        'Attempt to use weak password that does not meet security criteria',
        req
      );
    }
  }

  // Detectar múltiples intentos fallidos desde la misma IP
  if (req.rateLimit && req.rateLimit.remaining <= 1) {
    logSecurityEvent(
      'RATE_LIMIT_APPROACHING',
      `IP approaching rate limit. Remaining requests: ${req.rateLimit.remaining}`,
      req
    );
  }

  next();
}

// Función para leer logs de seguridad
function getSecurityLogs(lines = 100) {
  if (!securityLogToFile || !fs.existsSync(securityLogFile)) {
    return [];
  }

  try {
    const data = fs.readFileSync(securityLogFile, 'utf8');
    const logLines = data.trim().split('\n');
    return logLines.slice(-lines).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { error: 'Invalid log entry', raw: line };
      }
    });
  } catch (err) {
    securityAppLogger.error({ err: sanitizeValue(err) }, 'Error reading security logs');
    return [];
  }
}

module.exports = {
  securityLogger,
  logSecurityEvent,
  getSecurityLogs,
};
