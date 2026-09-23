const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/quitar-multa.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const userIdentityPath = path.resolve(__dirname, '../../../src/libs/user-identity.js');
const facultyScopePath = path.resolve(__dirname, '../../../src/libs/faculty-scope.js');
const authPath = path.resolve(__dirname, '../../../src/routes/middlewares/auth.js');
const multaConfigPath = path.resolve(__dirname, '../../../src/libs/multa-config.js');

function buildApp(route, user = { tipo: 'coordinador', documento: 'coord-user' }) {
  const app = express();

  app.use((req, res, next) => {
    req.session = { user };
    res.render = (view, locals) => res.status(res.statusCode || 200).json({ view, locals });
    next();
  });
  app.use('/', route);

  return app;
}

function loadRoute({ queryImpl, resolveScopeImpl } = {}) {
  const originals = new Map();

  const stubs = [
    [
      dbPath,
      {
        query: async (sql, params = []) => {
          if (typeof queryImpl === 'function') {
            return queryImpl(sql, params);
          }

          if (sql.includes('SELECT m.usuario_sancionado_id')) {
            return {
              rows: [
                {
                  usuario_sancionado_id: 88,
                  con_estado_multa: 'ACTIVA',
                  ual_id: 10,
                  facultad_id: 7,
                },
              ],
            };
          }

          if (sql.includes('UPDATE multa SET con_estado_multa')) {
            return { rows: [], rowCount: 1 };
          }

          return { rows: [], rowCount: 1 };
        },
      },
    ],
    [
      userIdentityPath,
      {
        fetchUserById: async () => ({ documento: '10001' }),
      },
    ],
    [
      facultyScopePath,
      {
        resolveCoordinatorScope:
          resolveScopeImpl || (async () => ({ coordinatorDocument: '9001', facultyIds: [7] })),
      },
    ],
    [
      authPath,
      {
        requireRoles: () => (req, res, next) => next(),
      },
    ],
    [
      multaConfigPath,
      {
        resolveMultaConfigForMultaId: async () => ({ permite_saldar_multas_directas: false }),
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

test('quitar-multa exports an Express router with handlers', () => {
  delete require.cache[routePath];
  const router = require(routePath);

  assert.equal(typeof router, 'function');
  assert.equal(typeof router.use, 'function');
  assert.equal(Array.isArray(router.stack), true);
  assert.equal(router.stack.length > 0, true);
});

test('quitar-multa rejects invalid sanction id', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/').type('form').send({ con_id: 'abc' });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.match(response.body.locals.message, /Sanción inválida/i);
  } finally {
    loaded.restore();
  }
});

test('quitar-multa coordinator fails when faculty scope is missing', async () => {
  const loaded = loadRoute({
    resolveScopeImpl: async () => ({ coordinatorDocument: null, facultyIds: [] }),
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'coordinador', documento: 'coord-user' });
    const response = await request(app).post('/').type('form').send({ con_id: '9' });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.match(response.body.locals.message2, /no tiene facultades asociadas/i);
  } finally {
    loaded.restore();
  }
});

test('quitar-multa laboratorista fails when not assigned to multa UAL', async () => {
  const loaded = loadRoute({
    queryImpl: async (sql) => {
      if (sql.includes('SELECT m.usuario_sancionado_id')) {
        return {
          rows: [
            {
              usuario_sancionado_id: 88,
              con_estado_multa: 'ACTIVA',
              ual_id: 22,
              facultad_id: 7,
            },
          ],
        };
      }

      if (sql.includes('SELECT documento FROM laboratorista')) {
        return { rows: [{ documento: 'lab-1' }] };
      }

      if (sql.includes('FROM laboratorista_ual')) {
        return { rows: [] };
      }

      return { rows: [], rowCount: 1 };
    },
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'laboratorista', documento: 'lab-user' });
    const response = await request(app).post('/').type('form').send({ con_id: '9' });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.match(response.body.locals.message2, /UAL asignada al laboratorista/i);
  } finally {
    loaded.restore();
  }
});

test('quitar-multa coordinator succeeds with valid faculty scope', async () => {
  const loaded = loadRoute({
    queryImpl: async (sql) => {
      if (sql.includes('SELECT m.usuario_sancionado_id')) {
        return {
          rows: [
            {
              usuario_sancionado_id: 88,
              con_estado_multa: 'ACTIVA',
              ual_id: 10,
              facultad_id: 7,
            },
          ],
        };
      }

      if (sql.includes('UPDATE multa SET con_estado_multa')) {
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 1 };
    },
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'coordinador', documento: 'coord-user' });
    const response = await request(app).post('/').type('form').send({ con_id: '9' });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_success');
    assert.match(response.body.locals.message, /Multa actualizada correctamente|Multa saldada directamente/i);
  } finally {
    loaded.restore();
  }
});
