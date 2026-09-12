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

function loadDashboardApp({ user, scopeImpl, scopeRows, poolRows = {} }) {
  const sessionHarness = createSessionHarness({ user });
  const client = createDashboardClient(scopeRows);

  const poolStub = {
    async query(sql, params = []) {
      if (sql.includes('FROM information_schema.columns')) {
        return { rows: [{ column_name: (params && params[1] && params[1][0]) || 'id' }] };
      }
      if (sql.includes('FROM facultad')) {
        return { rows: scopeRows.faculties || [] };
      }
      if (sql.includes('FROM certificado_estudiante')) {
        return { rows: poolRows.studentCertificates || [] };
      }
      if (sql.includes('FROM certificado_docente')) {
        return { rows: poolRows.teacherCertificates || [] };
      }
      if (sql.includes('FROM multa')) {
        return { rows: poolRows.sanctions || [] };
      }
      if (sql.includes('FROM laboratorista')) {
        return { rows: poolRows.laboratoristas || [] };
      }
      if (sql.includes('FROM coordinador')) {
        return { rows: poolRows.coordinators || [] };
      }
      if (sql.includes('FROM usuario')) {
        return { rows: poolRows.usuarios || [] };
      }
      return { rows: [] };
    },
    async connect() {
      return client;
    },
  };

  return buildApp({
    entryPath: routePath,
    sessionHarness,
    stubs: [
      [dbPath, poolStub],
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
