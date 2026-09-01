const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { buildApp, resolveRepoPath } = require('./helpers/build-test-app');
const { createSessionHarness, createUser } = require('./helpers/session-fixtures');

const routePath = resolveRepoPath('src/routes/api/prestamos.js');
const authPath = resolveRepoPath('src/routes/middlewares/auth.js');
const dbPath = resolveRepoPath('src/libs/db.js');
const permissionsPath = resolveRepoPath('src/libs/permissions.js');
const prestamosModuleAccessPath = resolveRepoPath('src/libs/prestamos-module-access.js');
const operationalRolesPath = resolveRepoPath('src/libs/operational-role-assignments.js');
const emailNotificationsPath = resolveRepoPath('src/libs/email-notifications.js');

function loadPrestamosApp({ user, access }) {
  const sessionHarness = createSessionHarness({ user });

  return buildApp({
    entryPath: routePath,
    sessionHarness,
    stubs: [
      [
        authPath,
        {
          requirePermissions: () => (req, res, next) => next(),
          requireRoles: () => (req, res, next) => next(),
          renderAuthError: (res, payload) => res.render('home/message_error', payload),
        },
      ],
      [
        dbPath,
        {
          query: async () => ({ rows: [] }),
          connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
        },
      ],
      [
        permissionsPath,
        {
          APP_PERMISSIONS: new Proxy({}, { get: (_, key) => String(key) }),
          hasPermission: () => true,
        },
      ],
      [prestamosModuleAccessPath, { getPrestamosModuleAccess: async () => access }],
      [
        operationalRolesPath,
        { fetchOperationalRoleScopeByUser: async () => ({ facultyIds: [], ualIds: [] }) },
      ],
      [emailNotificationsPath, { sendEmailNotification: async () => {} }],
    ],
    purgePaths: [routePath],
  });
}

test('prestamos root renders the dashboard with cards and quick links for every role', async () => {
  let loaded = loadPrestamosApp({
    user: createUser({ tipo: 'estudiante', roles: ['estudiante'] }),
    access: { blocked: false, role: 'estudiante' },
  });

  try {
    const student = await request(loaded.app).get('/');
    assert.equal(student.status, 200);
    assert.equal(student.body.view, 'home/prestamos/dashboard');
    assert.ok(Array.isArray(student.body.locals.moduleCards));
    assert.ok(Array.isArray(student.body.locals.quickLinks));
    assert.ok(
      student.body.locals.moduleCards.some((card) => card.href === '/milab/prestamos/solicitar'),
      'estudiante ve tarjeta Solicitar equipo en dashboard'
    );
  } finally {
    loaded.restore();
  }

  loaded = loadPrestamosApp({
    user: createUser({ tipo: 'monitor', roles: ['monitor'] }),
    access: { blocked: false, role: 'monitor' },
  });

  try {
    const monitor = await request(loaded.app).get('/');
    assert.equal(monitor.status, 200);
    assert.equal(monitor.body.view, 'home/prestamos/dashboard');
    assert.ok(Array.isArray(monitor.body.locals.moduleCards));
    assert.ok(Array.isArray(monitor.body.locals.quickLinks));
  } finally {
    loaded.restore();
  }
});

test('prestamos returns blocked responses before route resolution when faculty access is disabled', async () => {
  const loaded = loadPrestamosApp({
    user: createUser({ tipo: 'coordinador', roles: ['coordinador'] }),
    access: { blocked: true, role: 'coordinador' },
  });

  try {
    const htmlResponse = await request(loaded.app).get('/');
    assert.equal(htmlResponse.status, 200);
    assert.equal(htmlResponse.body.view, 'home/message_error');
    assert.match(htmlResponse.body.locals.message2, /modulo de Prestamos esta deshabilitado/i);

    const jsonResponse = await request(loaded.app).post('/ruta-inexistente');
    assert.equal(jsonResponse.status, 403);
    assert.equal(jsonResponse.body.success, false);
  } finally {
    loaded.restore();
  }
});
