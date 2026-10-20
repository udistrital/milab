const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const root = path.resolve(__dirname, '../../..');
const routePath = path.join(root, 'src/routes/api/capacitacion-cursos.js');
const poolPath = path.join(root, 'src/libs/db.js');
const scopePath = path.join(root, 'src/libs/capacitacion-scope.js');

function buildTestApp(query, connect) {
  const originalPool = require.cache[poolPath];
  const originalScope = require.cache[scopePath];
  delete require.cache[routePath];
  delete require.cache[scopePath];
  require.cache[poolPath] = {
    id: poolPath,
    filename: poolPath,
    loaded: true,
    exports: { query, ...(connect ? { connect } : {}) },
  };

  const router = require(routePath);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = {
      user: { id: 12, documento: '12345', tipo: 'admin', roles: ['admin'] },
    };
    next();
  });
  app.use('/capacitacion-cursos', router);

  return {
    app,
    restore() {
      delete require.cache[routePath];
      delete require.cache[scopePath];
      if (originalPool) require.cache[poolPath] = originalPool;
      else delete require.cache[poolPath];
      if (originalScope) require.cache[scopePath] = originalScope;
    },
  };
}

test('faculty catalog returns only active root faculties', async () => {
  let queryText = '';
  const setup = buildTestApp(async (sql) => {
    queryText = sql;
    return { rows: [{ facultad_id: 3, nombre: 'Facultad de prueba' }] };
  });

  try {
    const response = await request(setup.app).get('/capacitacion-cursos/facultades');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.facultades, [{ facultad_id: 3, nombre: 'Facultad de prueba' }]);
    assert.match(queryText, /FROM dependencia_facultad/);
    assert.match(queryText, /WHERE padre_id IS NULL AND activo = TRUE/);
  } finally {
    setup.restore();
  }
});

test('dependence catalog returns only children of the selected faculty', async () => {
  const calls = [];
  const setup = buildTestApp(async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes('WHERE dependencia_facultad_id = $1')) {
      return { rows: [{ facultad_id: 3, nombre: 'Facultad de prueba' }] };
    }
    return {
      rows: [{ dependencia_id: 9, nombre: 'Departamento de prueba' }],
    };
  });

  try {
    const response = await request(setup.app).get('/capacitacion-cursos/facultades/3/dependencias');
    assert.equal(response.status, 200);
    assert.equal(response.body.facultad.facultad_id, 3);
    assert.deepEqual(response.body.dependencias, [
      { dependencia_id: 9, nombre: 'Departamento de prueba' },
    ]);
    assert.match(calls[0].sql, /padre_id IS NULL/);
    assert.match(calls[1].sql, /WHERE padre_id = \$1 AND activo = TRUE/);
    assert.deepEqual(calls[1].values, [3]);
  } finally {
    setup.restore();
  }
});

test('course creation requires a faculty and its selected dependence', async () => {
  let queryCount = 0;
  const setup = buildTestApp(async () => {
    queryCount += 1;
    throw new Error('Database should not be queried for invalid form data');
  });

  try {
    const response = await request(setup.app)
      .post('/capacitacion-cursos/nuevo')
      .send({
        codigo_curso: 'CURSO-1',
        nombre_curso: 'Curso de prueba',
        url_edx: 'https://example.test/course',
        id_facultad: 9,
        id_laboratorios: [1],
      });
    assert.equal(response.status, 400);
    assert.match(response.body.errors.join(' '), /La facultad es obligatoria/);
    assert.equal(queryCount, 0);
  } finally {
    setup.restore();
  }
});

