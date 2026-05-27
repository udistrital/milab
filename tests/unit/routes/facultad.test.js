const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/facultad.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const accountEmailPath = path.resolve(__dirname, '../../../src/libs/account-email.js');
const authPath = path.resolve(__dirname, '../../../src/routes/middlewares/auth.js');

function buildApp(route) {
  const app = express();

  app.use((req, res, next) => {
    req.session = {
      user: {
        tipo: 'admin',
        documento: '1024467835',
      },
    };
    res.render = (view, locals) => res.status(res.statusCode || 200).json({ view, locals });
    next();
  });
  app.use('/', route);

  return app;
}

function loadRoute() {
  const originals = new Map();
  const queryCalls = [];
  const stubs = [
    [
      dbPath,
      {
        query: async (sql, params = []) => {
          queryCalls.push({ sql, params });

          if (sql.includes('SELECT ual.nombre AS ual_nombre')) {
            return {
              rows: [
                {
                  ual_nombre: 'UAL Antigua',
                  ual_facultad: '1',
                  facultad_nombre: 'ASAB',
                },
              ],
            };
          }

          return { rows: [] };
        },
      },
    ],
    [accountEmailPath, { normalizeLogDocument: (value) => value }],
    [
      authPath,
      {
        requireRoles: () => (req, res, next) => next(),
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
    queryCalls,
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

test('facultad parses form body for UAL edit requests', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/ual/editar').type('form').send({
      id_ual: '10',
      id_facultad: '1',
      nombre: 'UAL Nueva',
      new_id_facultad: '1',
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/milab/api/facultad?id_facultad=1');

    const updatedNameQuery = loaded.queryCalls.find(
      ({ sql, params }) =>
        sql === 'UPDATE ual SET nombre = $1 WHERE id_ual = $2' &&
        params[0] === 'UAL Nueva' &&
        params[1] === '10'
    );

    assert.ok(updatedNameQuery);
  } finally {
    loaded.restore();
  }
});
