const { renderAuthError } = require('./auth');

const publicApiAllowlist = [
  { prefix: '/api/login/login', methods: ['POST'], allowSubpaths: false },
  { prefix: '/api/register', methods: ['POST'], allowSubpaths: true },
  { prefix: '/api/consulta-invit', methods: ['GET', 'POST'], allowSubpaths: false },
  { prefix: '/milab/api/consulta-invit', methods: ['GET', 'POST'], allowSubpaths: false },
  { prefix: '/api/get-data1', methods: ['POST'], allowSubpaths: false },
  { prefix: '/api/get-data2', methods: ['POST'], allowSubpaths: false },
  { prefix: '/api/register_labs/verify_token', methods: ['GET'], allowSubpaths: false },
  { prefix: '/api/register_labs/new', methods: ['GET'], allowSubpaths: false },
];

function normalizeRequestPath(originalUrl) {
  return (originalUrl || '').split('?')[0];
}

function isPublicApiRequest(req) {
  const requestPath = normalizeRequestPath(req.originalUrl);
  const method = String(req.method || '').toUpperCase();

  return publicApiAllowlist.some((rule) => {
    if (!rule.methods.includes(method)) return false;

    if (rule.allowSubpaths) {
      return requestPath === rule.prefix || requestPath.startsWith(`${rule.prefix}/`);
    }

    return requestPath === rule.prefix;
  });
}

function expectsJsonResponse(req) {
  if (req.xhr) return true;
  if (typeof req.get === 'function') {
    const accept = req.get('accept') || '';
    return accept.includes('application/json');
  }
  return false;
}

function requireApiSessionUnlessPublic(req, res, next) {
  if (isPublicApiRequest(req) || req.session?.user) {
    return next();
  }

  if (expectsJsonResponse(req)) {
    return res.status(401).json({
      ok: false,
      message: 'Debe iniciar sesión para continuar.',
    });
  }

  return renderAuthError(res, {
    message: 'Acceso denegado',
    message2: 'Debe iniciar sesion para continuar.',
    limit: 'loginOnly',
  });
}

module.exports = {
  isPublicApiRequest,
  requireApiSessionUnlessPublic,
};
