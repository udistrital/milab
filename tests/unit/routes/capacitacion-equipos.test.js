const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { buildApp, resolveRepoPath } = require('../../integration/helpers/build-test-app');
const { createSessionHarness, createUser } = require('../../integration/helpers/session-fixtures');

const routePath = resolveRepoPath('src/routes/api/capacitacion-equipos.js');
const dbPath = resolveRepoPath('src/libs/db.js');
const authPath = resolveRepoPath('src/routes/middlewares/auth.js');
const accountEmailPath = resolveRepoPath('src/libs/account-email.js');
const scopePath = resolveRepoPath('src/libs/capacitacion-scope.js');

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
  return buildApp({
    entryPath: routePath,
    sessionHarness,
    stubs: [
      [dbPath, { query: query || (async () => ({ rows: [] })), connect }],
      [authPath, authModule],
      [accountEmailPath, { normalizeLogDocument: (documento) => String(documento || '').trim() }],
      [scopePath, { resolveLaboratoristaScope: async () => scope }],
    ],
    purgePaths: [routePath],
  });
}

test('equipment association rejects missing course identifiers before connecting', async () => {
  let connectCalls = 0;
  const loaded = loadRoute({
    connect: async () => {
      connectCalls += 1;
      throw new Error('Database should not be reached');
    },
  });

  try {
    const response = await request(loaded.app)
      .post('/asociar')
      .send({ id_equipos: [4] });

    assert.equal(response.status, 400);
    assert.equal(response.body.ok, false);
    assert.match(response.body.message, /codigo_curso es obligatorio/i);
    assert.equal(connectCalls, 0);
  } finally {
    loaded.restore();
  }
});

test('equipment association rejects students using the real role middleware', async () => {
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
    const response = await request(loaded.app)
      .post('/asociar')
      .send({ codigo_curso: 'COURSE-1', id_equipos: [5] });

    assert.equal(response.status, 403);
    assert.equal(response.body.ok, false);
    assert.equal(connectCalls, 0);
  } finally {
    loaded.restore();
  }
});

test('equipment association add mode deduplicates ids without deactivating other associations', async () => {
  const calls = [];
  let associationInsert = 0;
  let released = false;
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('SELECT codigo_curso, nombre_curso FROM cursos')) {
        return { rows: [{ codigo_curso: 'COURSE-1', nombre_curso: 'Curso uno' }] };
      }
      if (sql.includes('INSERT INTO equipo_especializado')) {
        associationInsert += 1;
        return { rows: [{ is_new: associationInsert === 1 }] };
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
      .post('/asociar')
      .send({
        codigo_curso: 'COURSE-1',
        id_equipos: ['5', 5, '6', '-1', 'invalid'],
        modo: 'agregar',
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.modo, 'agregar');
    assert.deepEqual(response.body.id_equipos, [5, 6]);
    assert.equal(response.body.insertados, 1);
    assert.equal(response.body.reactivados, 1);
    assert.equal(associationInsert, 2);
    assert.equal(
      calls.some(({ sql }) => sql.includes('UPDATE equipo_especializado')),
      false
    );
    assert.ok(calls.some(({ sql }) => sql === 'COMMIT'));
    assert.equal(released, true);
  } finally {
    loaded.restore();
  }
});

test('equipment replacement deactivates removed mappings and saves the requested set', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('SELECT codigo_curso, nombre_curso FROM cursos')) {
        return { rows: [{ codigo_curso: 'COURSE-1', nombre_curso: 'Curso uno' }] };
      }
      if (sql.includes('INSERT INTO equipo_especializado')) {
        return { rows: [{ is_new: true }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const loaded = loadRoute({ connect: async () => client });

  try {
    const response = await request(loaded.app)
      .post('/asociar')
      .send({
        codigo_curso: 'COURSE-1',
        id_equipos: [5, 6],
        modo: 'reemplazar',
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.modo, 'reemplazar');
    assert.deepEqual(response.body.id_equipos, [5, 6]);
    const deactivation = calls.find(({ sql }) => sql.includes('UPDATE equipo_especializado'));
    assert.deepEqual(deactivation.params, ['COURSE-1', [5, 6]]);
    assert.equal(
      calls.filter(({ sql }) => sql.includes('INSERT INTO equipo_especializado')).length,
      2
    );
    assert.ok(calls.some(({ sql }) => sql === 'COMMIT'));
  } finally {
    loaded.restore();
  }
});

test('equipment association rejects a course outside a laboratorista scope', async () => {
  let released = false;
  const client = {
    async query() {
      return { rows: [] };
    },
    release() {
      released = true;
    },
  };
  const loaded = loadRoute({
    connect: async () => client,
    query: async (sql) => {
      assert.match(sql, /FROM cursos c/);
      return { rows: [] };
    },
    scope: {
      isAdmin: false,
      facultyIds: [2],
      ualIds: [11],
    },
    user: {
      tipo: 'laboratorista',
      roles: ['laboratorista'],
      documento: 'lab-1',
    },
  });

  try {
    const response = await request(loaded.app)
      .post('/asociar')
      .send({ codigo_curso: 'OTHER-COURSE', id_equipos: [5] });

    assert.equal(response.status, 403);
    assert.match(
      response.body.message,
      /no pertenece a sus facultades o laboratorios autorizados/i
    );
    assert.equal(released, true);
  } finally {
    loaded.restore();
  }
});

test('equipment removal deactivates associations instead of deleting their history', async () => {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);
      if (sql.includes('SELECT codigo_curso, nombre_curso FROM cursos')) {
        return { rows: [{ codigo_curso: 'COURSE-1', nombre_curso: 'Curso uno' }] };
      }
      if (sql.includes('UPDATE equipo_especializado')) {
        return { rows: [{ codigo_curso: 'COURSE-1', id_equipo: 4 }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const loaded = loadRoute({ connect: async () => client });

  try {
    const response = await request(loaded.app)
      .post('/retirar')
      .send({ codigo_curso: 'COURSE-1', id_equipo: 4 });

    assert.equal(response.status, 200);
    assert.equal(response.body.retirados, 1);
    assert.ok(calls.some((sql) => sql.includes('UPDATE equipo_especializado')));
    assert.equal(
      calls.some((sql) => sql.includes('DELETE FROM equipo_especializado')),
      false
    );
    assert.ok(calls.includes('COMMIT'));
  } finally {
    loaded.restore();
  }
});
