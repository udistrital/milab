const { getSessionPolicy, startSessionLifetime } = require('../../libs/session-policy');

const SESSION_HOME = '/milab/';

function wantsSessionJson(req) {
  if (req.xhr) return true;
  if (req.get?.('sec-fetch-dest') === 'empty') return true;
  const accept = String(req.get?.('accept') || '').toLowerCase();
  return accept.includes('application/json') && !accept.includes('text/html');
}

function expireSession(req, res, next, reason = 'missing') {
  const finish = () => {
    res.clearCookie('connect.sid', {
      path: '/',
      secure: req.sessionCookieSecure || false,
      httpOnly: true,
      sameSite: req.sessionSameSite || 'lax',
    });
    res.set('Cache-Control', 'no-store');
    res.set('X-Session-Expired', '1');
    req.log?.info({ event: 'session_expired', reason }, 'Session ended');
    if (wantsSessionJson(req)) {
      return res.status(401).json({
        ok: false,
        code: 'SESSION_EXPIRED',
        message: 'Tu sesión finalizó. Inicia sesión nuevamente para continuar.',
        redirect: SESSION_HOME,
      });
    }
    return res.redirect(303, SESSION_HOME);
  };

  if (!req.session) return finish();
  return req.session.destroy((error) => {
    if (error) return next(error);
    return finish();
  });
}

function isSessionActivityRequest(req) {
  const path = String(req.originalUrl || '').split('?')[0];
  if (path === '/milab/auth/session/activity') return false;
  if (path === '/milab/auth/session/status') return false;
  if (/\/check-services\/?$/.test(path)) return false;
  if (path.startsWith('/milab/public/') || path.startsWith('/public/')) return false;
  if (path.startsWith('/css/') || path.startsWith('/js/')) return false;
  return (
    path === '/milab/' ||
    path === '/milab/inicio' ||
    path.startsWith('/milab/api/') ||
    path.startsWith('/api/') ||
    path.startsWith('/milab/prestamos')
  );
}

function updateSessionExpiry(req, res, timestamp) {
  const policy = res.locals.sessionPolicy;
  const expiresAt = Math.min(
    req.session.lifetime.startedAt + policy.absoluteTimeoutMs,
    req.session.lifetime.lastActivityAt + policy.idleTimeoutMs
  );
  res.locals.sessionExpiresInMs = expiresAt - timestamp;
  res.set('X-Session-Expires-In', String(expiresAt - timestamp));
}

function createSessionLifetimeMiddleware(policy = getSessionPolicy(), now = Date.now) {
  return function sessionLifetimeMiddleware(req, res, next) {
    res.locals.sessionPolicy = policy;
    if (!req.session?.user) return next();

    const timestamp = now();
    req.sessionNow = now;
    if (!req.session.lifetime) startSessionLifetime(req.session, timestamp);
    const { startedAt, lastActivityAt } = req.session.lifetime;
    if (
      !Number.isFinite(startedAt) ||
      !Number.isFinite(lastActivityAt) ||
      timestamp - startedAt >= policy.absoluteTimeoutMs
    ) {
      return expireSession(req, res, next, 'absolute');
    }
    if (timestamp - lastActivityAt >= policy.idleTimeoutMs) {
      return expireSession(req, res, next, 'idle');
    }

    if (isSessionActivityRequest(req)) req.session.lifetime.lastActivityAt = timestamp;
    updateSessionExpiry(req, res, timestamp);
    return next();
  };
}

module.exports = {
  createSessionLifetimeMiddleware,
  expireSession,
  wantsSessionJson,
  updateSessionExpiry,
};
