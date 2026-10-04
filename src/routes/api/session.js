const router = require('express').Router();
const { expireSession, updateSessionExpiry } = require('../middlewares/session-expiration');

function respondWithSession(req, res, next) {
  if (!req.session?.user) return expireSession(req, res, next);
  if (req.method === 'POST') {
    const timestamp = req.sessionNow();
    req.session.lifetime.lastActivityAt = timestamp;
    updateSessionExpiry(req, res, timestamp);
  }
  return res.set('Cache-Control', 'no-store').json({
    ok: true,
    expiresInMs: res.locals.sessionExpiresInMs,
  });
}

router.get('/status', respondWithSession);
router.post('/activity', respondWithSession);

module.exports = router;
