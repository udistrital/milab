const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/get_list_multas.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const facultyScopePath = path.resolve(__dirname, '../../../src/libs/faculty-scope.js');
const authPath = path.resolve(__dirname, '../../../src/routes/middlewares/auth.js');
const oatiNamePath = path.resolve(__dirname, '../../../src/libs/oati-name.js');
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
  resolveScopeImpl,
  clientQueryImpl,
  resolveOatiNameImpl,
  sgaDebtServiceImpl,
} = {}) {
  const originals = new Map();
  const client = {
    release() {},
    async query(sql, params = []) {
      if (sql.includes('SELECT id, nombre, descripcion, activo')) {
        return { rows: [{ id: 1, nombre: 'Equipos', descripcion: 'Uso indebido', activo: true }] };
      }
      if (typeof clientQueryImpl === 'function') {
        return clientQueryImpl(sql, params);
      }

      return {
        rows: [
          { id: 1, tipo_sancionado: 'estudiante', con_estado_multa: 'Pendiente' },
          { id: 2, tipo_sancionado: 'docente', con_estado_multa: 'POR SALDAR' },
        ],
      };
    },
  };

  const stubs = [
    [
      dbPath,
      {
        async connect() {
          return client;
        },
      },
    ],
    [
      facultyScopePath,
      {
        resolveCoordinatorScope:
          resolveScopeImpl || (async () => ({ coordinatorDocument: '900', facultyIds: [10] })),
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
      oatiNamePath,
      {
        resolveOatiName: resolveOatiNameImpl || (async () => 'Nombre OATI'),
      },
    ],
    [
      oatiDebtsPath,
      {
        sgaDebtService: sgaDebtServiceImpl || {
          isConfigured: () => false,
          async getActiveDebts() {
            return [];
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

test('sanction detail history includes the claim and final response within existing scope', async () => {
  const calls = [];
  const loaded = loadRoute({
    clientQueryImpl: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('FROM reclamacion_sancion r'))
        return {
          rows: [
            {
              id: 5,
              texto: 'Solicito revisión',
              respuesta: 'No procede',
              decision: 'NO_PROCEDE',
              fecha_creacion: '2026-10-08',
              fecha_respuesta: '2026-10-09',
              respondido_por: 'Responsable',
            },
          ],
        };
      return { rows: [{ id: 9, tipo_sancionado: 'estudiante' }] };
    },
  });
  try {
    const response = await request(
      buildApp(loaded.route, { tipo: 'coordinador', documento: '900' })
    ).get('/9/reclamaciones');
    assert.equal(response.status, 200);
    assert.equal(response.body.history[0].respuesta, 'No procede');
    assert.match(calls[0].sql, /u.facultad_id = ANY/);
    assert.deepEqual(calls[0].params, [[10], 9]);
    assert.deepEqual(calls[1].params, [9]);
  } finally {
    loaded.restore();
  }
});

test('sanction history rejects out-of-scope sanctions and distinguishes database failure from no claims', async () => {
  for (const broken of [false, true]) {
    const loaded = loadRoute({
      clientQueryImpl: async () => {
        if (broken) throw new Error('DB unavailable');
        return { rows: [] };
      },
    });
    try {
      const response = await request(
        buildApp(loaded.route, { tipo: 'admin', documento: '999' })
      ).get('/9/reclamaciones');
      assert.equal(response.status, broken ? 500 : 404);
      assert.equal(response.body.ok, false);
      assert.equal(response.body.history, undefined);
    } finally {
      loaded.restore();
    }
  }
});

test('sanction edit preserves its original historical category but rejects inactive replacements', async () => {
  for (const [categoria, active, allowed] of [
    ['Histórica inactiva', false, true],
    ['Otra inactiva', false, false],
    ['Nueva activa', true, true],
  ]) {
    const calls = [];
    const loaded = loadRoute({
      clientQueryImpl: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('SELECT m.con_estado_multa')) {
          return {
            rows: [
              {
                con_estado_multa: 'ACTIVA',
                cat_multa: 'Histórica inactiva',
                ual_id: 21,
                facultad_id: 10,
              },
            ],
          };
        }
        if (sql.includes('FROM categoria_sancion')) return { rows: active ? [{ id: 1 }] : [] };
        return { rows: [] };
      },
    });
    try {
      const response = await request(buildApp(loaded.route, { tipo: 'admin', documento: '123' }))
        .post('/editar')
        .type('form')
        .send({
          multa_id: '9',
          cat_multa: categoria,
          tipo_sancion: 'Amonestación verbal o escrita',
        });
      if (allowed) {
        assert.equal(response.status, 302);
        assert.equal(response.headers.location, '/milab/api/get_list_multas?success=editada');
        const update = calls.find((call) => call.sql.includes('UPDATE multa'));
        assert.equal(update.params[0], categoria);
      } else {
        assert.equal(response.body.view, 'home/message_error');
        assert.ok(!calls.some((call) => call.sql.includes('UPDATE multa')));
      }
    } finally {
      loaded.restore();
    }
  }
});

test('get_list_multas returns grouped sanctions for non-coordinator roles', async () => {
  let sgaCalls = 0;
  const loaded = loadRoute({
    sgaDebtServiceImpl: {
      isConfigured: () => true,
      async getActiveDebts() {
        sgaCalls += 1;
        return [];
      },
    },
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', documento: '1024467835' });
    const response = await request(app).get('/');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/get_list_multas');
    assert.equal(response.body.locals.sampleData.length, 2);
    assert.equal(response.body.locals.sancionesEstudiantes.length, 1);
    assert.equal(response.body.locals.sancionesDocentes.length, 1);
    assert.equal(sgaCalls, 0);
  } finally {
    loaded.restore();
  }
});

test('get_list_multas applies coordinator faculty scope in query', async () => {
  let capturedSql = '';
  let capturedParams = [];

  const loaded = loadRoute({
    resolveScopeImpl: async () => ({ coordinatorDocument: '900', facultyIds: [10, 12] }),
    clientQueryImpl: async (sql, params) => {
      capturedSql = sql;
      capturedParams = params;
      return {
        rows: [{ id: 1, tipo_sancionado: 'estudiante', con_estado_multa: 'ACTIVA' }],
      };
    },
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'coordinador', documento: 'coord-user' });
    const response = await request(app).get('/');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/get_list_multas');
    assert.match(capturedSql, /u\.facultad_id = ANY\(\$1::int\[\]\)/);
    assert.deepEqual(capturedParams[0], [10, 12]);
  } finally {
    loaded.restore();
  }
});

test('get_list_multas applies laboratorista UAL assignment scope in query', async () => {
  let capturedSql = '';
  let capturedParams = [];

  const loaded = loadRoute({
    clientQueryImpl: async (sql, params) => {
      if (sql.includes('SELECT documento FROM laboratorista')) {
        return { rows: [{ documento: '12345' }] };
      }

      capturedSql = sql;
      capturedParams = params;
      return {
        rows: [{ id: 1, tipo_sancionado: 'estudiante', con_estado_multa: 'ACTIVA' }],
      };
    },
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'laboratorista', documento: 'lab-user' });
    const response = await request(app).get('/');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/get_list_multas');
    assert.match(capturedSql, /FROM laboratorista_ual lu/);
    assert.equal(capturedParams[0], '12345');
  } finally {
    loaded.restore();
  }
});

test('get_list_multas exposes state-specific actions for authorized laboratoristas', async () => {
  const loaded = loadRoute({
    clientQueryImpl: async (sql, params) => {
      if (sql.includes('SELECT documento FROM laboratorista')) {
        return { rows: [{ documento: '12345' }] };
      }

      if (sql.includes('config_facultad_multas')) {
        assert.deepEqual(params[0], [5]);
        return {
          rows: [
            {
              facultad_id: 5,
              permite_crear_multas_activas_directas: true,
              permite_saldar_multas_directas: true,
            },
          ],
        };
      }

      return {
        rows: [
          { id: 1, tipo_sancionado: 'estudiante', con_estado_multa: 'Pendiente', facultad_id: 5 },
          { id: 2, tipo_sancionado: 'estudiante', con_estado_multa: 'POR SALDAR', facultad_id: 5 },
          { id: 3, tipo_sancionado: 'estudiante', con_estado_multa: 'ACTIVA', facultad_id: 5 },
          { id: 4, tipo_sancionado: 'estudiante', con_estado_multa: 'APLAZADA', facultad_id: 5 },
          { id: 5, tipo_sancionado: 'estudiante', con_estado_multa: 'SALDADA', facultad_id: 5 },
        ],
      };
    },
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'laboratorista', documento: 'lab-user' });
    const response = await request(app).get('/');
    const rows = response.body.locals.sancionesEstudiantes;

    assert.equal(response.status, 200);
    assert.equal(rows[0].canActivate, true);
    assert.equal(rows[0].canSaldar, false);
    assert.equal(rows[1].canActivate, false);
    assert.equal(rows[1].canSaldar, true);
    assert.equal(rows[2].canAplazar, true);
    assert.equal(rows[2].canRemove, true);
    assert.equal(rows[3].canReactivar, true);
    assert.equal(rows[3].canActivate, false);
    assert.equal(rows[3].canSaldar, false);
    assert.equal(rows[3].canRemove, false);
    assert.equal(rows[4].canActivate, false);
    assert.equal(rows[4].canSaldar, false);
    assert.equal(rows[4].canRemove, false);
  } finally {
    loaded.restore();
  }
});

test('get_list_multas denies coordinador without faculty scope', async () => {
  const loaded = loadRoute({
    resolveScopeImpl: async () => ({ coordinatorDocument: '900', facultyIds: [] }),
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'coordinador', documento: 'coord-user' });
    const response = await request(app).get('/');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.match(response.body.locals.message2, /no tiene facultades asociadas/i);
  } finally {
    loaded.restore();
  }
});

