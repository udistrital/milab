const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/get-info-multa-docente.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const oatiClientPath = path.resolve(__dirname, '../../../src/libs/oati-client.js');
const userIdentityPath = path.resolve(__dirname, '../../../src/libs/user-identity.js');
const authPath = path.resolve(__dirname, '../../../src/routes/middlewares/auth.js');
const multaConfigPath = path.resolve(__dirname, '../../../src/libs/multa-config.js');
const sanctionCategoriesPath = path.resolve(__dirname, '../../../src/libs/sanction-categories.js');

function loadRoute() {
  const originals = new Map();
  let oatiRequestCount = 0;
  let identityCallCount = 0;
  const stubs = [
    [
      dbPath,
      {
        query: async (sql) => {
          if (sql.includes('SELECT COUNT(*) AS total FROM multa')) {
            return { rows: [{ total: '0' }] };
          }
          if (sql.includes('SELECT COUNT(*) AS multado FROM multa')) {
            return { rows: [{ multado: '0' }] };
          }
          if (sql.includes('SELECT * FROM laboratorista WHERE documento = $1 OR n_usuario = $1')) {
            return { rows: [{ nombre: 'Lab Prueba', documento: '1024467835', facultad_id: 5 }] };
          }
          return { rows: [] };
        },
      },
    ],
    [
      oatiClientPath,
      {
        getAcademicServicePath: (value) => value,
        requestOati: async () => {
          oatiRequestCount += 1;
          return {
            docentesCollection: {
              docente: [{ estado_docente: 'ACTIVO', nombre: 'Docente Prueba' }],
            },
          };
        },
      },
    ],
    [
      userIdentityPath,
      {
        ensurePerfilDocente: async () => {
          identityCallCount += 1;
          return 99;
        },
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
        SANCTION_TYPES: {},
        fetchMultaConfigsForFacultyIds: async () => new Map(),
      },
    ],
    [
      sanctionCategoriesPath,
      {
        fetchSanctionCategories: async () => [],
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
    get oatiRequestCount() {
      return oatiRequestCount;
    },
    get identityCallCount() {
      return identityCallCount;
    },
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

function buildApp(route, session) {
  const app = express();
  app.use((req, res, next) => {
    req.session = session;
    res.render = (view, locals) => res.status(res.statusCode || 200).json({ view, locals });
    next();
  });
  app.use('/', route);
  return app;
}

test('get-info-multa-docente exports an Express router with handlers', () => {
  const modulePath = path.resolve(__dirname, '../../../src/routes/api/get-info-multa-docente.js');
  delete require.cache[modulePath];
  const router = require(modulePath);

  assert.equal(typeof router, 'function');
  assert.equal(typeof router.use, 'function');
  assert.equal(Array.isArray(router.stack), true);
  assert.equal(router.stack.length > 0, true);
});

test('get-info-multa-docente reuses the person lookup after the user chooses registration', async () => {
  const loaded = loadRoute();

  try {
    const session = {
      user: {
        tipo: 'laboratorista',
        documento: '1024467835',
      },
    };
    const app = buildApp(loaded.route, session);
    const searchResponse = await request(app).post('/').type('form').send({
      numero_documento_identificacion: '79520182',
    });
    const actionResponse = await request(app).post('/').type('form').send({
      lookup_token: searchResponse.body.locals.lookupToken,
    });

    assert.equal(searchResponse.status, 200);
    assert.equal(searchResponse.body.view, 'home/sancion-person-actions');
    assert.equal(searchResponse.body.locals.person.documento, '79520182');
    assert.equal(actionResponse.status, 200);
    assert.equal(actionResponse.body.view, 'home/reg_multa_docente');
    assert.equal(actionResponse.body.locals.con_documento, '79520182');
    assert.equal(loaded.oatiRequestCount, 1);
    assert.equal(loaded.identityCallCount, 1);
  } finally {
    loaded.restore();
  }
});
