const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/coordinadores_registrados.js');
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
    res.render = (view, locals) => res.status(res.statusCode || 200).json({ view, locals });
    next();
  });
  app.use('/', route);

  return app;
}

function loadRoute({ connectQueryImpl, poolQueryImpl, findConflictImpl } = {}) {
  const originals = new Map();
  const clientCalls = [];

  const client = {
    async query(sql, params = []) {
      clientCalls.push({ sql, params });
      if (typeof connectQueryImpl === 'function') {
        return connectQueryImpl(sql, params);
      }

      if (sql.includes('SELECT documento, nombre, correo, nombre_u, usuario_id FROM coordinador')) {
        return {
          rows: [
            {
              documento: '900',
              nombre: 'Coord Demo',
              correo: 'coord@udistrital.edu.co',
              nombre_u: 'coord-user',
              usuario_id: 7,
            },
          ],
        };
      }

      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }

      return { rows: [] };
    },
    release() {},
  };

  const stubs = [
    [
      dbPath,
      {
        query:
          poolQueryImpl ||
          (async () => ({ rows: [{ con_documento: '900', con_nombre: 'Coord Demo' }] })),
        connect: async () => client,
      },
    ],
    [
      accountEmailPath,
      {
        findEmailConflict: findConflictImpl || (async () => null),
        isInstitutionalEmail: (correo) => /@udistrital\.edu\.co$/i.test(String(correo || '')),
        isUniqueViolation: () => false,
        normalizeLogDocument: (value) => value,
        normalizeInstitutionalEmail: (value) =>
          String(value || '')
            .trim()
            .toLowerCase(),
      },
    ],
    [
      authPath,
      {
        requireJsonRoles: () => (req, res, next) => next(),
        requireRoles: () => (req, res, next) => next(),
      },
    ],
    [
      errorHandlerPath,
      {
        wantsJson: () => false,
        renderApplicationError: (res, payload) => res.status(payload.status || 500).json(payload),
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
    getClientCalls: () => clientCalls,
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

test('coordinadores_registrados exports an Express router with handlers', () => {
  delete require.cache[routePath];
  const router = require(routePath);

  assert.equal(typeof router, 'function');
  assert.equal(typeof router.use, 'function');
  assert.equal(Array.isArray(router.stack), true);
  assert.equal(router.stack.length > 0, true);
});

test('coordinadores_registrados lists registered coordinators', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', documento: '100' });
    const response = await request(app).get('/');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/coordinadores_registrados');
    assert.equal(response.body.locals.coordinadores.length, 1);
  } finally {
    loaded.restore();
  }
});

test('coordinadores_registrados actualizar-correo rejects email conflicts', async () => {
  const loaded = loadRoute({
    findConflictImpl: async () => ({ documento: '99999' }),
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', documento: '100' });
    const response = await request(app)
      .post('/actualizar-correo')
      .type('form')
      .send({ documento: '900', correo: 'otro@udistrital.edu.co' });

    assert.equal(response.status, 409);
    assert.match(response.body.message, /ya existe vinculado a otra cuenta/i);
  } finally {
    loaded.restore();
  }
});

test('coordinadores_registrados actualizar-correo updates coordinator and linked user', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', documento: '100' });
    const response = await request(app)
      .post('/actualizar-correo')
      .type('form')
      .send({ documento: '900', correo: 'nuevo@udistrital.edu.co' });

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);

    const calls = loaded.getClientCalls();
    assert.equal(
      calls.some((call) => call.sql.includes('UPDATE coordinador SET correo = $1')),
      true
    );
    assert.equal(
      calls.some((call) => call.sql.includes('UPDATE usuario')),
      true
    );
  } finally {
    loaded.restore();
  }
});
