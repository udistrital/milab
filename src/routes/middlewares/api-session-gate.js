const { expireSession } = require('./session-expiration');
const { isPublicMilabApiRequest } = require('./session-gate');

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
  if (isPublicMilabApiRequest(requestPath, method)) return true;

  return publicApiAllowlist.some((rule) => {
    if (!rule.methods.includes(method)) return false;

    if (rule.allowSubpaths) {
      return requestPath === rule.prefix || requestPath.startsWith(`${rule.prefix}/`);
    }

    return requestPath === rule.prefix;
  });
}

function requireApiSessionUnlessPublic(req, res, next) {
  if (isPublicApiRequest(req) || req.session?.user) {
    return next();
  }

  if (
    req.session?.microsoftProfile &&
    ['/milab/api/profile', '/milab/api/profile/identify'].includes(
      normalizeRequestPath(req.originalUrl)
    )
  ) {
    return next();
  }

  return expireSession(req, res, next);
}

module.exports = {
  isPublicApiRequest,
  requireApiSessionUnlessPublic,
};
