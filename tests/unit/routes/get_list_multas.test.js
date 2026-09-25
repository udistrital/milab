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

function loadRoute({ resolveScopeImpl, clientQueryImpl, resolveOatiNameImpl } = {}) {
  const originals = new Map();
  const client = {
    release() {},
    async query(sql, params = []) {
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
      },
    ],
    [
      oatiNamePath,
      {
        resolveOatiName: resolveOatiNameImpl || (async () => 'Nombre OATI'),
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

test('get_list_multas returns grouped sanctions for non-coordinator roles', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', documento: '1024467835' });
    const response = await request(app).get('/');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/get_list_multas');
    assert.equal(response.body.locals.sampleData.length, 2);
    assert.equal(response.body.locals.sancionesEstudiantes.length, 1);
    assert.equal(response.body.locals.sancionesDocentes.length, 1);
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
          { id: 4, tipo_sancionado: 'estudiante', con_estado_multa: 'SALDADA', facultad_id: 5 },
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
    assert.equal(rows[2].canRemove, true);
    assert.equal(rows[3].canActivate, false);
    assert.equal(rows[3].canSaldar, false);
    assert.equal(rows[3].canRemove, false);
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