test('get_list_multas applies date range filters in query', async () => {
  let capturedSql = '';
  let capturedParams = [];

  const loaded = loadRoute({
    clientQueryImpl: async (sql, params) => {
      capturedSql = sql;
      capturedParams = params;
      return {
        rows: [{ id: 1, tipo_sancionado: 'estudiante', con_estado_multa: 'ACTIVA' }],
      };
    },
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', documento: '1024467835' });
    const response = await request(app).get('/?fecha_desde=2026-01-01&fecha_hasta=2026-01-31');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/get_list_multas');
    assert.match(capturedSql, /m\.fecha_multa >= \$1::date/);
    assert.match(capturedSql, /m\.fecha_multa <= \$2::date/);
    assert.deepEqual(capturedParams, ['2026-01-01', '2026-01-31']);
  } finally {
    loaded.restore();
  }
});

test('get_list_multas applies estado filter in query', async () => {
  let capturedSql = '';
  let capturedParams = [];

  const loaded = loadRoute({
    clientQueryImpl: async (sql, params) => {
      capturedSql = sql;
      capturedParams = params;
      return {
        rows: [{ id: 1, tipo_sancionado: 'estudiante', con_estado_multa: 'ACTIVA' }],
      };
    },
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', documento: '1024467835' });
    const response = await request(app).get('/?estado_multa=ACTIVA');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/get_list_multas');
    assert.match(capturedSql, /m\.con_estado_multa = \$1/);
    assert.deepEqual(capturedParams, ['ACTIVA']);
  } finally {
    loaded.restore();
  }
});

test('get_list_multas rejects invalid date range', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', documento: '1024467835' });
    const response = await request(app).get('/?fecha_desde=2026-02-01&fecha_hasta=2026-01-01');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.match(response.body.locals.message, /Rango de fechas inválido/i);
  } finally {
    loaded.restore();
  }
});

