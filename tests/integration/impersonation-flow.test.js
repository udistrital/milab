const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const session = require('express-session');
const request = require('supertest');

const { loadModuleWithStubs, resolveRepoPath } = require('./helpers/build-test-app');
const { createUser } = require('./helpers/session-fixtures');
const { buildSessionUser } = require('../../src/libs/user-identity');
const { startSessionLifetime } = require('../../src/libs/session-policy');
const { csrfTokenMiddleware, verifyCsrfToken } = require('../../src/routes/middlewares/csrf');

function loadImpersonationApp(role, { failStopAudit = false } = {}) {
  const admin = createUser();
  const target = createUser({
    id: 2,
    documento: '200',
    correo: 'usuario@udistrital.edu.co',
    roles: [role],
    tipo: role,
  });
  const poolStub = {
    async query(sql, params) {
      if (sql.includes('FROM menu_item')) {
        return { rows: [{ id: 1, route: '/milab/api/dashboard' }] };
      }
      if (sql.includes('FROM rol_permiso')) {
        return {
          rows: params[1].some((value) => ['admin', 'coordinador', 'laboratorista'].includes(value))
            ? [{}]
            : [],
        };
      }
      if (
        failStopAudit &&
        sql.includes('INSERT INTO log') &&
        params[2] === 'Fin de impersonación desde dashboard'
      ) {
        throw new Error('Audit database unavailable');
      }
      return { rows: [] };
    },
  };
  const dashboard = loadModuleWithStubs({
    entryPath: resolveRepoPath('src/routes/api/dashboard.js'),
    stubs: [
      [resolveRepoPath('src/libs/db.js'), poolStub],
      [
        resolveRepoPath('src/libs/user-identity.js'),
        { buildSessionUser, fetchUserById: async () => target },
      ],
    ],
  });
  const menu = loadModuleWithStubs({
    entryPath: resolveRepoPath('src/routes/middlewares/menu-permissions.js'),
  });
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use(
    session({
      secret: 'impersonation-integration-test-secret',
      resave: false,
      saveUninitialized: false,
    })
  );
  app.use(csrfTokenMiddleware);
  app.use((req, res, next) => {
    res.render = (view, locals) => res.status(res.statusCode || 200).json({ view, locals });
    next();
  });
  app.post('/test-login', (req, res) => {
    req.session.user = req.body.asTarget ? target : admin;
    startSessionLifetime(req.session, 123);
    res.json({ csrfToken: req.session.csrfToken });
  });
  app.get('/test-session', (req, res) => {
    res.json({
      user: req.session.user,
      impersonationAdminUser: req.session.impersonationAdminUser,
      csrfToken: req.session.csrfToken,
      lifetime: req.session.lifetime,
    });
  });
  app.use('/milab/api', verifyCsrfToken, menu.loaded.menuPermissionMiddleware);
  app.use('/milab/api/dashboard', dashboard.loaded);

  return {
    app,
    admin,
    restore() {
      menu.restore();
      dashboard.restore();
    },
  };
}

