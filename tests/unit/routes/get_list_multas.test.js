const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/get_list_multas.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const facultyScopePath = path.resolve(__dirname, '../../../src/libs/faculty-scope.js');
const authPath = path.resolve(__dirname, '../../../src/routes/middlewares/auth.js');
const oatiNamePath = path.resolve(__dirname, '../../../src/libs/oati-name.js');

function buildApp(route, user) {
  const app = express();

  app.use((req, res, next) => {
    req.session = { user };
    res.render = (view, locals) => res.status(res.statusCode || 200).json({ view, locals });
    next();
  });
  app.use('/', route);

  return app;
}

function loadRoute({ resolveScopeImpl, clientQueryImpl, resolveOatiNameImpl } = {}) {
  const originals = new Map();
  const client = {
    release() {},
    async query(sql, params = []) {
      if (typeof clientQueryImpl === 'function') {
        return clientQueryImpl(sql, params);
      }

      return {
        rows: [
          { id: 1, tipo_sancionado: 'estudiante', con_estado_multa: 'Pendiente' },
          { id: 2, tipo_sancionado: 'docente', con_estado_multa: 'POR SALDAR' },
        ],
      };
    },
  };

  const stubs = [
    [
      dbPath,
      {
        async connect() {
          return client;
        },
      },
    ],
    [
      facultyScopePath,
      {
        resolveCoordinatorScope:
          resolveScopeImpl || (async () => ({ coordinatorDocument: '900', facultyIds: [10] })),
      },
    ],
    [
      authPath,
      {
        requireRoles: () => (req, res, next) => next(),
      },
    ],
    [
      oatiNamePath,
      {
        resolveOatiName: resolveOatiNameImpl || (async () => 'Nombre OATI'),
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

test('get_list_multas returns grouped sanctions for non-coordinator roles', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', documento: '1024467835' });
    const response = await request(app).get('/');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/get_list_multas');
    assert.equal(response.body.locals.sampleData.length, 2);
    assert.equal(response.body.locals.sancionesEstudiantes.length, 1);
    assert.equal(response.body.locals.sancionesDocentes.length, 1);
  } finally {
    loaded.restore();
  }
});

test('get_list_multas denies coordinador without faculty scope', async () => {
  const loaded = loadRoute({
    resolveScopeImpl: async () => ({ coordinatorDocument: '900', facultyIds: [] }),
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

test('get_list_multas resolve_name returns false when documento is missing', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', documento: '1' });
    const response = await request(app).get('/resolve_name');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { ok: false, nombre: '' });
  } finally {
    loaded.restore();
  }
});
