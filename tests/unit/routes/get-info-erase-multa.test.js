const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/get-info-erase-multa.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const oatiClientPath = path.resolve(__dirname, '../../../src/libs/oati-client.js');
const userIdentityPath = path.resolve(__dirname, '../../../src/libs/user-identity.js');
const authPath = path.resolve(__dirname, '../../../src/routes/middlewares/auth.js');
const multaConfigPath = path.resolve(__dirname, '../../../src/libs/multa-config.js');

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

function loadRoute({ queryImpl } = {}) {
  const originals = new Map();
  const stubs = [
    [
      dbPath,
      {
        query: async (sql, params) => {
          if (typeof queryImpl === 'function') {
            return queryImpl(sql, params);
          }
          return { rows: [] };
        },
      },
    ],
    [
      oatiClientPath,
      {
        getAcademicServicePath: (value) => value,
        requestOati: async (servicePath) => {
          if (servicePath.includes('datos_basicos')) {
            return {
              datosEstudianteCollection: {
                datosBasicosEstudiante: [
                  {
                    codigo: '2024100001',
                    nombre: 'Estudiante Prueba',
                    carrera: '1',
                    estado: 'A',
                    documento: '79520182',
                  },
                ],
              },
            };
          }
          if (servicePath.includes('estados_codigo')) {
            return { estado: { nombre: 'ACTIVO' } };
          }
          if (servicePath.includes('carrera')) {
            return { carrerasCollection: { carrera: [{ nombre: 'Ingenieria' }] } };
          }
          return {};
        },
      },
    ],
    [
      userIdentityPath,
      {
        ensurePerfilEstudiante: async () => 99,
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

test('get-info-erase-multa exports an Express router with handlers', () => {
  const modulePath = path.resolve(__dirname, '../../../src/routes/api/get-info-erase-multa.js');
  delete require.cache[modulePath];
  const router = require(modulePath);

  assert.equal(typeof router, 'function');
  assert.equal(typeof router.use, 'function');
  assert.equal(Array.isArray(router.stack), true);
  assert.equal(router.stack.length > 0, true);
});

test('get-info-erase-multa exposes assigned UAL ids for laboratorista to allow removing any lab sanction', async () => {
  const loaded = loadRoute({
    queryImpl: async (sql) => {
      if (sql.includes('SELECT COUNT(*) AS multado FROM multa')) {
        return { rows: [{ multado: '1' }] };
      }
      if (sql.includes('SELECT m.*')) {
        return {
          rows: [
            {
              id: 1,
              ual_id: 21,
              laboratorista_documento_id: 'otro-laboratorista',
              con_estado_multa: 'ACTIVA',
            },
          ],
        };
      }
      if (sql.includes('FROM laboratorista WHERE documento = $1 OR n_usuario = $1')) {
        return { rows: [{ documento: '1024467835' }] };
      }
      if (sql.includes('FROM laboratorista_ual WHERE laboratorista_documento_id = $1')) {
        return { rows: [{ ual_id: 21 }, { ual_id: 22 }] };
      }
      return { rows: [] };
    },
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'laboratorista', documento: '1024467835' });
    const response = await request(app).post('/').type('form').send({
      tipo_busqueda: 'codigo',
      valor_busqueda: '2024100001',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/reg_multa_erase');
    assert.deepEqual(response.body.locals.laboratoristaUalIds, [21, 22]);
  } finally {
    loaded.restore();
  }
});
