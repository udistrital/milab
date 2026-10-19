const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { buildApp, resolveRepoPath } = require('../../integration/helpers/build-test-app');
const { createSessionHarness, createUser } = require('../../integration/helpers/session-fixtures');

const routePath = resolveRepoPath('src/routes/api/capacitacion-cursos.js');
const dbPath = resolveRepoPath('src/libs/db.js');
const authPath = resolveRepoPath('src/routes/middlewares/auth.js');
const accountEmailPath = resolveRepoPath('src/libs/account-email.js');
const scopePath = resolveRepoPath('src/libs/capacitacion-scope.js');
const edxClientPath = resolveRepoPath('src/libs/edx-cert-client.js');

const allowJsonRoles = () => (req, res, next) => next();

function loadRoute({
  query,
  connect,
  scope = { isAdmin: true },
  user = {},
  authModule = { requireJsonRoles: allowJsonRoles },
} = {}) {
  const sessionHarness = createSessionHarness({
    user: createUser({
      tipo: 'admin',
      roles: ['admin'],
      documento: 'admin-1',
      ...user,
    }),
  });
  const loaded = buildApp({
    entryPath: routePath,
    sessionHarness,
    stubs: [
      [dbPath, { query: query || (async () => ({ rows: [] })), connect }],
      [authPath, authModule],
      [accountEmailPath, { normalizeLogDocument: (documento) => String(documento || '').trim() }],
      [scopePath, { resolveLaboratoristaScope: async () => scope }],
      [edxClientPath, { consultarCursosUsuario: async () => ({ cursos: [] }) }],
    ],
    purgePaths: [routePath],
  });

  return loaded;
}

function validCourse(overrides = {}) {
  return {
    codigo_curso: 'COURSE-1',
    id_facultad: 3,
    nombre_curso: 'Introducción a equipos',
    url_edx: 'https://edx.test/course-1',
    activo: true,
    id_laboratorios: [11],
    ...overrides,
  };
}

test('course creation rejects invalid fields before opening a database transaction', async () => {
  let connectCalls = 0;
  const loaded = loadRoute({
    connect: async () => {
      connectCalls += 1;
      throw new Error('Database should not be reached');
    },
  });

  try {
    const response = await request(loaded.app).post('/nuevo').send({
      codigo_curso: '',
      id_facultad: '0',
      nombre_curso: '',
      url_edx: 'javascript:alert(1)',
      id_laboratorios: [],
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.ok, false);
    assert.ok(response.body.errors.length >= 4);
    assert.equal(connectCalls, 0);
  } finally {
    loaded.restore();
  }
});

test('course write routes reject students using the real role middleware', async () => {
  let connectCalls = 0;
  const authModule = require(resolveRepoPath('src/routes/middlewares/auth.js'));
  const loaded = loadRoute({
    authModule,
    user: { tipo: 'estudiante', roles: ['estudiante'] },
    connect: async () => {
      connectCalls += 1;
      throw new Error('Database should not be reached');
    },
  });

  try {
    const response = await request(loaded.app).post('/nuevo').send(validCourse());

    assert.equal(response.status, 403);
    assert.equal(response.body.ok, false);
    assert.equal(connectCalls, 0);
  } finally {
    loaded.restore();
  }
});

test('course creation commits the course and unique laboratory associations', async () => {
  const calls = [];
  let released = false;
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('SELECT nombre FROM dependencia_facultad')) {
        return { rows: [{ nombre: 'Facultad de prueba' }] };
      }
      if (sql.includes('INSERT INTO cursos')) {
        return {
          rows: [
            {
              codigo_curso: 'COURSE-1',
              id_facultad: 3,
              nombre_curso: 'Introducción a equipos',
              activo: true,
            },
          ],
        };
      }
      return { rows: [] };
    },
    release() {
      released = true;
    },
  };
  const loaded = loadRoute({ connect: async () => client });

  try {
    const response = await request(loaded.app)
      .post('/nuevo')
      .send(validCourse({ id_laboratorios: [11, 11, 0, -1] }));

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.curso.codigo_curso, 'COURSE-1');
    assert.ok(calls.some(({ sql }) => sql === 'BEGIN'));
    assert.equal(
      calls.filter(({ sql }) => sql.includes('INSERT INTO curso_laboratorio')).length,
      1
    );
    assert.ok(calls.some(({ sql }) => sql === 'COMMIT'));
    assert.equal(released, true);
  } finally {
    loaded.restore();
  }
});

