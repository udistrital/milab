const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/facultad.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const accountEmailPath = path.resolve(__dirname, '../../../src/libs/account-email.js');
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

function loadRoute(customQuery = null) {
  const originals = new Map();
  const queryCalls = [];
  const stubs = [
    [
      dbPath,
      {
        query: async (sql, params = []) => {
          queryCalls.push({ sql, params });

          if (customQuery) {
            const custom = await customQuery(sql, params);
            if (custom) return custom;
          }

          if (sql.includes('SELECT ual.nombre AS ual_nombre')) {
            return {
              rows: [
                {
                  ual_nombre: 'UAL Antigua',
                  ual_codigo_abreviacion: 'UAL_ANT',
                  ual_descripcion: 'Descripcion antigua',
                  ual_facultad: '1',
                  facultad_nombre: 'ASAB',
                },
              ],
            };
          }

          return { rows: [] };
        },
      },
    ],
    [accountEmailPath, { normalizeLogDocument: (value) => value }],
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
    queryCalls,
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

test('facultad parses form body for UAL edit requests', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/ual/editar').type('form').send({
      ual_id: '10',
      facultad_id: '1',
      nombre: 'UAL Nueva',
      codigo_abreviacion: 'UAL_NUEVA',
      descripcion: 'Descripcion nueva',
      new_facultad_id: '1',
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/milab/api/facultad?facultad_id=1');

    const updatedNameQuery = loaded.queryCalls.find(
      ({ sql, params }) =>
        sql ===
          'UPDATE ual SET nombre = $1, codigo_abreviacion = $2, descripcion = $3, sal_id_espacio = $4, sal_ocupantes = $5, activo = $6 WHERE ual_id = $7' &&
        params[0] === 'UAL Nueva' &&
        params[1] === 'UAL_NUEVA' &&
        params[2] === 'Descripcion nueva' &&
        params[3] === null &&
        params[4] === null &&
        params[5] === false &&
        params[6] === '10'
    );

    assert.ok(updatedNameQuery);
  } finally {
    loaded.restore();
  }
});

const HIERARCHY_ROWS = [
  {
    facultad_id: 1,
    nombre: 'Facultad de Ingeniería',
    padre_id: null,
    dependencias_count: 1,
    uals_count: 0,
  },
  {
    facultad_id: 2,
    nombre: 'Laboratorios de Ingeniería',
    padre_id: 1,
    dependencias_count: 0,
    uals_count: 3,
  },
  {
    facultad_id: 3,
    nombre: 'Facultad de Artes',
    padre_id: null,
    dependencias_count: 0,
    uals_count: 2,
  },
];

function hierarchyQuery(sql, params) {
  if (sql.includes('AS dependencias_count')) {
    return { rows: HIERARCHY_ROWS };
  }
  if (
    sql.includes('FROM dependencia_facultad') &&
    sql.includes('WHERE dependencia_facultad_id = $1')
  ) {
    const row = HIERARCHY_ROWS.find((item) => item.facultad_id === Number(params[0]));
    return { rows: row ? [row] : [] };
  }
  if (sql.includes('FROM dependencia_facultad WHERE padre_id = $1')) {
    const c = HIERARCHY_ROWS.filter((item) => item.padre_id === Number(params[0])).length;
    return { rows: [{ c }] };
  }
  if (sql.includes('COUNT')) {
    return { rows: [{ c: 0 }] };
  }
  return null;
}

test('facultad index splits faculties and dependencias and preselects the parent faculty', async () => {
  const loaded = loadRoute(hierarchyQuery);

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).get('/?padre_id=1');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/facultad');
    assert.deepEqual(
      response.body.locals.facultades.map((row) => row.facultad_id),
      [1, 3]
    );
    assert.deepEqual(
      response.body.locals.dependencias.map((row) => row.facultad_id),
      [2]
    );
    assert.equal(response.body.locals.selectedPadreId, 1);
    assert.equal(response.body.locals.selectedFacultad, null);
  } finally {
    loaded.restore();
  }
});

