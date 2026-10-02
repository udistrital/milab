const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/verificar_estudiante.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const oatiClientPath = path.resolve(__dirname, '../../../src/libs/oati-client.js');
const oatiDebtsPath = path.resolve(__dirname, '../../../src/libs/oati-debts.js');
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

function loadRoute({ multaRows = [], sgaDebtsImpl, sgaServiceConfigured = true } = {}) {
  const originals = new Map();
  const stubs = [
    [
      dbPath,
      {
        query: async (sql) => ({ rows: sql.includes('FROM multa m') ? multaRows : [] }),
      },
    ],
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
      oatiDebtsPath,
      {
        sgaDebtService: {
          isConfigured: () => sgaServiceConfigured,
          getActiveDebts: async () => {
            if (sgaDebtsImpl) {
              const debts = await sgaDebtsImpl();
              return debts.filter((debt) => String(debt?.DEU_ESTADO || '').trim() === '2');
            }
            return [];
          },
        },
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

test('verificar_estudiante blocks paz y salvo and shows local then active SGA sanctions', async () => {
  const localFine = { id: 9, cat_multa: 'Daño de equipo' };
  const sgaFine = {
    DEU_EST_COD: '2024100001',
    DEU_DEUDOR_NOMBRE: 'Estudiante Prueba',
    DEU_ESTADO: '2',
    DEU_MATERIAL: 'Equipo pendiente',
  };
  const loaded = loadRoute({
    multaRows: [localFine],
    sgaDebtsImpl: async () => [sgaFine, { ...sgaFine, DEU_ESTADO: '3' }],
  });

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/').type('form').send({
      tipo_busqueda: 'codigo',
      valor_busqueda: '2024100001',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/alerta-multado');
    assert.deepEqual(response.body.locals.multaInfo, [localFine]);
    assert.deepEqual(response.body.locals.sgaMultaInfo, [sgaFine]);
  } finally {
    loaded.restore();
  }
});

test('verificar_estudiante does not issue paz y salvo when the SGA check fails', async () => {
  const loaded = loadRoute({
    sgaDebtsImpl: async () => {
      throw new Error('SGA unavailable');
    },
  });

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/').type('form').send({
      tipo_busqueda: 'codigo',
      valor_busqueda: '2024100001',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/verificar_estudiante');
    assert.match(response.body.locals.error, /no fue posible verificar las multas en SGA/i);
  } finally {
    loaded.restore();
  }
});

test('verificar_estudiante skips SGA and continues when the service is not configured', async () => {
  let sgaQueryCount = 0;
  const loaded = loadRoute({
    sgaServiceConfigured: false,
    sgaDebtsImpl: async () => {
      sgaQueryCount += 1;
      return [];
    },
  });

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/').type('form').send({
      tipo_busqueda: 'codigo',
      valor_busqueda: '2024100001',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/get-info2');
    assert.equal(sgaQueryCount, 0);
  } finally {
    loaded.restore();
  }
});
