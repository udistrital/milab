const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/admin/menus.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const accountEmailPath = path.resolve(__dirname, '../../../src/libs/account-email.js');
const prestamosAccessPath = path.resolve(__dirname, '../../../src/libs/prestamos-module-access.js');
const authPath = path.resolve(__dirname, '../../../src/routes/middlewares/auth.js');
const errorHandlerPath = path.resolve(
  __dirname,
  '../../../src/routes/middlewares/error-handler.js'
);

function buildApp(route) {
  const app = express();
  app.use((req, res, next) => {
    req.session = { user: { tipo: 'admin', documento: '900' } };
    next();
  });
  app.use('/', route);
  return app;
}

function loadRoute({ clientQueryImpl } = {}) {
  const originals = new Map();
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (clientQueryImpl) return clientQueryImpl(sql, params);
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('SELECT r.nombre AS role_name')) {
        return {
          rows: [
            {
              role_name: 'gestor_laboratorio',
              label: 'Gestores de laboratorio',
              route: '/milab/api/gestores_laboratorio',
            },
          ],
        };
      }
      if (sql.includes('UPDATE rol_permiso')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const pool = {
    async query() {
      throw new Error('Permission changes must use the transaction client');
    },
    async connect() {
      return client;
    },
  };

  const stubs = [
    [dbPath, pool],
    [accountEmailPath, { normalizeLogDocument: (value) => value }],
    [
      prestamosAccessPath,
      {
        listPrestamosFacultyAccess: async () => [],
        updatePrestamosFacultyAccess: async () => {},
      },
    ],
    [authPath, { requireRoles: () => (req, res, next) => next() }],
    [
      errorHandlerPath,
      {
        renderApplicationError: (res) =>
          res.status(500).json({ ok: false, message: 'No fue posible cargar los menus.' }),
      },
    ],
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
    calls,
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

test('menu permission changes are audited and disabled grants are retained', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route);
    const response = await request(app)
      .post('/permissions')
      .type('form')
      .send({ role_id: '12', menu_item_id: '41', enabled: 'false' });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { ok: true });
    assert.equal(
      loaded.calls.some(
        (call) =>
          call.sql.includes('UPDATE rol_permiso') &&
          call.sql.includes('activo = FALSE') &&
          call.params[0] === 12 &&
          call.params[1] === 41
      ),
      true
    );
    assert.equal(
      loaded.calls.some((call) => /DELETE\s+FROM\s+rol_permiso/i.test(call.sql)),
      false
    );
    assert.equal(
      loaded.calls.some(
        (call) =>
          call.sql.includes('INSERT INTO log') &&
          call.params[2] === 'Deshabilitar permiso de menu' &&
          call.params[3].includes('gestor_laboratorio')
      ),
      true
    );
    assert.equal(
      loaded.calls.some((call) => call.sql === 'COMMIT'),
      true
    );
  } finally {
    loaded.restore();
  }
});

test('enabling a menu permission records an active grant and its audit entry', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route);
    const response = await request(app)
      .post('/permissions')
      .type('form')
      .send({ role_id: '12', menu_item_id: '41', enabled: 'true' });

    assert.equal(response.status, 200);
    assert.equal(
      loaded.calls.some(
        (call) =>
          call.sql.includes('INSERT INTO rol_permiso') &&
          call.sql.includes('activo = TRUE') &&
          call.params[0] === 12 &&
          call.params[1] === 41
      ),
      true
    );
    assert.equal(
      loaded.calls.some(
        (call) =>
          call.sql.includes('INSERT INTO log') && call.params[2] === 'Habilitar permiso de menu'
      ),
      true
    );
  } finally {
    loaded.restore();
  }
});
