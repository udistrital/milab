const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/monitores_registrados.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const facultyScopePath = path.resolve(__dirname, '../../../src/libs/faculty-scope.js');
const monitorRegistryPath = path.resolve(__dirname, '../../../src/libs/monitor-registry.js');
const operationalRoleAssignmentsPath = path.resolve(
  __dirname,
  '../../../src/libs/operational-role-assignments.js'
);
const permissionsPath = path.resolve(__dirname, '../../../src/libs/permissions.js');
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

function loadRoute({ poolQueryImpl, scopeImpl, ensureMonitorSchemaImpl } = {}) {
  const originals = new Map();
  const poolCalls = [];

  const stubs = [
    [
      dbPath,
      {
        query: async (sql, params = []) => {
          poolCalls.push({ sql, params });
          if (typeof poolQueryImpl === 'function') {
            return poolQueryImpl(sql, params);
          }

          return {
            rows: [
              {
                usuario_id: 8,
                nombre: 'Monitor Demo',
                documento: '12345',
                correo: 'monitor@udistrital.edu.co',
                facultades: 'Facultad 10',
                uales: 'Lab 11',
              },
            ],
          };
        },
      },
    ],
    [
      facultyScopePath,
      {
        resolveCoordinatorScope:
          scopeImpl || (async () => ({ coordinatorDocument: '900', facultyIds: [10] })),
      },
    ],
    [
      monitorRegistryPath,
      {
        ensureMonitorSchema: ensureMonitorSchemaImpl || (async () => {}),
      },
    ],
    [
      operationalRoleAssignmentsPath,
      {
        ensureOperationalRoleAssignmentsSchema: async () => {},
      },
    ],
    [permissionsPath, { APP_PERMISSIONS: { USERS_MONITOR_VIEW: 'users.monitor.view' } }],
    [authPath, { requirePermissions: () => (req, res, next) => next() }],
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
    getPoolCalls: () => poolCalls,
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

test('monitores_registrados lists monitors for admin', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', documento: '100' });
    const response = await request(app).get('/');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/monitores_registrados');
    assert.equal(response.body.locals.monitores.length, 1);
    assert.equal(
      loaded.getPoolCalls().some((call) => call.sql.includes('FROM usuario_ual_rol_operativo a')),
      true
    );
  } finally {
    loaded.restore();
  }
});

test('monitores_registrados returns empty list for coordinador without faculty scope', async () => {
  const loaded = loadRoute({
    scopeImpl: async () => ({ coordinatorDocument: null, facultyIds: [] }),
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'coordinador', documento: 'coord-user' });
    const response = await request(app).get('/');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/monitores_registrados');
    assert.deepEqual(response.body.locals.monitores, []);
  } finally {
    loaded.restore();
  }
});

test('monitores_registrados renders message_error when the listing fails', async () => {
  const loaded = loadRoute({
    poolQueryImpl: async () => {
      throw new Error('db offline');
    },
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', documento: '100' });
    const response = await request(app).get('/');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.match(response.body.locals.message, /Error al obtener monitores/i);
  } finally {
    loaded.restore();
  }
});