test('get_list_multas rejects invalid estado filter', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', documento: '1024467835' });
    const response = await request(app).get('/?estado_multa=INEXISTENTE');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.match(response.body.locals.message, /Filtro de estado inválido/i);
  } finally {
    loaded.restore();
  }
});

test('get_list_multas resolve_name returns false when documento is missing', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', documento: '1' });
    const response = await request(app).get('/resolve_name');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { ok: false, nombre: '' });
  } finally {
    loaded.restore();
  }
});

test('get_list_multas queries SGA debts for a student only when detail is requested', async () => {
  let serviceArguments;
  const activeDebt = { DEU_EST_COD: '2024100001', DEU_ESTADO: '2', DEU_MATERIAL: 'Tablet' };
  const loaded = loadRoute({
    clientQueryImpl: async (sql, params) => {
      assert.match(sql, /m\.id = \$1/);
      assert.deepEqual(params, [55]);
      return {
        rows: [
          {
            id: 55,
            tipo_sancionado: 'estudiante',
            codigo_sancionado: '2024100001',
            documento_sancionado: '79520182',
          },
        ],
      };
    },
    sgaDebtServiceImpl: {
      isConfigured: () => true,
      async getActiveDebts(args) {
        serviceArguments = args;
        return [activeDebt];
      },
    },
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', documento: '1024467835' });
    const response = await request(app).get('/55/sga-multas');

    assert.equal(response.status, 200);
    assert.deepEqual(serviceArguments, {
      codigo: '2024100001',
      documento: '79520182',
    });
    assert.deepEqual(response.body, {
      ok: true,
      configured: true,
      supported: true,
      multas: [activeDebt],
    });
  } finally {
    loaded.restore();
  }
});

test('get_list_multas SGA detail applies coordinator faculty scope', async () => {
  let capturedSql = '';
  let capturedParams = [];
  const loaded = loadRoute({
    resolveScopeImpl: async () => ({ coordinatorDocument: '900', facultyIds: [10, 12] }),
    clientQueryImpl: async (sql, params) => {
      capturedSql = sql;
      capturedParams = params;
      return {
        rows: [
          {
            id: 55,
            tipo_sancionado: 'estudiante',
            codigo_sancionado: '2024100001',
            documento_sancionado: '79520182',
          },
        ],
      };
    },
    sgaDebtServiceImpl: {
      isConfigured: () => true,
      async getActiveDebts() {
        return [];
      },
    },
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'coordinador', documento: 'coord-user' });
    const response = await request(app).get('/55/sga-multas');

    assert.equal(response.status, 200);
    assert.match(capturedSql, /u\.facultad_id = ANY\(\$1::int\[\]\)/);
    assert.match(capturedSql, /m\.id = \$2/);
    assert.deepEqual(capturedParams, [[10, 12], 55]);
    assert.equal(response.body.configured, true);
  } finally {
    loaded.restore();
  }
});

