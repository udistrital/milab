const crypto = require('crypto');

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
function verifyCsrfToken(req, res, next) {
  if (req.method !== 'POST') return next();

  const sessionToken = req.session?.csrfToken;
  const submittedToken = req.body?._csrf || req.headers?.['x-csrf-token'];

  const valid =
    sessionToken &&
    submittedToken &&
    sessionToken.length === submittedToken.length &&
    crypto.timingSafeEqual(Buffer.from(sessionToken), Buffer.from(submittedToken));

  if (!valid) {
    return res.status(403).render('home/message_error', {
      message: 'Solicitud no válida',
      message2: 'El token de seguridad expiró o es inválido. Recarga la página e inténtalo de nuevo.',
      limit: null,
    });
  }

  next();
}

module.exports = { csrfTokenMiddleware, verifyCsrfToken };
