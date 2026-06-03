const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/get_list_estudiantes.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const authPath = path.resolve(__dirname, '../../../src/routes/middlewares/auth.js');
const oatiClientPath = path.resolve(__dirname, '../../../src/libs/oati-client.js');

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

function loadRoute({ queryImpl, requestOatiImpl } = {}) {
  const originals = new Map();

  const stubs = [
    [
      dbPath,
      {
        query: async (sql, params = []) => {
          if (typeof queryImpl === 'function') {
            return queryImpl(sql, params);
          }

          return { rows: [] };
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
      oatiClientPath,
      {
        getAcademicServicePath: (v) => v,
        requestOati:
          requestOatiImpl ||
          (async () => ({
            datosEstudianteCollection: { datosBasicosEstudiante: [] },
          })),
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

test('get_list_estudiantes uses selectedType fallback to todos for invalid tipo', async () => {
  const loaded = loadRoute({
    queryImpl: async () => ({ rows: [{ id: 1, tipo_registro: 'estudiante' }] }),
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', documento: '1024467835' });
    const response = await request(app).get('/?tipo=no-valido');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/get_list_estudiantes');
    assert.equal(response.body.locals.selectedType, 'todos');
    assert.equal(response.body.locals.sampleData1.length, 1);
  } finally {
    loaded.restore();
  }
});

test('get_list_estudiantes consulta_masiva rejects more than 20 identifiers', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, { tipo: 'coordinador', documento: '900' });
    const values = Array.from({ length: 21 }, (_, i) => `${1000 + i}`).join(',');
    const response = await request(app).post('/consulta_masiva').type('form').send({
      consulta_masiva: values,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/consulta_masiva');
    assert.match(response.body.locals.error, /límite de 20 estudiantes/i);
  } finally {
    loaded.restore();
  }
});

test('get_list_estudiantes consulta_masiva marks unknown when no fines and no OATI record', async () => {
  const loaded = loadRoute({
    queryImpl: async () => ({
      rows: [{ identificador: '1020', documento: null, codigo: null, multas: [null] }],
    }),
    requestOatiImpl: async () => {
      throw new Error('oati offline');
    },
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'laboratorista', documento: '123' });
    const response = await request(app).post('/consulta_masiva').type('form').send({
      consulta_masiva: '1020',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/consulta_masiva');
    assert.equal(response.body.locals.sampleData1[0].multas[0], 'unknown');
  } finally {
    loaded.restore();
  }
});