for (const role of ['estudiante', 'docente', 'monitor', 'laboratorista', 'coordinador']) {
  test(`admin returns from ${role} impersonation with a persisted session`, async () => {
    const loaded = loadImpersonationApp(role);
    try {
      const agent = request.agent(loaded.app);
      const login = await agent.post('/test-login').send({});
      const csrfToken = login.body.csrfToken;
      const start = await agent
        .post('/milab/api/dashboard/impersonacion/iniciar')
        .set('X-CSRF-Token', csrfToken)
        .send({ usuarioId: 2 });
      assert.equal(start.status, 200);
      assert.equal(start.body.ok, true);
      assert.notDeepEqual(start.headers['set-cookie'], login.headers['set-cookie']);

      const impersonated = await agent.get('/test-session');
      assert.equal(impersonated.body.user.tipo, role);
      assert.equal(impersonated.body.user.__impersonating, true);
      assert.deepEqual(impersonated.body.impersonationAdminUser, loaded.admin);
      assert.equal(impersonated.body.lifetime.startedAt, 123);

      const stop = await agent
        .post('/milab/api/dashboard/impersonacion/detener')
        .type('form')
        .send({ _csrf: csrfToken });
      assert.equal(stop.status, 302);
      assert.equal(stop.headers.location, '/milab/api/dashboard');
      assert.notDeepEqual(stop.headers['set-cookie'], start.headers['set-cookie']);

      const restored = await agent.get('/test-session');
      assert.deepEqual(restored.body.user, loaded.admin);
      assert.equal(restored.body.impersonationAdminUser, undefined);
      assert.equal(restored.body.user.__impersonating, undefined);
      assert.equal(restored.body.csrfToken, csrfToken);
      assert.equal(restored.body.lifetime.startedAt, 123);
    } finally {
      loaded.restore();
    }
  });
}

test('a student without impersonation cannot gain admin access through the stop action', async () => {
  const loaded = loadImpersonationApp('estudiante');
  try {
    const agent = request.agent(loaded.app);
    const login = await agent.post('/test-login').send({ asTarget: true });
    const stop = await agent
      .post('/milab/api/dashboard/impersonacion/detener')
      .type('form')
      .send({ _csrf: login.body.csrfToken });
    assert.equal(stop.status, 302);
    assert.equal(stop.headers.location, '/milab/inicio');
    const current = await agent.get('/test-session');
    assert.equal(current.body.user.tipo, 'estudiante');

    const start = await agent
      .post('/milab/api/dashboard/impersonacion/iniciar')
      .set('X-CSRF-Token', login.body.csrfToken)
      .send({ usuarioId: 2 });
    assert.equal(start.body.view, 'home/message_error');
    assert.match(start.body.locals.message, /Acceso denegado/);

    const dashboard = await agent.get('/milab/api/dashboard');
    assert.equal(dashboard.body.view, 'home/message_error');
  } finally {
    loaded.restore();
  }
});

test('stopping impersonation still requires a valid CSRF token', async () => {
  const loaded = loadImpersonationApp('estudiante');
  try {
    const agent = request.agent(loaded.app);
    const login = await agent.post('/test-login').send({});
    await agent
      .post('/milab/api/dashboard/impersonacion/iniciar')
      .set('X-CSRF-Token', login.body.csrfToken)
      .send({ usuarioId: 2 });

    const stop = await agent.post('/milab/api/dashboard/impersonacion/detener').send({});
    assert.equal(stop.status, 403);
    const current = await agent.get('/test-session');
    assert.equal(current.body.user.__impersonating, true);
    assert.deepEqual(current.body.impersonationAdminUser, loaded.admin);
  } finally {
    loaded.restore();
  }
});

test('an audit failure on impersonation exit reports an error and preserves the origin admin', async () => {
  const loaded = loadImpersonationApp('estudiante', { failStopAudit: true });
  try {
    const agent = request.agent(loaded.app);
    const login = await agent.post('/test-login').send({});
    await agent
      .post('/milab/api/dashboard/impersonacion/iniciar')
      .set('X-CSRF-Token', login.body.csrfToken)
      .send({ usuarioId: 2 });

    const stop = await agent
      .post('/milab/api/dashboard/impersonacion/detener')
      .type('form')
      .send({ _csrf: login.body.csrfToken });
    assert.equal(stop.status, 500);
    assert.equal(stop.headers.location, undefined);
    assert.equal(stop.body.view, 'home/message_error');
    assert.match(stop.body.locals.message, /No fue posible volver/);

    const current = await agent.get('/test-session');
    assert.equal(current.body.user.__impersonating, true);
    assert.deepEqual(current.body.impersonationAdminUser, loaded.admin);
  } finally {
    loaded.restore();
  }
});
