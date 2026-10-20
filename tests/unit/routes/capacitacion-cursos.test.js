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
    id_facultad_padre: 2,
    id_facultad: 3,
    nombre_curso: 'Introducción a equipos',
    url_edx: 'https://edx.test/course-1',
    activo: true,
    id_laboratorios: [11],
    ...overrides,
  };
}

function courseValidationResult(sql, params) {
  if (sql.includes('FROM dependencia_facultad padre')) {
    const [idFacultadPadre, idFacultad] = params;
    if (idFacultadPadre !== 2 || idFacultad !== 3) return { rows: [] };
    return {
      rows: [
        { nombre_facultad: 'Facultad de prueba', nombre_dependencia: 'Dependencia de prueba' },
      ],
    };
  }
  if (sql.includes('FROM ual')) {
    return {
      rows: (params[0] || []).map((ualId) => ({
        ual_id: ualId,
        facultad_id: 3,
        activo: true,
      })),
    };
  }
  return null;
}

test('faculty catalog returns only active root faculties', async () => {
  let queryText = '';
  const loaded = loadRoute({
    query: async (sql) => {
      queryText = sql;
      return { rows: [{ facultad_id: 2, nombre: 'Facultad de prueba' }] };
    },
  });

  try {
    const response = await request(loaded.app).get('/facultades');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.facultades, [{ facultad_id: 2, nombre: 'Facultad de prueba' }]);
    assert.match(queryText, /WHERE padre_id IS NULL AND activo = TRUE/);
  } finally {
    loaded.restore();
  }
});

test('dependence catalog returns only children of the selected faculty', async () => {
  const calls = [];
  const loaded = loadRoute({
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('padre_id IS NULL')) {
        return { rows: [{ facultad_id: 2, nombre: 'Facultad de prueba' }] };
      }
      return { rows: [{ dependencia_id: 3, nombre: 'Dependencia de prueba' }] };
    },
  });

  try {
    const response = await request(loaded.app).get('/facultades/2/dependencias');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.facultad, {
      facultad_id: 2,
      nombre: 'Facultad de prueba',
    });
    assert.deepEqual(response.body.dependencias, [
      { dependencia_id: 3, nombre: 'Dependencia de prueba' },
    ]);
    assert.match(calls[1].sql, /WHERE padre_id = \$1 AND activo = TRUE/);
    assert.deepEqual(calls[1].params, [2]);
  } finally {
    loaded.restore();
  }
});

test('course creation rejects a faculty root when a child dependence is required', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push(sql);
      return courseValidationResult(sql, params) || { rows: [] };
    },
    release() {},
  };
  const loaded = loadRoute({ connect: async () => client });

  try {
    const response = await request(loaded.app)
      .post('/nuevo')
      .send(validCourse({ id_facultad_padre: 2, id_facultad: 2 }));

    assert.equal(response.status, 400);
    assert.match(response.body.message, /dependencia no pertenece a la facultad/i);
    assert.ok(calls.includes('ROLLBACK'));
    assert.equal(
      calls.some((sql) => sql.includes('FROM ual')),
      false
    );
  } finally {
    loaded.restore();
  }
});

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
      const validation = courseValidationResult(sql, params);
      if (validation) return validation;
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

test('course creation and editing reject laboratories from another dependence before writes', async () => {
  for (const path of ['/nuevo', '/editar']) {
    const calls = [];
    const client = {
      async query(sql, params) {
        calls.push(sql);
        if (sql.includes('FROM dependencia_facultad padre')) {
          return courseValidationResult(sql, params);
        }
        if (sql.includes('FROM ual')) {
          return { rows: [{ ual_id: 11, facultad_id: 99, activo: true }] };
        }
        if (sql.includes('SELECT codigo_curso FROM cursos')) {
          return { rows: [{ codigo_curso: 'COURSE-1' }] };
        }
        return { rows: [] };
      },
      release() {},
    };
    const loaded = loadRoute({ connect: async () => client });

    try {
      const response = await request(loaded.app)
        .post(path)
        .send(validCourse({ codigo_curso_original: 'COURSE-1' }));

      assert.equal(response.status, 400);
      assert.match(response.body.message, /laboratorios deben estar activos y pertenecer/i);
      assert.ok(calls.includes('ROLLBACK'));
      assert.equal(
        calls.some((sql) =>
          /^(INSERT INTO cursos|UPDATE cursos|DELETE FROM curso_laboratorio)/.test(sql)
        ),
        false
      );
    } finally {
      loaded.restore();
    }
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
      const validation = courseValidationResult(sql, params);
      if (validation) return validation;
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
    async query(sql, params) {
      calls.push(sql);
      if (sql.includes('SELECT codigo_curso FROM cursos')) {
        return { rows: [{ codigo_curso: 'COURSE-1' }] };
      }
      const validation = courseValidationResult(sql, params);
      if (validation) return validation;
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
    async query(sql, params) {
      calls.push(sql);
      const validation = courseValidationResult(sql, params);
      if (validation) return validation;
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
