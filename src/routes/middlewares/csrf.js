const crypto = require('crypto');

const CSRF_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getCsrfToken(req) {
  if (!req.session) return '';
  if (!req.session.csrfToken) {
    req.session.csrfToken = generateCsrfToken();
  }
  return req.session.csrfToken;
}

/**
 * Inyecta el token CSRF en res.locals para que esté disponible
 * en todas las vistas EJS como `csrfToken`.
 */
function csrfTokenMiddleware(req, res, next) {
  res.locals.csrfToken = getCsrfToken(req);
  next();
}

/**
 * Verifica el token CSRF en cada petición POST.
 * El token se lee de req.body._csrf o del header X-CSRF-Token.
 * Usa comparación en tiempo constante para evitar timing attacks.
 */
function shouldSkipCsrfValidation(req, skipPaths = []) {
  if (!Array.isArray(skipPaths) || skipPaths.length === 0) return false;
  const requestPath = req.path || req.originalUrl || '';
  return skipPaths.some((pathPrefix) => requestPath.startsWith(pathPrefix));
}

function shouldReturnJson(req) {
  if (typeof req.xhr === 'boolean' && req.xhr) return true;
  if (typeof req.path === 'string' && req.path.startsWith('/api/')) return true;
  if (typeof req.originalUrl === 'string' && req.originalUrl.startsWith('/api/')) return true;
  if (typeof req.get === 'function') {
    const accept = req.get('accept') || '';
    if (accept.includes('application/json')) return true;
  }
  return false;
}

function createCsrfVerifier(options = {}) {
  const { skipPaths = [] } = options;

  return function verifyCsrfToken(req, res, next) {
    if (!CSRF_METHODS.has(req.method)) return next();
    if (shouldSkipCsrfValidation(req, skipPaths)) return next();

    const sessionToken = req.session?.csrfToken;
    const submittedToken = req.body?._csrf || req.headers?.['x-csrf-token'];

    const valid =
      sessionToken &&
      submittedToken &&
      sessionToken.length === submittedToken.length &&
      crypto.timingSafeEqual(Buffer.from(sessionToken), Buffer.from(submittedToken));

    if (!valid) {
      if (shouldReturnJson(req)) {
        return res.status(403).json({
          message: 'Solicitud no válida',
          message2:
            'El token de seguridad expiró o es inválido. Recarga la página e inténtalo de nuevo.',
        });
      }

      return res.status(403).render('home/message_error', {
        message: 'Solicitud no válida',
        message2:
          'El token de seguridad expiró o es inválido. Recarga la página e inténtalo de nuevo.',
        limit: null,
      });
    }

    next();
  };
}

const verifyCsrfToken = createCsrfVerifier();

module.exports = { csrfTokenMiddleware, verifyCsrfToken, createCsrfVerifier };
