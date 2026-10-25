const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const modulePath = path.resolve(__dirname, '../../../src/routes/api/admin/roles.js');
const viewPath = path.resolve(__dirname, '../../../src/views/home/admin_roles.ejs');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const accountEmailPath = path.resolve(__dirname, '../../../src/libs/account-email.js');
const authPath = path.resolve(__dirname, '../../../src/routes/middlewares/auth.js');
const errorHandlerPath = path.resolve(
  __dirname,
  '../../../src/routes/middlewares/error-handler.js'
);

function buildApp(route, sessionUser) {
  const app = express();

  app.use((req, res, next) => {
    req.session = { user: sessionUser };
    res.render = (view, locals) => res.status(200).json({ view, locals });
    next();
  });
  app.use('/', route);

  return app;
}

function defaultClientQuery(sql, params, { missingEncountersGroup }) {
  if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
  if (sql.includes('INSERT INTO rol (nombre, activo)')) return { rows: [{ id: 7 }] };
  if (sql.includes('SELECT id FROM rol WHERE nombre')) return { rows: [{ id: 1 }] };
  if (sql.includes('INSERT INTO menu_item')) return { rows: [{ id: 10 }] };
  if (sql.includes("label = 'Encuentros'")) {
    return { rows: missingEncountersGroup ? [] : [{ id: 20 }] };
  }
  if (sql.includes('FROM menu_item') && sql.includes('route = $1')) {
    return { rows: [{ id: 21 }] };
  }
  if (sql.includes('INSERT INTO rol_permiso')) return { rows: [{ rol_id: params[0] }] };
  return { rows: [] };
}

function loadRoute({ missingEncountersGroup = false } = {}) {
  const originals = new Map();
  const clientCalls = [];

  const client = {
    async query(sql, params = []) {
      clientCalls.push({ sql, params });
      return defaultClientQuery(sql, params, { missingEncountersGroup });
    },
    release() {},
  };
  const pool = {
    async connect() {
      return client;
    },
    async query() {
      return { rows: [] };
    },
  };
  const stubs = [
    [dbPath, pool],
    [accountEmailPath, { normalizeLogDocument: (value) => value }],
    [
      authPath,
      {
        requireRoles: (role) => (req, res, next) => {
          const roles = req.session?.user?.roles || [req.session?.user?.tipo];
          return roles.includes(role) ? next() : res.status(403).json({ error: 'Forbidden' });
        },
      },
    ],
    [errorHandlerPath, { renderApplicationError: (res) => res.status(500).json({ error: true }) }],
  ];

  delete require.cache[modulePath];
  for (const [stubPath, stub] of stubs) {
    originals.set(stubPath, require.cache[stubPath]);
    require.cache[stubPath] = {
      id: stubPath,
      filename: stubPath,
      loaded: true,
      exports: stub,
    };
  }

  return {
    route: require(modulePath),
    clientCalls,
    restore() {
      for (const [stubPath, original] of originals.entries()) {
        if (original) {
          require.cache[stubPath] = original;
        } else {
          delete require.cache[stubPath];
        }
      }
      delete require.cache[modulePath];
    },
  };
}

test('admin roles exports an Express router with handlers', () => {
  const modulePath = path.resolve(__dirname, '../../../src/routes/api/admin/roles.js');
  delete require.cache[modulePath];
  const router = require(modulePath);

  assert.equal(typeof router, 'function');
  assert.equal(typeof router.use, 'function');
  assert.equal(Array.isArray(router.stack), true);
  assert.equal(router.stack.length > 0, true);
  delete require.cache[modulePath];
});

test('admin roles view exposes the idempotent gestor setup action', () => {
  const view = fs.readFileSync(viewPath, 'utf8');

  assert.match(view, /action="\/milab\/api\/admin\/roles\/gestor-laboratorio\/inicializar"/);
  assert.match(view, /no asigna el rol a ninguna cuenta/i);
});

test('admin can idempotently initialize gestor role and permissions without assigning users', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', roles: ['admin'] });
    const response = await request(app).post('/gestor-laboratorio/inicializar');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/admin_roles');
    assert.match(response.body.locals.success, /No se duplicaron registros/);

    const roleInsert = loaded.clientCalls.find((call) =>
      call.sql.includes('INSERT INTO rol (nombre, activo)')
    );
    assert.ok(roleInsert);
    assert.deepEqual(roleInsert.params, ['gestor_laboratorio']);
    assert.match(roleInsert.sql, /ON CONFLICT \(nombre\)/);

    const permissionInserts = loaded.clientCalls.filter((call) =>
      call.sql.includes('INSERT INTO rol_permiso')
    );
    assert.equal(permissionInserts.length, 3);
    assert.ok(
      permissionInserts.every((call) => /ON CONFLICT \(rol_id, menu_item_id\)/.test(call.sql))
    );
    assert.ok(loaded.clientCalls.some((call) => call.sql === 'COMMIT'));
    assert.equal(
      loaded.clientCalls.some((call) => call.sql === 'ROLLBACK'),
      false
    );
    assert.equal(
      loaded.clientCalls.some((call) => call.sql.includes('INSERT INTO usuario_rol')),
      false
    );
  } finally {
    loaded.restore();
  }
});

test('admin roles setup rolls back when the Encuentros menu is missing', async () => {
  const loaded = loadRoute({ missingEncountersGroup: true });

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', roles: ['admin'] });
    const response = await request(app).post('/gestor-laboratorio/inicializar');

    assert.equal(response.status, 200);
    assert.match(response.body.locals.error, /No se encontró el menú activo de Encuentros/);
    assert.ok(loaded.clientCalls.some((call) => call.sql === 'ROLLBACK'));
    assert.equal(
      loaded.clientCalls.some((call) => call.sql === 'COMMIT'),
      false
    );
    assert.equal(
      loaded.clientCalls.some((call) => call.sql.includes('INSERT INTO rol_permiso')),
      false
    );
  } finally {
    loaded.restore();
  }
});

test('admin roles setup rejects non-admin users before connecting to the database', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, { tipo: 'coordinador', roles: ['coordinador'] });
    const response = await request(app).post('/gestor-laboratorio/inicializar');

    assert.equal(response.status, 403);
    assert.equal(loaded.clientCalls.length, 0);
  } finally {
    loaded.restore();
  }
});