test('facultad index opens the UAL level of a dependencia with its parent faculty', async () => {
  const loaded = loadRoute(hierarchyQuery);

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).get('/?facultad_id=2');

    assert.equal(response.status, 200);
    assert.equal(response.body.locals.selectedFacultad.facultad_id, 2);
    assert.equal(response.body.locals.selectedPadreId, 1);
    assert.ok(loaded.queryCalls.some(({ sql }) => sql.includes('FROM ual WHERE facultad_id = $1')));
  } finally {
    loaded.restore();
  }
});

test('facultad dependencias json returns only the children of a faculty', async () => {
  const loaded = loadRoute(hierarchyQuery);

  try {
    const app = buildApp(loaded.route);
    const ok = await request(app).get('/dependencias/json?padre_id=1');
    assert.equal(ok.status, 200);
    assert.equal(ok.body.facultad.facultad_id, 1);
    assert.deepEqual(
      ok.body.dependencias.map((row) => row.facultad_id),
      [2]
    );

    const dependenciaAsParent = await request(app).get('/dependencias/json?padre_id=2');
    assert.equal(dependenciaAsParent.status, 404);

    const missing = await request(app).get('/dependencias/json');
    assert.equal(missing.status, 400);
  } finally {
    loaded.restore();
  }
});

test('facultad add creates a dependencia under a faculty and returns to its list', async () => {
  const loaded = loadRoute(hierarchyQuery);

  try {
    const app = buildApp(loaded.route);
    const response = await request(app)
      .post('/add')
      .type('form')
      .send({ nombre: '  Laboratorio de Física ', padre_id: '1' });

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/milab/api/facultad?padre_id=1');
    const insert = loaded.queryCalls.find(({ sql }) =>
      sql.startsWith('INSERT INTO dependencia_facultad')
    );
    assert.deepEqual(insert.params, ['Laboratorio de Física', 1]);
    const log = loaded.queryCalls.find(({ sql }) => sql.startsWith('INSERT INTO log'));
    assert.equal(log.params[2], 'agregar dependencia');
  } finally {
    loaded.restore();
  }
});

test('facultad add creates a faculty without parent', async () => {
  const loaded = loadRoute(hierarchyQuery);

  try {
    const app = buildApp(loaded.route);
    const response = await request(app)
      .post('/add')
      .type('form')
      .send({ nombre: 'Facultad Nueva' });

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/milab/api/facultad');
    const insert = loaded.queryCalls.find(({ sql }) =>
      sql.startsWith('INSERT INTO dependencia_facultad')
    );
    assert.deepEqual(insert.params, ['Facultad Nueva', null]);
  } finally {
    loaded.restore();
  }
});

test('facultad add rejects a dependencia as parent (only two levels)', async () => {
  const loaded = loadRoute(hierarchyQuery);

  try {
    const app = buildApp(loaded.route);
    const response = await request(app)
      .post('/add')
      .type('form')
      .send({ nombre: 'Nivel tres', padre_id: '2' });

    assert.equal(response.body.view, 'home/message_error');
    assert.match(response.body.locals.message2, /Solo puedes asignar como padre una facultad/);
    assert.ok(
      !loaded.queryCalls.some(({ sql }) => sql.startsWith('INSERT INTO dependencia_facultad'))
    );
  } finally {
    loaded.restore();
  }
});

test('facultad edit converts a legacy faculty into a dependencia', async () => {
  const loaded = loadRoute(hierarchyQuery);

  try {
    const app = buildApp(loaded.route);
    const response = await request(app)
      .post('/editar')
      .type('form')
      .send({ facultad_id: '3', nombre: 'Laboratorios de Artes', padre_id: '1' });

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/milab/api/facultad?padre_id=1');
    const update = loaded.queryCalls.find(({ sql }) => sql.includes('UPDATE dependencia_facultad'));
    assert.deepEqual(update.params, ['Laboratorios de Artes', 1, 3]);
  } finally {
    loaded.restore();
  }
});

test('facultad edit rejects assigning a parent to a faculty with dependencias', async () => {
  const loaded = loadRoute(hierarchyQuery);

  try {
    const app = buildApp(loaded.route);
    const response = await request(app)
      .post('/editar')
      .type('form')
      .send({ facultad_id: '1', nombre: 'Facultad de Ingeniería', padre_id: '3' });

    assert.equal(response.body.view, 'home/message_error');
    assert.match(response.body.locals.message2, /tiene dependencias asociadas/);
    assert.ok(!loaded.queryCalls.some(({ sql }) => sql.includes('UPDATE dependencia_facultad')));
  } finally {
    loaded.restore();
  }
});

