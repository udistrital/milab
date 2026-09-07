const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { buildApp, resolveRepoPath } = require('./helpers/build-test-app');
const { createSessionHarness, createUser } = require('./helpers/session-fixtures');

const routePath = resolveRepoPath('src/routes/api/dashboard.js');
const dbPath = resolveRepoPath('src/libs/db.js');
const authPath = resolveRepoPath('src/routes/middlewares/auth.js');
const facultyScopePath = resolveRepoPath('src/libs/faculty-scope.js');

function createDashboardClient(scopeRows = {}) {
  return {
    async query(sql, params = []) {
      if (sql.includes('FROM information_schema.columns')) {
        return { rows: [{ column_name: params[1][0] }] };
      }

      if (sql.includes('FROM facultad')) {
        return { rows: scopeRows.faculties || [] };
      }

      return { rows: [] };
    },
    release() {},
  };
}

function loadDashboardApp({ user, scopeImpl, scopeRows }) {
  const sessionHarness = createSessionHarness({ user });
  const client = createDashboardClient(scopeRows);

  return buildApp({
    entryPath: routePath,
    sessionHarness,
    stubs: [
      [dbPath, { connect: async () => client }],
      [authPath, { requireRoles: () => (req, res, next) => next() }],
      [
        facultyScopePath,
        {
          resolveAcademicFacultyName: (value) => value,
          resolveCoordinatorScope:
            scopeImpl || (async () => ({ coordinatorDocument: '900', facultyIds: [10] })),
        },
      ],
    ],
    purgePaths: [routePath],
  });
}

test('dashboard flow renders admin summary from mounted HTTP handler', async () => {
  const loaded = loadDashboardApp({
    user: createUser({ tipo: 'admin', roles: ['admin'] }),
    scopeRows: {},
  });

  try {
    const response = await request(loaded.app).get('/');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/dashboard');
    assert.equal(response.body.locals.dashboardRole, 'admin');
    assert.equal(response.body.locals.selectedChart, 'estudiantes');
  } finally {
    loaded.restore();
  }
});

test('dashboard flow rejects coordinators without associated faculties', async () => {
  const loaded = loadDashboardApp({
    user: createUser({ tipo: 'coordinador', roles: ['coordinador'], documento: 'coord-1' }),
    scopeImpl: async () => ({ coordinatorDocument: null, facultyIds: [] }),
    scopeRows: {},
  });

  try {
    const response = await request(loaded.app).get('/');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.match(response.body.locals.message2, /no tiene facultades asociadas/i);
  } finally {
    loaded.restore();
  }
});