test('course editing replaces laboratory associations and commits the full change', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('SELECT codigo_curso FROM cursos')) {
        return { rows: [{ codigo_curso: 'COURSE-1' }] };
      }
      if (sql.includes('SELECT nombre FROM dependencia_facultad')) {
        return { rows: [{ nombre: 'Facultad de prueba' }] };
      }
      if (sql.includes('UPDATE cursos')) {
        return {
          rows: [
            {
              codigo_curso: 'COURSE-1',
              id_facultad: 3,
              nombre_curso: 'Curso actualizado',
              activo: true,
            },
          ],
        };
      }
      return { rows: [] };
    },
    release() {},
  };
  const loaded = loadRoute({ connect: async () => client });

  try {
    const response = await request(loaded.app)
      .post('/editar')
      .send(
        validCourse({
          codigo_curso_original: 'COURSE-1',
          nombre_curso: 'Curso actualizado',
          id_laboratorios: [11, 12],
        })
      );

    assert.equal(response.status, 200);
    assert.ok(calls.some(({ sql }) => sql === 'BEGIN'));
    assert.ok(
      calls.some(
        ({ sql, params }) =>
          sql.includes('DELETE FROM curso_laboratorio') && params[0] === 'COURSE-1'
      )
    );
    assert.equal(
      calls.filter(({ sql }) => sql.includes('INSERT INTO curso_laboratorio')).length,
      2
    );
    assert.ok(calls.some(({ sql }) => sql === 'COMMIT'));
  } finally {
    loaded.restore();
  }
});

test('course editing rolls back when a new laboratory association fails', async () => {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);
      if (sql.includes('SELECT codigo_curso FROM cursos')) {
        return { rows: [{ codigo_curso: 'COURSE-1' }] };
      }
      if (sql.includes('SELECT nombre FROM dependencia_facultad')) {
        return { rows: [{ nombre: 'Facultad de prueba' }] };
      }
      if (sql.includes('UPDATE cursos')) {
        return { rows: [{ codigo_curso: 'COURSE-1' }] };
      }
      if (sql.includes('INSERT INTO curso_laboratorio')) {
        const error = new Error('invalid laboratory');
        error.code = '23503';
        error.constraint = 'fk_curso_laboratorio_ual';
        throw error;
      }
      return { rows: [] };
    },
    release() {},
  };
  const loaded = loadRoute({ connect: async () => client });

  try {
    const response = await request(loaded.app)
      .post('/editar')
      .send(validCourse({ codigo_curso_original: 'COURSE-1' }));

    assert.equal(response.status, 400);
    assert.ok(calls.includes('ROLLBACK'));
    assert.equal(calls.includes('COMMIT'), false);
  } finally {
    loaded.restore();
  }
});

test('course creation maps duplicate course identifiers and rolls back', async () => {
  const calls = [];
  let released = false;
  const client = {
    async query(sql) {
      calls.push(sql);
      if (sql.includes('SELECT nombre FROM dependencia_facultad')) {
        return { rows: [{ nombre: 'Facultad de prueba' }] };
      }
      if (sql.includes('INSERT INTO cursos')) {
        const error = new Error('duplicate key');
        error.code = '23505';
        error.constraint = 'pk_cursos';
        throw error;
      }
      return { rows: [] };
    },
    release() {
      released = true;
    },
  };
  const loaded = loadRoute({ connect: async () => client });

  try {
    const response = await request(loaded.app).post('/nuevo').send(validCourse());

    assert.equal(response.status, 409);
    assert.match(response.body.message, /duplicado/i);
    assert.ok(calls.includes('ROLLBACK'));
    assert.equal(released, true);
  } finally {
    loaded.restore();
  }
});

test('course status changes persist the requested active flag', async () => {
  const calls = [];
  const loaded = loadRoute({
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT codigo_curso, nombre_curso, activo FROM cursos')) {
        return { rows: [{ codigo_curso: 'COURSE-1', nombre_curso: 'Curso uno', activo: true }] };
      }
      return { rows: [] };
    },
  });

  try {
    const response = await request(loaded.app)
      .post('/cambiar-estado')
      .send({ codigo_curso: 'COURSE-1', activo: false });

    assert.equal(response.status, 200);
    assert.equal(response.body.activo, false);
    assert.deepEqual(calls.find(({ sql }) => sql.includes('UPDATE cursos')).params, [
      false,
      'COURSE-1',
    ]);
  } finally {
    loaded.restore();
  }
});

test('course listing reports a missing capacitacion schema as a service error', async () => {
  const loaded = loadRoute({
    query: async () => {
      const error = new Error('relation cursos does not exist');
      error.code = '42P01';
      throw error;
    },
  });

  try {
    const response = await request(loaded.app).get('/list');

    assert.equal(response.status, 503);
    assert.equal(response.body.migration_faltante, true);
    assert.equal(response.body.script_requerido, 'sql-scripts/db_structure_certificacion.sql');
  } finally {
    loaded.restore();
  }
});
