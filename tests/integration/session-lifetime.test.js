const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const session = require('express-session');
const request = require('supertest');
const {
  createSessionLifetimeMiddleware,
} = require('../../src/routes/middlewares/session-expiration');
const { requireApiSessionUnlessPublic } = require('../../src/routes/middlewares/api-session-gate');
const { sessionGateMiddleware } = require('../../src/routes/middlewares/session-gate');
const { startSessionLifetime } = require('../../src/libs/session-policy');
const { csrfTokenMiddleware, verifyCsrfToken } = require('../../src/routes/middlewares/csrf');
const sessionRouter = require('../../src/routes/api/session');

function buildLifetimeApp() {
  let now = 1000000;
  const policy = { idleTimeoutMs: 1800000, absoluteTimeoutMs: 28800000 };
  const store = new session.MemoryStore();
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(
    session({
      secret: 'session-lifetime-test-secret',
      store,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: { maxAge: policy.idleTimeoutMs },
    })
  );
  app.use(createSessionLifetimeMiddleware(policy, () => now));
  app.use(csrfTokenMiddleware);
  app.post('/test-login', (req, res) => {
    req.session.user = { id: 1, tipo: 'admin' };
    req.session.impersonationAdminUser = { id: 2, tipo: 'admin' };
    req.session.microsoftProfile = { correo: 'test@udistrital.edu.co' };
    startSessionLifetime(req.session, now);
    res.json({ csrfToken: req.session.csrfToken, id: req.sessionID });
  });
  app.get('/milab/', (req, res) => res.json({ user: req.session.user || null }));
  app.use(
    '/milab/auth/session',
    (req, res, next) => {
      if (!req.session.user) return requireApiSessionUnlessPublic(req, res, next);
      next();
    },
    verifyCsrfToken,
    sessionRouter
  );
  app.use('/api', requireApiSessionUnlessPublic);
  app.use('/milab/api', requireApiSessionUnlessPublic, verifyCsrfToken);
  app.use('/milab', sessionGateMiddleware);
  app.get('/milab/inicio', (req, res) => res.json({ lifetime: req.session.lifetime }));
  app.get('/milab/api/check-services', (req, res) => res.json({ ok: true }));
  app.get('/milab/public/test.js', (req, res) => res.send('asset'));
  app.post('/milab/api/submit', (req, res) => res.json({ ok: true }));
  app.post('/milab/api/dashboard/usuarios/685/correo', (req, res) => res.json({ ok: true }));
  app.post('/api/submit', (req, res) => res.json({ ok: true }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(500).json({ error: error.message });
  });
  return {
    app,
    store,
    policy,
    advance: (ms) => {
      now += ms;
    },
    getStored: (id) =>
      new Promise((resolve, reject) => {
        store.get(id, (error, value) => (error ? reject(error) : resolve(value)));
      }),
  };
}

test('continuous application activity renews the cookie and survives the previous one-hour cutoff', async () => {
  const loaded = buildLifetimeApp();
  const agent = request.agent(loaded.app);
  const login = await agent.post('/test-login').send({});
  const stored = await loaded.getStored(login.body.id);
  for (let i = 0; i < 7; i += 1) {
    loaded.advance(20 * 60 * 1000);
    const response = await agent.get('/milab/inicio').set('Accept', 'application/json');
    assert.equal(response.status, 200);
    assert.ok(response.headers['set-cookie'][0].includes('connect.sid='));
    assert.equal(response.body.lifetime.startedAt, stored.lifetime.startedAt);
    assert.equal(response.body.lifetime.lastActivityAt, 1000000 + (i + 1) * 1200000);
    assert.equal(Number(response.headers['x-session-expires-in']), loaded.policy.idleTimeoutMs);
  }
});

for (const endpoint of [
  '/milab/api/submit',
  '/milab/api/dashboard/usuarios/685/correo',
  '/api/submit',
]) {
  test(`idle expiration at exactly 30 minutes clears all server state for ${endpoint}`, async () => {
    const loaded = buildLifetimeApp();
    const agent = request.agent(loaded.app);
    const login = await agent.post('/test-login').send({});
    loaded.advance(loaded.policy.idleTimeoutMs);
    const response = await agent
      .post(endpoint)
      .set('Accept', 'application/json')
      .set('X-CSRF-Token', login.body.csrfToken)
      .send({});
    assert.equal(response.status, 401);
    assert.equal(response.body.code, 'SESSION_EXPIRED');
    assert.equal(response.body.redirect, '/milab/');
    assert.equal(response.headers['x-session-expired'], '1');
    assert.match(response.headers['set-cookie'][0], /connect.sid=;.*Expires=Thu, 01 Jan 1970/);
    assert.equal(await loaded.getStored(login.body.id), undefined);
    const home = await agent.get('/milab/');
    assert.equal(home.body.user, null);
  });
}

