function normalizeRequestPath(originalUrl) {
  return String(originalUrl || '').split('?')[0];
}

const publicMilabApiAllowlist = [
  { prefix: '/milab/api/login/login', methods: ['POST'], allowSubpaths: false },
  { prefix: '/milab/api/register', methods: ['POST'], allowSubpaths: true },
  { prefix: '/milab/api/consulta-invit', methods: ['GET', 'POST'], allowSubpaths: false },
  { prefix: '/milab/api/get-data1', methods: ['POST'], allowSubpaths: false },
  { prefix: '/milab/api/get-data2', methods: ['POST'], allowSubpaths: false },
  { prefix: '/milab/api/register_labs/verify_token', methods: ['GET'], allowSubpaths: false },
  { prefix: '/milab/api/register_labs/new', methods: ['GET'], allowSubpaths: false },
];

function isPublicMilabApiRequest(requestPath, method) {
  return publicMilabApiAllowlist.some((rule) => {
    if (!rule.methods.includes(method)) return false;

    if (rule.allowSubpaths) {
      return requestPath === rule.prefix || requestPath.startsWith(`${rule.prefix}/`);
    }

    return requestPath === rule.prefix;
  });
}

function isProtectedMilabPath(requestPath) {
  if (!requestPath.startsWith('/milab')) {
    return false;
  }

  return (
    requestPath === '/milab/inicio' ||
    requestPath.startsWith('/milab/inicio/') ||
    requestPath.startsWith('/milab/prestamos') ||
    requestPath.startsWith('/milab/api/')
  );
}

function shouldReturnJson(req, requestPath) {
  if (req.xhr) return true;
  if (requestPath.startsWith('/milab/api/')) return true;

  const accept = req.get?.('accept') || '';
  return accept.includes('application/json');
}

function sessionGateMiddleware(req, res, next) {
  const requestPath = normalizeRequestPath(req.originalUrl);
  const method = String(req.method || 'GET').toUpperCase();

  if (!isProtectedMilabPath(requestPath)) {
    return next();
  }

  if (isPublicMilabApiRequest(requestPath, method)) {
    return next();
  }

  const allowProfileFlow =
    req.session?.microsoftProfile &&
    (requestPath === '/milab/api/profile' || requestPath === '/milab/api/profile/identify');
  if (allowProfileFlow) {
    return next();
  }

  if (req.session?.user) {
    return next();
  }

  if (shouldReturnJson(req, requestPath)) {
    return res.status(401).json({
      ok: false,
      code: 'SESSION_EXPIRED',
      message: 'Debe iniciar sesión para continuar.',
      message2: 'Tu sesión expiró o no es válida.',
    });
  }

  return res.redirect('/milab/auth/login');
}

module.exports = {
  sessionGateMiddleware,
  normalizeRequestPath,
  isPublicMilabApiRequest,
  isProtectedMilabPath,
};
