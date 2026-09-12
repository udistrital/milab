const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/dashboard.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const facultyScopePath = path.resolve(__dirname, '../../../src/libs/faculty-scope.js');
const authPath = path.resolve(__dirname, '../../../src/routes/middlewares/auth.js');

function buildApp(route, sessionUser) {
  const app = express();

  app.use((req, res, next) => {
    req.session = { user: sessionUser };
    res.render = (view, locals) => res.status(res.statusCode || 200).json({ view, locals });
    next();
  });
  app.use('/', route);

  return app;
}

function loadDashboardRoute({ clientQueryImpl, poolQueryImpl, scopeImpl } = {}) {
  const originals = new Map();

  const client = {
    async query(sql, params = []) {
      if (typeof clientQueryImpl === 'function') {
        return clientQueryImpl(sql, params);
      }

      if (sql.includes('FROM information_schema.columns')) {
        return { rows: [{ column_name: params[1][0] }] };
      }

      return { rows: [] };
    },
    release() {},
  };

  const poolStub = {
    async query(sql, params = []) {
      if (typeof poolQueryImpl === 'function') {
        return poolQueryImpl(sql, params);
      }
      return { rows: [] };
    },
    async connect() {
      return client;
    },
  };

  const stubs = [
    [dbPath, poolStub],
    [
      facultyScopePath,
      {
        resolveAcademicFacultyName: (value) => value,
        resolveCoordinatorScope:
          scopeImpl || (async () => ({ coordinatorDocument: '900', facultyIds: [10] })),
      },
    ],
    [authPath, { requireRoles: () => (req, res, next) => next() }],
  ];

  delete require.cache[routePath];
  for (const [modulePath, stub] of stubs) {
    originals.set(modulePath, require.cache[modulePath]);
    require.cache[modulePath] = {
      id: modulePath,
      filename: modulePath,
      loaded: true,
      exports: stub,
    };
  }

  return {
    route: require(routePath),
    restore() {
      for (const [modulePath, original] of originals.entries()) {
        if (original) {
          require.cache[modulePath] = original;
        } else {
          delete require.cache[modulePath];
        }
      }
      delete require.cache[routePath];
    },
  };
}

test('dashboard exports an Express router with handlers', () => {
  delete require.cache[routePath];
  const router = require(routePath);

  assert.equal(typeof router, 'function');
  assert.equal(typeof router.use, 'function');
  assert.equal(Array.isArray(router.stack), true);
  assert.equal(router.stack.length > 0, true);
});

test('dashboard fetchers query expected data sources for dashboard totals', async () => {
  delete require.cache[routePath];

  const queries = [];
  const dbStub = {
    async query(sql) {
      queries.push(sql);
      return { rows: [] };
    },
    async connect() {
      return { query: async () => ({ rows: [] }), release() {} };
    },
  };
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: dbStub };

  const router = require(routePath);

  await router.__private.fetchCoordinatorRows();
  await router.__private.fetchUsuarioRows();
  await router.__private.fetchSanctionRows();
  await router.__private.fetchLaboratoristaRows();
  await router.__private.fetchStudentCertificateRows();
  await router.__private.fetchTeacherCertificateRows();

  const coordinatorQ = queries.find(
    (q) => q.includes('SELECT c.*') && q.includes('FROM coordinador c')
  );
  const usuarioQ = queries.find((q) => q.includes('WITH usuarios_base AS'));
  const multaQ = queries.find((q) => q.includes('SELECT m.*') && q.includes('FROM multa m'));
  const labQ = queries.find((q) => q.includes('SELECT l.*') && q.includes('FROM laboratorista l'));
  const ceQ = queries.find(
    (q) => q.includes('SELECT ce.*') && q.includes('FROM certificado_estudiante ce')
  );
  const cdQ = queries.find(
    (q) => q.includes('SELECT cd.*') && q.includes('FROM certificado_docente cd')
  );

  assert.equal(coordinatorQ.includes('SELECT c.*'), true);
  assert.equal(usuarioQ.includes('FROM usuario u'), true);
  assert.equal(multaQ.includes('SELECT m.*'), true);
  assert.equal(labQ.includes('SELECT l.*'), true);
  assert.equal(ceQ.includes('SELECT ce.*'), true);
  assert.equal(cdQ.includes('SELECT cd.*'), true);

  assert.equal(usuarioQ.includes('FROM coordinador c'), true);
  assert.equal(usuarioQ.includes('JOIN coordinador_facultad cf'), true);
  assert.equal(usuarioQ.includes('FROM laboratorista l'), true);
  assert.equal(usuarioQ.includes("r.nombre IN ('admin', 'estudiante', 'docente')"), true);
  assert.equal(multaQ.includes('COALESCE'), false);
});

test('dashboard renders default admin chart set when there is no data', async () => {
  const loaded = loadDashboardRoute();

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', documento: '100' });
    const response = await request(app).get('/');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/dashboard');
    assert.equal(response.body.locals.dashboardRole, 'admin');
    assert.equal(response.body.locals.selectedChart, 'estudiantes');
    assert.equal(response.body.locals.availableCharts.length >= 1, true);
  } finally {
    loaded.restore();
  }
});

test('dashboard blocks coordinador without faculty scope', async () => {
  const loaded = loadDashboardRoute({
    scopeImpl: async () => ({ coordinatorDocument: null, facultyIds: [] }),
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'coordinador', documento: 'coord-user' });
    const response = await request(app).get('/');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.match(response.body.locals.message2, /no tiene facultades asociadas/i);
  } finally {
    loaded.restore();
  }
});