test('an expired HTML form redirects with 303 to public home rather than replaying the POST', async () => {
  const loaded = buildLifetimeApp();
  const agent = request.agent(loaded.app);
  const login = await agent.post('/test-login').send({});
  loaded.advance(loaded.policy.idleTimeoutMs);
  const response = await agent
    .post('/milab/api/submit')
    .set('Accept', 'text/html,application/json;q=0.8')
    .type('form')
    .send({ _csrf: login.body.csrfToken });
  assert.equal(response.status, 303);
  assert.equal(response.headers.location, '/milab/');
  assert.equal(await loaded.getStored(login.body.id), undefined);
});

test('background status, service polling and static assets do not renew inactivity', async () => {
  const loaded = buildLifetimeApp();
  const agent = request.agent(loaded.app);
  const login = await agent.post('/test-login').send({});
  loaded.advance(loaded.policy.idleTimeoutMs - 1);
  for (const path of [
    '/milab/auth/session/status',
    '/milab/api/check-services',
    '/milab/public/test.js',
  ]) {
    const response = await agent.get(path).set('Accept', 'application/json');
    assert.equal(response.status, 200);
  }
  assert.equal((await loaded.getStored(login.body.id)).lifetime.lastActivityAt, 1000000);
  loaded.advance(1);
  const expired = await agent.get('/milab/auth/session/status').set('Accept', 'application/json');
  assert.equal(expired.status, 401);
});

test('form activity renews inactivity only when the heartbeat has valid CSRF', async () => {
  const loaded = buildLifetimeApp();
  const agent = request.agent(loaded.app);
  const login = await agent.post('/test-login').send({});
  loaded.advance(loaded.policy.idleTimeoutMs - 1);
  const invalid = await agent
    .post('/milab/auth/session/activity')
    .set('Accept', 'application/json')
    .set('X-CSRF-Token', 'invalid');
  assert.equal(invalid.status, 403);
  assert.equal((await loaded.getStored(login.body.id)).lifetime.lastActivityAt, 1000000);
  const activity = await agent
    .post('/milab/auth/session/activity')
    .set('Accept', 'application/json')
    .set('X-CSRF-Token', login.body.csrfToken);
  assert.equal(activity.status, 200);
  loaded.advance(loaded.policy.idleTimeoutMs - 1);
  const status = await agent.get('/milab/auth/session/status').set('Accept', 'application/json');
  assert.equal(status.status, 200);
  assert.equal(status.body.expiresInMs, 1);
});

test('the absolute 8-hour limit expires even with continuous activity', async () => {
  const loaded = buildLifetimeApp();
  const agent = request.agent(loaded.app);
  const login = await agent.post('/test-login').send({});
  for (let i = 0; i < 23; i += 1) {
    loaded.advance(20 * 60 * 1000);
    const activity = await agent.get('/milab/inicio').set('Accept', 'application/json');
    assert.equal(activity.status, 200);
  }
  loaded.advance(20 * 60 * 1000);
  const expired = await agent.get('/milab/inicio').set('Accept', 'application/json');
  assert.equal(expired.status, 401);
  assert.equal(await loaded.getStored(login.body.id), undefined);
});

test('a missing browser cookie cannot leave a protected action or heartbeat on an auth error page', async () => {
  const loaded = buildLifetimeApp();
  const response = await request(loaded.app).post('/milab/api/submit').set('Accept', 'text/html');
  assert.equal(response.status, 303);
  assert.equal(response.headers.location, '/milab/');
  const heartbeat = await request(loaded.app)
    .post('/milab/auth/session/activity')
    .set('Accept', 'application/json');
  assert.equal(heartbeat.status, 401);
  assert.equal(heartbeat.body.code, 'SESSION_EXPIRED');
  const defaultFetch = await request(loaded.app)
    .post('/milab/api/submit')
    .set('Accept', '*/*')
    .set('Sec-Fetch-Dest', 'empty');
  assert.equal(defaultFetch.status, 401);
  assert.equal(defaultFetch.body.code, 'SESSION_EXPIRED');
});
