const SESSION_POLICY = Object.freeze({
  idleTimeoutMs: 30 * 60 * 1000,
  absoluteTimeoutMs: 8 * 60 * 60 * 1000,
});

function getSessionPolicy() {
  return SESSION_POLICY;
}

function startSessionLifetime(session, now = Date.now()) {
  session.lifetime = { startedAt: now, lastActivityAt: now };
}

module.exports = {
  getSessionPolicy,
  startSessionLifetime,
};
