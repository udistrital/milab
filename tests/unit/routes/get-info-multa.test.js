const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/get-info-multa.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const oatiClientPath = path.resolve(__dirname, '../../../src/libs/oati-client.js');
const userIdentityPath = path.resolve(__dirname, '../../../src/libs/user-identity.js');
const authPath = path.resolve(__dirname, '../../../src/routes/middlewares/auth.js');

function buildApp(route) {
  const app = express();

  app.use((req, res, next) => {
    req.session = {
      user: {
        tipo: 'laboratorista',
        documento: '1024467835',
      },
    };
    res.render = (view, locals) => res.status(res.statusCode || 200).json({ view, locals });
    next();
  });

  app.use('/', route);
  return app;
}

function loadRoute({
  requestOatiImpl = async (servicePath) => {
    if (servicePath.includes('datos_basicos_activos_cedula')) {
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
} = {}) {
  const originals = new Map();
  const stubs = [
    [
      dbPath,
      {
        query: async (sql) => {
          if (sql.includes('SELECT COUNT(*) AS multado FROM multa')) {
            return { rows: [{ multado: '0' }] };
          }

          if (sql.includes('SELECT * FROM laboratorista WHERE documento = $1 OR n_usuario = $1')) {
            return { rows: [{ nombre: 'Lab Prueba', documento: '1024467835', facultad_id: 5 }] };
          }

          if (
            sql.includes('FROM laboratorista_ual lu') &&
            sql.includes('INNER JOIN ual u') &&
            sql.includes('lu.laboratorista_documento_id = $1')
          ) {
            return { rows: [{ ual_id: 21, nombre: 'Laboratorio 1' }] };
          }

          return { rows: [] };
        },
      },
    ],
    [
      oatiClientPath,
      {
        getAcademicServicePath: (value) => value,
        requestOati: requestOatiImpl,
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

test('get-info-multa exports an Express router with handlers', () => {
  const loaded = loadRoute();

  try {
    const router = loaded.route;

    assert.equal(typeof router, 'function');
    assert.equal(typeof router.use, 'function');
    assert.equal(Array.isArray(router.stack), true);
    assert.equal(router.stack.length > 0, true);
  } finally {
    loaded.restore();
  }
});

test('get-info-multa reuses searched document when OAS omits documento', async () => {
  const loaded = loadRoute({
    requestOatiImpl: async (servicePath) => {
      if (servicePath.includes('datos_basicos_activos_cedula')) {
        return {
          datosEstudianteCollection: {
            datosBasicosEstudiante: [
              {
                codigo: '2024100001',
                nombre: 'Estudiante Prueba',
                carrera: '1',
                estado: 'A',
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
  });

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/').type('form').send({
      tipo_busqueda: 'documento',
      valor_busqueda: '79520182',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/reg_multa');
    assert.equal(response.body.locals.con_documento, '79520182');
    assert.equal(response.body.locals.con_codigo, '2024100001');
  } finally {
    loaded.restore();
  }
});

test('get-info-multa loads only assigned laboratorista UALs', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/').type('form').send({
      tipo_busqueda: 'documento',
      valor_busqueda: '79520182',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/reg_multa');
    assert.deepEqual(response.body.locals.uals, [{ ual_id: 21, nombre: 'Laboratorio 1' }]);
  } finally {
    loaded.restore();
  }
});