test('get_list_multas SGA detail does not query docentes', async () => {
  let sgaCalls = 0;
  const loaded = loadRoute({
    clientQueryImpl: async () => ({
      rows: [
        {
          id: 55,
          tipo_sancionado: 'docente',
          codigo_sancionado: '',
          documento_sancionado: '79520182',
        },
      ],
    }),
    sgaDebtServiceImpl: {
      isConfigured: () => true,
      async getActiveDebts() {
        sgaCalls += 1;
        return [];
      },
    },
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', documento: '1024467835' });
    const response = await request(app).get('/55/sga-multas');

    assert.equal(response.status, 200);
    assert.equal(response.body.supported, false);
    assert.equal(sgaCalls, 0);
  } finally {
    loaded.restore();
  }
});

test('get_list_multas export excel returns xlsx attachment', async () => {
  let capturedSql = '';
  let capturedParams = [];

  const loaded = loadRoute({
    clientQueryImpl: async (sql, params) => {
      capturedSql = sql;
      capturedParams = params;
      return {
        rows: [
          {
            id: 11,
            cat_multa: 'Leve',
            nombre_laboratorista: 'Lab Prueba',
            cc_laboratorista: '1010',
            documento_sancionado: '1000',
            codigo_sancionado: '2026',
            tipo_sancionado: 'estudiante',
            ual: 'UAL Central',
            fecha_multa_formateada: '2026-09-01',
            con_estado_multa: 'ACTIVA',
            obs_multa: 'Observacion',
            tipo_sancion: 'Suspension',
          },
        ],
      };
    },
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', documento: '1024467835' });
    const response = await request(app)
      .get('/export/excel?fecha_desde=2026-09-01&estado_multa=ACTIVA')
      .buffer(true)
      .parse((res, callback) => {
        const data = [];
        res.on('data', (chunk) => data.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(data)));
      });

    assert.equal(response.status, 200);
    assert.match(
      response.headers['content-type'],
      /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/
    );
    assert.match(response.headers['content-disposition'], /attachment; filename="multas_/);
    assert.match(capturedSql, /m\.fecha_multa >= \$1::date/);
    assert.match(capturedSql, /m\.con_estado_multa = \$2/);
    assert.deepEqual(capturedParams, ['2026-09-01', 'ACTIVA']);
    assert.equal(Buffer.isBuffer(response.body), true);
    assert.equal(response.body.length > 0, true);
  } finally {
    loaded.restore();
  }
});

test('get_list_multas export excel rejects invalid date filter', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', documento: '1024467835' });
    const response = await request(app).get('/export/excel?fecha_desde=01-09-2026');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.match(response.body.locals.message, /Filtro de fecha inválido/i);
  } finally {
    loaded.restore();
  }
});

const LOCATION_ROWS = [
  {
    ual_id: 7,
    ual_nombre: 'Lab Procesos',
    unidad_id: 20,
    unidad_nombre: 'Lab Producción',
    padre_id: 2,
    facultad_raiz_id: 2,
    facultad_raiz_nombre: 'FACULTAD TECNOLÓGICA',
  },
  {
    ual_id: 8,
    ual_nombre: 'Lab Legado',
    unidad_id: 3,
    unidad_nombre: 'FACULTAD DE INGENIERÍA',
    padre_id: null,
    facultad_raiz_id: 3,
    facultad_raiz_nombre: 'FACULTAD DE INGENIERÍA',
  },
];

