const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/verificar_estudiante.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const oatiClientPath = path.resolve(__dirname, '../../../src/libs/oati-client.js');
const userIdentityPath = path.resolve(__dirname, '../../../src/libs/user-identity.js');
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
  const stubs = [
    [dbPath, { query: async () => ({ rows: [] }) }],
    [
      oatiClientPath,
      {
        getAcademicServicePath: (value) => value,
        requestOati: async () => ({
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
        }),
      },
    ],
    [
      userIdentityPath,
      {
        ensurePerfilEstudiante: async () => 99,
        resolveUsuarioIdForStudent: async () => 99,
      },
    ],
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

test('verificar_estudiante parses form submissions and reaches the success flow', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/').type('form').send({
      tipo_busqueda: 'documento',
      valor_busqueda: '79520182',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/get-info2');
    assert.equal(response.body.locals.documento, '79520182');
    assert.equal(response.body.locals.nombre, 'Estudiante Prueba');
  } finally {
    loaded.restore();
  }
});
