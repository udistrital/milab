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

function loadReservationApp(queryImpl) {
  const sessionHarness = createSessionHarness({
    user: createUser({ tipo: 'estudiante', roles: ['estudiante'], id: 22, documento: '20241001' }),
  });

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
          query: async (sql, params = []) => {
            if (typeof queryImpl === 'function') {
              return queryImpl(sql, params);
            }

            if (sql.includes('FROM usuario u')) {
              return {
                rows: [
                  {
                    id: 22,
                    documento: '20241001',
                    nombre: 'Estudiante Demo',
                    correo: 'estudiante@udistrital.edu.co',
                    roles: ['estudiante'],
                  },
                ],
              };
            }

            if (sql.includes('SELECT COUNT(*)::int AS total')) {
              return { rows: [{ total: 2 }] };
            }

            return { rows: [] };
          },
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
      [
        prestamosModuleAccessPath,
        { getPrestamosModuleAccess: async () => ({ blocked: false, role: 'estudiante' }) },
      ],
      [
        operationalRolesPath,
        { fetchOperationalRoleScopeByUser: async () => ({ facultyIds: [], ualIds: [] }) },
      ],
      [emailNotificationsPath, { sendEmailNotification: async () => {} }],
    ],
    purgePaths: [routePath],
  });
}

test('prestamos reservation form loads visible sanctions count for the current student', async () => {
  const loaded = loadReservationApp();

  try {
    const response = await request(loaded.app).get('/solicitar');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/prestamos/solicitudes/solicitar');
    assert.equal(response.body.locals.sancionesActivas, 2);
  } finally {
    loaded.restore();
  }
});

test('prestamos reservation lookup redirects when faculty or lab filters are missing', async () => {
  const loaded = loadReservationApp();

  try {
    const response = await request(loaded.app).get('/solicitar/consultar');

    assert.equal(response.status, 302);
    assert.match(
      response.headers.location,
      /Debes%20seleccionar%20una%20facultad%20y%20un%20laboratorio/
    );
  } finally {
    loaded.restore();
  }
});
