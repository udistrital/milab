const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { buildApp, resolveRepoPath } = require('./helpers/build-test-app');
const { createSessionHarness, createUser } = require('./helpers/session-fixtures');

const coordinadoresPath = resolveRepoPath('src/routes/api/coordinadores_registrados.js');
const estudiantesPath = resolveRepoPath('src/routes/api/estudiantes_registrados.js');
const dbPath = resolveRepoPath('src/libs/db.js');
const accountEmailPath = resolveRepoPath('src/libs/account-email.js');
const facultyScopePath = resolveRepoPath('src/libs/faculty-scope.js');
const authPath = resolveRepoPath('src/routes/middlewares/auth.js');

function createDbClient(queryImpl) {
  return {
    async query(sql, params = []) {
      if (typeof queryImpl === 'function') {
        return queryImpl(sql, params);
      }

      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }

      return { rows: [] };
    },
    release() {},
  };
}

function commonStubs(client) {
  return [
    [dbPath, { connect: async () => client, query: client.query.bind(client) }],
    [
      accountEmailPath,
      {
        findEmailConflict: async () => false,
        isInstitutionalEmail: (value) => String(value || '').endsWith('@udistrital.edu.co'),
        isUniqueViolation: () => false,
        normalizeLogDocument: (value) => value,
        normalizeInstitutionalEmail: (value) =>
          String(value || '')
            .trim()
            .toLowerCase(),
      },
    ],
    [
      authPath,
      {
        requireJsonRoles: () => (req, res, next) => next(),
        requireRoles: () => (req, res, next) => next(),
      },
    ],
  ];
}

test('coordinator email maintenance updates institutional addresses through JSON flow', async () => {
  const client = createDbClient((sql, params = []) => {
    if (sql.includes('FROM coordinador WHERE documento = $1')) {
      return {
        rows: [
          {
            documento: params[0],
            nombre: 'Coord',
            correo: 'old@udistrital.edu.co',
            nombre_u: 'coord',
            usuario_id: 7,
          },
        ],
      };
    }

    return { rows: [] };
  });
  const sessionHarness = createSessionHarness({
    user: createUser({ tipo: 'admin', roles: ['admin'] }),
  });
  const loaded = buildApp({
    entryPath: coordinadoresPath,
    sessionHarness,
    stubs: commonStubs(client),
    purgePaths: [coordinadoresPath],
  });

  try {
    const response = await request(loaded.app)
      .post('/actualizar-correo')
      .type('form')
      .send({ documento: '900', correo: 'nuevo@udistrital.edu.co' });

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.correo, 'nuevo@udistrital.edu.co');
  } finally {
    loaded.restore();
  }
});

test('student email maintenance blocks coordinators outside their faculty scope', async () => {
  const client = createDbClient((sql, params = []) => {
    if (sql.includes('FROM usuario u')) {
      return {
        rows: [
          {
            documento: params[0],
            nombre: 'Estudiante',
            correo: 'old@udistrital.edu.co',
            carrera: 'Facultad X',
            tipo: 'estudiante',
          },
        ],
      };
    }

    return { rows: [] };
  });
  const sessionHarness = createSessionHarness({
    user: createUser({ tipo: 'coordinador', roles: ['coordinador'], documento: 'coord-1' }),
  });
  const loaded = buildApp({
    entryPath: estudiantesPath,
    sessionHarness,
    stubs: [
      ...commonStubs(client),
      [
        facultyScopePath,
        {
          resolveAcademicFacultyName: (value) => value,
          resolveCoordinatorFacultyNames: async () => ['Facultad Y'],
        },
      ],
    ],
    purgePaths: [estudiantesPath],
  });

  try {
    const response = await request(loaded.app)
      .post('/actualizar-correo')
      .type('form')
      .send({ documento: '123', correo: 'nuevo@udistrital.edu.co' });

    assert.equal(response.status, 403);
    assert.equal(response.body.ok, false);
    assert.match(response.body.message, /no tienes permisos/i);
  } finally {
    loaded.restore();
  }
});