test('facultad edit keeps the current parent when the select is not submitted', async () => {
  const loaded = loadRoute(hierarchyQuery);

  try {
    const app = buildApp(loaded.route);
    const response = await request(app)
      .post('/editar')
      .type('form')
      .send({ facultad_id: '2', nombre: 'Laboratorios Ingeniería' });

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/milab/api/facultad?padre_id=1');
    const update = loaded.queryCalls.find(({ sql }) => sql.includes('UPDATE dependencia_facultad'));
    assert.deepEqual(update.params, ['Laboratorios Ingeniería', 1, 2]);
  } finally {
    loaded.restore();
  }
});

test('facultad delete is blocked while the faculty has dependencias', async () => {
  const loaded = loadRoute(hierarchyQuery);

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/eliminar').type('form').send({ facultad_id: '1' });

    assert.equal(response.body.view, 'home/message_error');
    assert.match(response.body.locals.message2, /Tiene dependencias asociadas/);
    assert.ok(
      !loaded.queryCalls.some(({ sql }) => sql.startsWith('DELETE FROM dependencia_facultad'))
    );
  } finally {
    loaded.restore();
  }
});

test('facultad delete removes an empty dependencia and returns to its faculty', async () => {
  const loaded = loadRoute((sql, params) => {
    if (sql.includes('FROM ual WHERE facultad_id')) return { rows: [{ c: 0 }] };
    return hierarchyQuery(sql, params);
  });

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/eliminar').type('form').send({ facultad_id: '2' });

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/milab/api/facultad?padre_id=1');
    const deletion = loaded.queryCalls.find(({ sql }) =>
      sql.startsWith('DELETE FROM dependencia_facultad')
    );
    assert.deepEqual(deletion.params, [2]);
  } finally {
    loaded.restore();
  }
});

test('facultad ual json includes laboratoristas per UAL and inherited coordinators', async () => {
  const loaded = loadRoute((sql) => {
    if (sql.includes('padre_id') && sql.includes('WHERE dependencia_facultad_id = $1')) {
      return { rows: [{ facultad_id: 2, nombre: 'Laboratorios de Ingeniería', padre_id: 1 }] };
    }
    if (sql.includes('information_schema.columns')) return { rows: [] };
    if (sql.includes('FROM ual WHERE facultad_id = $1')) {
      return {
        rows: [
          { ual_id: 10, nombre: 'Lab Física' },
          { ual_id: 11, nombre: 'Lab Química' },
        ],
      };
    }
    if (sql.includes('FROM laboratorista_ual lu')) {
      return {
        rows: [
          {
            ual_id: 10,
            documento: '1001',
            nombre: 'Ana',
            correo: 'ana@udistrital.edu.co',
            activo: true,
            asignacion_activa: true,
          },
          {
            ual_id: 10,
            documento: '1002',
            nombre: 'Luis',
            correo: null,
            activo: false,
            asignacion_activa: true,
          },
        ],
      };
    }
    if (sql.includes('FROM coordinador_facultad_alcance cfa')) {
      return {
        rows: [
          {
            documento: '2001',
            nombre: 'Coordinadora Facultad',
            correo: 'coord@udistrital.edu.co',
            activo: true,
            asignacion_activa: true,
            heredado: true,
            asignado_en: 'Facultad de Ingeniería',
          },
        ],
      };
    }
    return null;
  });

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).get('/ual/json?facultad_id=2');

    assert.equal(response.status, 200);
    assert.deepEqual(
      response.body.uals.map((ual) => ual.laboratoristas.map((lab) => lab.documento)),
      [['1001', '1002'], []]
    );
    assert.equal(response.body.uals[0].laboratoristas[1].activo, false);
    assert.equal(response.body.coordinadores.length, 1);
    assert.equal(response.body.coordinadores[0].heredado, true);

    const coordQuery = loaded.queryCalls.find(({ sql }) =>
      sql.includes('FROM coordinador_facultad_alcance cfa')
    );
    assert.deepEqual(coordQuery.params, ['2']);
  } finally {
    loaded.restore();
  }
});
