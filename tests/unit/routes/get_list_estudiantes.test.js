const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const { SgaDebtService } = require('../../../src/libs/oati-debts');

const debtService = new SgaDebtService();

const routePath = path.resolve(__dirname, '../../../src/routes/api/get_list_estudiantes.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const authPath = path.resolve(__dirname, '../../../src/routes/middlewares/auth.js');
const oatiClientPath = path.resolve(__dirname, '../../../src/libs/oati-client.js');
const oatiDebtsPath = path.resolve(__dirname, '../../../src/libs/oati-debts.js');

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

function loadRoute({
  queryImpl,
  requestOatiImpl,
  sgaDebtsImpl,
  sgaServiceConfigured = false,
} = {}) {
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
    [
      oatiDebtsPath,
      {
        sgaDebtService: {
          isConfigured: () => sgaServiceConfigured,
          resolveStudentCode: async ({ codigo, documento, identificador }) => {
            const directCode = String(codigo || '').trim();
            if (directCode) return directCode;

            const lookupValue = documento || identificador;
            for (const servicePath of [
              `datos_basicos_estudiante/${lookupValue}`,
              `datos_basicos_activos_cedula/${lookupValue}`,
            ]) {
              try {
                const response = await (requestOatiImpl || (async () => ({})))(servicePath);
                const records = response?.datosEstudianteCollection?.datosBasicosEstudiante;
                const record = Array.isArray(records)
                  ? records.find((item) => item?.codigo)
                  : records;
                if (record?.codigo) return String(record.codigo);
              } catch {
                // Try the next academic lookup path.
              }
            }
            return null;
          },
          getActiveDebts: async (student) => {
            if (!sgaDebtsImpl) return [];
            const debts = await sgaDebtsImpl(student.codigo);
            return debts.filter((debt) => debtService.isBlockingDebt(debt));
          },
        },
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

test('get_list_estudiantes consulta_masiva appends active SGA fines after MILab fines', async () => {
  const localFine = {
    cat_multa: 'Daño de equipo',
    con_estado_multa: 'ACTIVA',
    ual: 'Laboratorio A',
  };
  let requestedCode;
  const loaded = loadRoute({
    sgaServiceConfigured: true,
    queryImpl: async () => ({
      rows: [
        {
          identificador: '2024100001',
          documento: '79520182',
          codigo: '2024100001',
          multas: [localFine],
        },
      ],
    }),
    sgaDebtsImpl: async (code) => {
      requestedCode = code;
      return [
        {
          DEU_EST_COD: '2024100001',
          DEU_ESTADO: '2',
          DEU_MATERIAL: 'Tablet pendiente',
          DEU_MULTA: '650100',
        },
        {
          DEU_EST_COD: '2024100001',
          DEU_ESTADO: '1',
          DEU_MATERIAL: 'Tubo de ensayo omsons 15x150mm',
          DEU_MULTA: '1',
        },
        { DEU_EST_COD: '2024100001', DEU_ESTADO: '3' },
      ];
    },
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'laboratorista', documento: '123' });
    const response = await request(app).post('/consulta_masiva').type('form').send({
      consulta_masiva: '2024100001',
    });

    const multas = response.body.locals.sampleData1[0].multas;
    assert.equal(response.status, 200);
    assert.equal(requestedCode, '2024100001');
    assert.deepEqual(
      multas.map((multa) => multa.origen),
      ['MILab', 'SGA', 'SGA']
    );
    assert.equal(multas[1].cat_multa, 'Tablet pendiente');
    assert.match(multas[1].obs_multa, /Valor SGA: 650100/);
    assert.equal(multas[2].cat_multa, 'Tubo de ensayo omsons 15x150mm');
    assert.equal(multas[2].con_estado_multa, 'ACTIVA (estado SGA 1)');
    assert.match(multas[2].obs_multa, /Valor SGA: 1/);
  } finally {
    loaded.restore();
  }
});

test('get_list_estudiantes consulta_masiva skips SGA and discloses that when unconfigured', async () => {
  let sgaCalls = 0;
  const loaded = loadRoute({
    sgaServiceConfigured: false,
    queryImpl: async () => ({
      rows: [
        {
          identificador: '2024100001',
          documento: '79520182',
          codigo: '2024100001',
          multas: [null],
        },
      ],
    }),
    requestOatiImpl: async () => ({
      datosEstudianteCollection: {
        datosBasicosEstudiante: [{ codigo: '2024100001', documento: '79520182' }],
      },
    }),
    sgaDebtsImpl: async () => {
      sgaCalls += 1;
      return [];
    },
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'laboratorista', documento: '123' });
    const response = await request(app).post('/consulta_masiva').type('form').send({
      consulta_masiva: '2024100001',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.locals.sampleData1[0].multas[0], null);
    assert.equal(response.body.locals.sgaConsultaOmitida, true);
    assert.equal(sgaCalls, 0);
  } finally {
    loaded.restore();
  }
});

test('get_list_estudiantes consulta_masiva marks SGA lookup failures as unverified', async () => {
  const loaded = loadRoute({
    sgaServiceConfigured: true,
    queryImpl: async () => ({
      rows: [
        {
          identificador: '2024100001',
          documento: '79520182',
          codigo: '2024100001',
          multas: [null],
        },
      ],
    }),
    requestOatiImpl: async () => ({
      datosEstudianteCollection: {
        datosBasicosEstudiante: [{ codigo: '2024100001', documento: '79520182' }],
      },
    }),
    sgaDebtsImpl: async () => {
      throw new Error('SGA unavailable');
    },
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'laboratorista', documento: '123' });
    const response = await request(app).post('/consulta_masiva').type('form').send({
      consulta_masiva: '2024100001',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.locals.sampleData1[0].multas[0], 'sga-error');
  } finally {
    loaded.restore();
  }
});

test('get_list_estudiantes buildPdfTableRows keeps SGA fines and failures in the PDF', () => {
  const loaded = loadRoute();

  try {
    const rows = loaded.route.buildPdfTableRows([
      {
        identificador: '2024100001',
        multas: [
          {
            origen: 'MILab',
            cat_multa: 'Daño',
            fecha_multa: '2026-01-01',
            obs_multa: 'x',
            ual: 'L1',
          },
          {
            origen: 'SGA',
            cat_multa: 'Tablet',
            fecha_multa: '2026-02-01',
            obs_multa: 'y',
            ual: 'SGA',
          },
          'sga-error',
        ],
      },
      { identificador: '2024100002', multas: [null] },
      { identificador: 'abc', multas: ['unknown'] },
    ]);

    assert.deepEqual(rows[0], ['2024100001', 'MILab', 'Daño', '2026-01-01', 'x', 'L1']);
    assert.deepEqual(rows[1], ['2024100001', 'SGA', 'Tablet', '2026-02-01', 'y', 'SGA']);
    assert.equal(rows[2][1], 'SGA');
    assert.equal(rows[2][2], 'No fue posible verificar el estado en SGA.');
    assert.notEqual(rows[2][4], 'El estudiante está a paz y salvo');
    assert.equal(rows[3][4], 'El estudiante está a paz y salvo');
    assert.match(rows[4][2], /Datos inválidos/);
    assert.notEqual(rows[4][4], 'El estudiante está a paz y salvo');
  } finally {
    loaded.restore();
  }
});

test('get_list_estudiantes generate_pdf renders a PDF including SGA markers', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, { tipo: 'laboratorista', documento: '123' });
    const data = JSON.stringify([
      { identificador: '2024100001', multas: ['sga-error'] },
      { identificador: '2024100002', multas: [null] },
    ]);
    const response = await request(app).get('/generate_pdf').query({ data });

    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /application\/pdf/);
  } finally {
    loaded.restore();
  }
});