test('course creation rejects the faculty root when a dependency must be selected', async () => {
  const clientCalls = [];
  const client = {
    async query(sql, values) {
      clientCalls.push({ sql, values });
      if (sql.includes('FROM dependencia_facultad padre')) {
        assert.deepEqual(values, [3, 3]);
        assert.match(sql, /dependencia\.padre_id = padre\.dependencia_facultad_id/);
        return { rows: [] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const setup = buildTestApp(
    async () => ({ rows: [] }),
    async () => client
  );

  try {
    const response = await request(setup.app)
      .post('/capacitacion-cursos/nuevo')
      .send({
        codigo_curso: 'CURSO-2',
        nombre_curso: 'Curso de prueba',
        url_edx: 'https://example.test/course',
        id_facultad_padre: 3,
        id_facultad: 3,
        id_laboratorios: [1],
      });
    assert.equal(response.status, 400);
    assert.match(response.body.message, /dependencia no pertenece a la facultad/i);
    assert.ok(clientCalls.some(({ sql }) => sql === 'ROLLBACK'));
  } finally {
    setup.restore();
  }
});

test('course creation and editing reject laboratories outside the selected dependence', async () => {
  const writes = [
    {
      path: '/capacitacion-cursos/nuevo',
      body: {
        codigo_curso: 'CURSO-3',
        nombre_curso: 'Curso de prueba',
        url_edx: 'https://example.test/course',
        id_facultad_padre: 3,
        id_facultad: 9,
        id_laboratorios: [1],
      },
    },
    {
      path: '/capacitacion-cursos/editar',
      body: {
        codigo_curso_original: 'CURSO-3',
        codigo_curso: 'CURSO-3',
        nombre_curso: 'Curso de prueba',
        url_edx: 'https://example.test/course',
        id_facultad_padre: 3,
        id_facultad: 9,
        id_laboratorios: [1],
      },
    },
  ];

  for (const write of writes) {
    const clientCalls = [];
    const client = {
      async query(sql) {
        clientCalls.push(sql);
        if (sql.includes('FROM dependencia_facultad padre')) {
          return {
            rows: [{ nombre_facultad: 'Facultad de prueba', nombre_dependencia: 'Departamento' }],
          };
        }
        if (sql.includes('FROM ual')) {
          return { rows: [{ ual_id: 1, facultad_id: 10, activo: true }] };
        }
        if (sql.includes('SELECT codigo_curso FROM cursos')) {
          return { rows: [{ codigo_curso: 'CURSO-3' }] };
        }
        return { rows: [] };
      },
      release() {},
    };
    const setup = buildTestApp(
      async () => ({ rows: [] }),
      async () => client
    );

    try {
      const response = await request(setup.app).post(write.path).send(write.body);
      assert.equal(response.status, 400);
      assert.match(response.body.message, /laboratorios deben estar activos y pertenecer/i);
      assert.ok(clientCalls.includes('ROLLBACK'));
      assert.ok(
        clientCalls.some((sql) => sql.includes('ORDER BY ual_id') && sql.includes('FOR UPDATE'))
      );
      assert.equal(
        clientCalls.some((sql) =>
          /^(INSERT INTO cursos|UPDATE cursos|DELETE FROM curso_laboratorio)/.test(sql)
        ),
        false
      );
    } finally {
      setup.restore();
    }
  }
});

test('course creation accepts active laboratories from the selected dependence', async () => {
  const clientCalls = [];
  const client = {
    async query(sql) {
      clientCalls.push(sql);
      if (sql.includes('FROM dependencia_facultad padre')) {
        return {
          rows: [{ nombre_facultad: 'Facultad de prueba', nombre_dependencia: 'Departamento' }],
        };
      }
      if (sql.includes('FROM ual')) {
        return { rows: [{ ual_id: 1, facultad_id: 9, activo: true }] };
      }
      if (sql.includes('INSERT INTO cursos')) {
        return {
          rows: [
            {
              codigo_curso: 'CURSO-4',
              id_facultad: 9,
              nombre_curso: 'Curso de prueba',
              url_edx: 'https://example.test/course',
              activo: true,
            },
          ],
        };
      }
      return { rows: [] };
    },
    release() {},
  };
  const setup = buildTestApp(
    async () => ({ rows: [] }),
    async () => client
  );

  try {
    const response = await request(setup.app)
      .post('/capacitacion-cursos/nuevo')
      .send({
        codigo_curso: 'CURSO-4',
        nombre_curso: 'Curso de prueba',
        url_edx: 'https://example.test/course',
        id_facultad_padre: 3,
        id_facultad: 9,
        id_laboratorios: [1],
      });
    assert.equal(response.status, 200);
    assert.ok(clientCalls.some((sql) => sql.includes('INSERT INTO curso_laboratorio')));
    assert.ok(clientCalls.includes('COMMIT'));
  } finally {
    setup.restore();
  }
});
