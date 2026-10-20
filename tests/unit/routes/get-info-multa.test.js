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
const oatiDebtsPath = path.resolve(__dirname, '../../../src/libs/oati-debts.js');

function buildApp(route, user = { tipo: 'laboratorista', documento: '1024467835' }) {
  const app = express();
  const session = { user };

  app.use((req, res, next) => {
    req.session = session;
    res.render = (view, locals) => res.status(res.statusCode || 200).json({ view, locals });
    next();
  });

  app.use('/', route);
  return app;
}

function loadRoute({
  activeSanctionTotal = '0',
  sgaService = { isConfigured: () => false, getActiveDebts: async () => [] },
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

          if (sql.includes('SELECT COUNT(*) AS total FROM multa WHERE usuario_sancionado_id')) {
            return { rows: [{ total: activeSanctionTotal }] };
          }

          if (
            sql.includes(
              'SELECT documento FROM laboratorista WHERE documento = $1 OR n_usuario = $1'
            )
          ) {
            return { rows: [{ documento: '1024467835' }] };
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
        requireJsonRoles: () => (req, res, next) => next(),
      },
    ],
    [
      oatiDebtsPath,
      {
        sgaDebtService: sgaService,
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
  let oatiRequestCount = 0;
  const loaded = loadRoute({
    requestOatiImpl: async (servicePath) => {
      oatiRequestCount += 1;
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
    assert.equal(response.body.view, 'home/sancion-person-actions');
    assert.equal(response.body.locals.person.documento, '79520182');
    assert.equal(response.body.locals.person.codigo, '2024100001');
    assert.equal(response.body.locals.activeSanctionCount, 0);
    assert.equal(typeof response.body.locals.lookupToken, 'string');
    assert.equal(oatiRequestCount, 3);
  } finally {
    loaded.restore();
  }
});

test('get-info-multa reuses the session lookup when the user chooses registration', async () => {
  let oatiRequestCount = 0;
  const loaded = loadRoute({
    requestOatiImpl: async (servicePath) => {
      oatiRequestCount += 1;
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
  });

  try {
    const app = buildApp(loaded.route);
    const searchResponse = await request(app).post('/').type('form').send({
      tipo_busqueda: 'documento',
      valor_busqueda: '79520182',
    });
    const actionResponse = await request(app).post('/').type('form').send({
      lookup_token: searchResponse.body.locals.lookupToken,
    });

    assert.equal(searchResponse.body.view, 'home/sancion-person-actions');
    assert.equal(actionResponse.status, 200);
    assert.equal(actionResponse.body.view, 'home/reg_multa');
    assert.equal(actionResponse.body.locals.con_documento, '79520182');
    assert.equal(actionResponse.body.locals.con_codigo, '2024100001');
    assert.equal(oatiRequestCount, 3);
  } finally {
    loaded.restore();
  }
});

test('get-info-multa loads only assigned laboratorista UALs after registration is selected', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route);
    const searchResponse = await request(app).post('/').type('form').send({
      tipo_busqueda: 'documento',
      valor_busqueda: '79520182',
    });
    const response = await request(app).post('/').type('form').send({
      lookup_token: searchResponse.body.locals.lookupToken,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/reg_multa');
    assert.deepEqual(
      (response.body.locals.uals || []).map(({ ual_id, nombre }) => ({ ual_id, nombre })),
      [{ ual_id: 21, nombre: 'Laboratorio 1' }]
    );
  } finally {
    loaded.restore();
  }
});

const oatiStudentResponse = async (servicePath) => {
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
};

test('get-info-multa /persona renders the student panel with active count and SGA debts', async () => {
  const sgaDebts = [
    { DEU_MATERIAL: 'Reposición de insumos', DEU_MULTA: '50000', DEU_ESTADO: 'PENDIENTE' },
  ];
  const loaded = loadRoute({
    activeSanctionTotal: '2',
    requestOatiImpl: oatiStudentResponse,
    sgaService: {
      isConfigured: () => true,
      getActiveDebts: async () => sgaDebts,
    },
  });

  try {
    const app = buildApp(loaded.route);
    const searchResponse = await request(app).post('/').type('form').send({
      tipo_busqueda: 'documento',
      valor_busqueda: '79520182',
    });
    const response = await request(app)
      .get('/persona')
      .query({ lookup_token: searchResponse.body.locals.lookupToken, success: 'saldada' });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/sancion-person-actions');
    assert.equal(response.body.locals.personType, 'estudiante');
    assert.equal(response.body.locals.activeSanctionCount, 2);
    assert.equal(response.body.locals.sga.configured, true);
    assert.equal(response.body.locals.sga.failed, false);
    assert.deepEqual(response.body.locals.sga.debts, sgaDebts);
    assert.equal(response.body.locals.successFeedback, 'saldada');
    assert.equal(response.body.locals.sanctionHistoryError, '');
  } finally {
    loaded.restore();
  }
});

test('get-info-multa /persona rejects an unknown lookup token', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route);
    const response = await request(app)
      .get('/persona')
      .query({ lookup_token: 'a'.repeat(64) });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/error-consulta');
  } finally {
    loaded.restore();
  }
});

test('get-info-multa keeps the student panel when SGA is unavailable', async () => {
  const loaded = loadRoute({
    requestOatiImpl: oatiStudentResponse,
    sgaService: {
      isConfigured: () => true,
      getActiveDebts: async () => {
        throw new Error('SGA caído');
      },
    },
  });

  try {
    const app = buildApp(loaded.route);
    const searchResponse = await request(app).post('/').type('form').send({
      tipo_busqueda: 'documento',
      valor_busqueda: '79520182',
    });
    const response = await request(app)
      .get('/persona')
      .query({ lookup_token: searchResponse.body.locals.lookupToken });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/sancion-person-actions');
    assert.equal(response.body.locals.sga.failed, true);
    assert.deepEqual(response.body.locals.sga.debts, []);
  } finally {
    loaded.restore();
  }
});

test('get-info-multa shows a history notice instead of failing when the user scope is empty', async () => {
  const loaded = loadRoute({ requestOatiImpl: oatiStudentResponse });

  try {
    const app = buildApp(loaded.route, { tipo: 'coordinador', documento: '1020304050' });
    const response = await request(app).post('/').type('form').send({
      tipo_busqueda: 'documento',
      valor_busqueda: '79520182',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/sancion-person-actions');
    assert.equal(
      response.body.locals.sanctionHistoryError,
      'El coordinador no tiene facultades asociadas.'
    );
    assert.deepEqual(response.body.locals.sanctionHistory, []);
  } finally {
    loaded.restore();
  }
});