function locationAwareQuery(captured, extra) {
  return async (sql, params) => {
    if (sql.includes('LEFT JOIN dependencia_facultad p')) {
      captured.optionsSql = sql;
      captured.optionsParams = params;
      return { rows: LOCATION_ROWS };
    }
    if (extra) {
      const handled = await extra(sql, params);
      if (handled) return handled;
    }
    captured.sql = sql;
    captured.params = params;
    return { rows: [{ id: 1, tipo_sancionado: 'estudiante', con_estado_multa: 'ACTIVA' }] };
  };
}

test('get_list_multas admin can filter by facultad, dependencia and UAL', async () => {
  const captured = {};
  const loaded = loadRoute({ clientQueryImpl: locationAwareQuery(captured) });

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', documento: '1' });
    const response = await request(app).get('/?facultad_id=2&dependencia_id=20&ual_id=7');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/get_list_multas');
    assert.match(captured.sql, /padre_id = \$1::int/);
    assert.match(captured.sql, /u\.facultad_id = \$2::int/);
    assert.match(captured.sql, /m\.ual_id = \$3::int/);
    assert.deepEqual(captured.params, [2, 20, 7]);
    assert.doesNotMatch(captured.optionsSql, /WHERE/);
    const { locationOptions, filterAccess, filtros } = response.body.locals;
    assert.deepEqual(filterAccess, { facultad: true, dependencia: true, ual: true });
    assert.deepEqual(
      locationOptions.facultades.map((f) => f.id),
      [2, 3]
    );
    assert.deepEqual(locationOptions.dependencias, [
      { id: 20, nombre: 'Lab Producción', facultad_id: 2 },
    ]);
    assert.equal(locationOptions.uals[1].dependencia_id, null);
    assert.equal(filtros.ual_id, 7);
  } finally {
    loaded.restore();
  }
});

test('get_list_multas coordinador general sees all locations in read-only mode', async () => {
  const captured = {};
  const loaded = loadRoute({ clientQueryImpl: locationAwareQuery(captured) });

  try {
    const app = buildApp(loaded.route, { tipo: 'coordinador_general', documento: '1' });
    const response = await request(app).get('/?facultad_id=3');

    assert.equal(response.status, 200);
    assert.equal(response.body.locals.filterAccess.facultad, true);
    assert.deepEqual(captured.params, [3]);
    assert.equal(response.body.locals.sancionesEstudiantes[0].canEdit, false);
  } finally {
    loaded.restore();
  }
});

test('get_list_multas coordinador filters dependencias within scope but not facultad', async () => {
  const captured = {};
  const loaded = loadRoute({
    resolveScopeImpl: async () => ({ coordinatorDocument: '900', facultyIds: [2, 20] }),
    clientQueryImpl: locationAwareQuery(captured),
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'coordinador', documento: 'coord-user' });
    const ok = await request(app).get('/?dependencia_id=20');

    assert.equal(ok.body.view, 'home/get_list_multas');
    assert.match(captured.optionsSql, /u\.facultad_id = ANY\(\$1::int\[\]\)/);
    assert.deepEqual(captured.optionsParams, [[2, 20]]);
    assert.deepEqual(captured.params, [[2, 20], 20]);
    assert.deepEqual(ok.body.locals.filterAccess, {
      facultad: false,
      dependencia: true,
      ual: true,
    });

    const denied = await request(app).get('/?facultad_id=2');
    assert.equal(denied.body.view, 'home/message_error');
    assert.match(denied.body.locals.message2, /fuera de tu alcance/);
  } finally {
    loaded.restore();
  }
});

test('get_list_multas laboratorista only filters assigned UALs', async () => {
  const captured = {};
  const loaded = loadRoute({
    clientQueryImpl: locationAwareQuery(captured, async (sql) =>
      sql.includes('SELECT documento FROM laboratorista')
        ? { rows: [{ documento: '12345' }] }
        : null
    ),
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'laboratorista', documento: 'lab-user' });
    const ok = await request(app).get('/?ual_id=7');

    assert.equal(ok.body.view, 'home/get_list_multas');
    assert.match(captured.optionsSql, /lu\.ual_id = u\.ual_id/);
    assert.deepEqual(captured.optionsParams, ['12345']);
    assert.deepEqual(captured.params, ['12345', 7]);
    assert.deepEqual(ok.body.locals.filterAccess, {
      facultad: false,
      dependencia: false,
      ual: true,
    });

    const outside = await request(app).get('/?ual_id=99');
    assert.equal(outside.body.view, 'home/message_error');

    const dependencia = await request(app).get('/?dependencia_id=20');
    assert.equal(dependencia.body.view, 'home/message_error');

    const invalid = await request(app).get('/?ual_id=abc');
    assert.match(invalid.body.locals.message, /Filtro de ubicación inválido/);
  } finally {
    loaded.restore();
  }
});
