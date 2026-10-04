const test = require('node:test');
const assert = require('node:assert/strict');
const {
  expireSession,
  createSessionLifetimeMiddleware,
} = require('../../../src/routes/middlewares/session-expiration');

test('session destruction failures propagate without a success redirect or cookie clearing', () => {
  const failure = new Error('Session store unavailable');
  let forwarded;
  expireSession(
    { session: { destroy: (callback) => callback(failure) } },
    {
      clearCookie() {
        assert.fail('Cookie must not be cleared on failed destruction');
      },
      redirect() {
        assert.fail('Must not redirect after failed destruction');
      },
    },
    (error) => {
      forwarded = error;
    }
  );
  assert.equal(forwarded, failure);
});

test('expired server sessions cannot be revived by a late activity request', () => {
  let destroyed = false;
  const req = {
    method: 'POST',
    originalUrl: '/milab/auth/session/activity',
    session: {
      user: { tipo: 'admin' },
      lifetime: { startedAt: 1, lastActivityAt: 1 },
      destroy(callback) {
        destroyed = true;
        callback(null);
      },
    },
    get: () => 'application/json',
  };
  const res = {
    locals: {},
    clearCookie() {},
    set() {
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
    },
  };
  createSessionLifetimeMiddleware({ idleTimeoutMs: 30, absoluteTimeoutMs: 80 }, () => 31)(
    req,
    res,
    () => assert.fail('Expired session must not reach activity handler')
  );
  assert.equal(destroyed, true);
  assert.equal(res.statusCode, 401);
  assert.equal(req.session.lifetime.lastActivityAt, 1);
});
