const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/dashboard.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const facultyScopePath = path.resolve(__dirname, '../../../src/libs/faculty-scope.js');
const authPath = path.resolve(__dirname, '../../../src/routes/middlewares/auth.js');
const oatiClientPath = path.resolve(__dirname, '../../../src/libs/oati-client.js');
const userIdentityPath = path.resolve(__dirname, '../../../src/libs/user-identity.js');

function buildApp(route, sessionUser) {
  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    req.session = { user: sessionUser };
    res.render = (view, locals) => res.status(res.statusCode || 200).json({ view, locals });
    next();
  });
  app.use('/', route);

  return app;
}

function loadDashboardRoute({
  clientQueryImpl,
  poolQueryImpl,
  scopeImpl,
  fetchUserByIdImpl,
  buildSessionUserImpl,
  requestOatiImpl,
} = {}) {
  const originals = new Map();

  const client = {
    async query(sql, params = []) {
      if (typeof clientQueryImpl === 'function') {
        return clientQueryImpl(sql, params);
      }

      if (sql.includes('FROM information_schema.columns')) {
        return { rows: [{ column_name: params[1][0] }] };
      }

      return { rows: [] };
    },
    release() {},
  };

  const poolStub = {
    async query(sql, params = []) {
      if (typeof poolQueryImpl === 'function') {
        return poolQueryImpl(sql, params);
      }
      return { rows: [] };
    },
    async connect() {
      return client;
    },
  };

  const stubs = [
    [dbPath, poolStub],
    [
      facultyScopePath,
      {
        resolveAcademicFacultyName: (value) => value,
        resolveCoordinatorScope:
          scopeImpl || (async () => ({ coordinatorDocument: '900', facultyIds: [10] })),
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
      userIdentityPath,
      {
        fetchUserById: fetchUserByIdImpl || (async () => null),
        buildSessionUser:
          buildSessionUserImpl ||
          ((row) => {
            if (!row) return null;
            const roles = Array.isArray(row.roles) ? row.roles : row.roles ? [row.roles] : [];
            return {
              id: row.id,
              correo: row.correo,
              documento: row.documento,
              documento_real: row.documento,
              nombre: row.nombre,
              roles,
              tipo: roles[0] || '',
            };
          }),
      },
    ],
    [
      oatiClientPath,
      {
        getAcademicServicePath: (pathValue) => pathValue,
        requestOati: requestOatiImpl || (async () => ({})),
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

test('dashboard exports an Express router with handlers', () => {
  delete require.cache[routePath];
  const router = require(routePath);

  assert.equal(typeof router, 'function');
  assert.equal(typeof router.use, 'function');
  assert.equal(Array.isArray(router.stack), true);
  assert.equal(router.stack.length > 0, true);
});

test('dashboard fetchers query expected data sources for dashboard totals', async () => {
  delete require.cache[routePath];

  const queries = [];
  const dbStub = {
    async query(sql) {
      queries.push(sql);
      return { rows: [] };
    },
    async connect() {
      return { query: async () => ({ rows: [] }), release() {} };
    },
  };
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: dbStub };

  const router = require(routePath);

  await router.__private.fetchCoordinatorRows();
  await router.__private.fetchUsuarioRows();
  await router.__private.fetchUsuariosRegistradosRows();
  await router.__private.fetchUsuarioRolesRows();
  await router.__private.fetchSanctionRows();
  await router.__private.fetchLaboratoristaRows();
  await router.__private.fetchStudentCertificateRows();
  await router.__private.fetchTeacherCertificateRows();

  const coordinatorQ = queries.find(
    (q) => q.includes('FROM coordinador c') && q.includes('ARRAY_REMOVE(ARRAY_AGG')
  );
  const usuarioQ = queries.find((q) => q.includes('WITH usuarios_base AS'));
  const usuariosRegistradosQ = queries.find(
    (q) => q.includes('SELECT u.*') && q.includes('FROM usuario u')
  );
  const usuarioRolesQ = queries.find(
    (q) => q.includes('FROM usuario_rol ur') && q.includes('JOIN rol r ON r.id = ur.rol_id')
  );
  const multaQ = queries.find((q) => q.includes('SELECT m.*') && q.includes('FROM multa m'));
  const labQ = queries.find(
    (q) => q.includes('FROM laboratorista l') && q.includes('ARRAY_REMOVE(ARRAY_AGG')
  );
  const ceQ = queries.find(
    (q) => q.includes('SELECT ce.*') && q.includes('FROM certificado_estudiante ce')
  );
  const cdQ = queries.find(
    (q) => q.includes('SELECT cd.*') && q.includes('FROM certificado_docente cd')
  );

  assert.equal(coordinatorQ.includes('LEFT JOIN coordinador_facultad cf'), true);
  assert.equal(usuarioQ.includes('FROM usuario u'), true);
  assert.equal(typeof usuariosRegistradosQ === 'string', true);
  assert.equal(usuariosRegistradosQ.includes('u.correo IS NOT NULL'), true);
  assert.equal(usuariosRegistradosQ.includes("TRIM(u.correo) <> ''"), true);
  assert.equal(usuariosRegistradosQ.includes("LOWER(u.correo) NOT LIKE '%no-email%'"), true);
  assert.equal(typeof usuarioRolesQ === 'string', true);
  assert.equal(usuarioRolesQ.includes('ur.activo = TRUE'), true);
  assert.equal(multaQ.includes('SELECT m.*'), true);
  assert.equal(labQ.includes('LEFT JOIN laboratorista_ual lu'), true);
  assert.equal(ceQ.includes('SELECT ce.*'), true);
  assert.equal(cdQ.includes('SELECT cd.*'), true);

  assert.equal(usuarioQ.includes('FROM coordinador c'), true);
  assert.equal(usuarioQ.includes('JOIN coordinador_facultad cf'), true);
  assert.equal(usuarioQ.includes('FROM laboratorista l'), true);
  assert.equal(usuarioQ.includes("r.nombre IN ('admin', 'estudiante', 'docente')"), true);
  assert.equal(multaQ.includes('COALESCE'), false);
});

test('dashboard renders default admin chart set when there is no data', async () => {
  const loaded = loadDashboardRoute();

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', documento: '100' });
    const response = await request(app).get('/');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/dashboard');
    assert.equal(response.body.locals.dashboardRole, 'admin');
    assert.equal(response.body.locals.selectedChart, 'certificadosEstudiantes');
    assert.equal(response.body.locals.availableCharts.length >= 1, true);
  } finally {
    loaded.restore();
  }
});

test('dashboard blocks coordinador without faculty scope', async () => {
  const loaded = loadDashboardRoute({
    scopeImpl: async () => ({ coordinatorDocument: null, facultyIds: [] }),
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

test('dashboard impersonation start rejects users without active impersonable roles', async () => {
  const loaded = loadDashboardRoute({
    fetchUserByIdImpl: async (id) => ({
      id,
      correo: 'sinrol@udistrital.edu.co',
      documento: '555',
      nombre: 'Sin Rol',
      roles: [],
    }),
  });

  try {
    const app = buildApp(loaded.route, {
      id: 1,
      tipo: 'admin',
      documento: '100',
      roles: ['admin'],
    });
    const response = await request(app)
      .post('/impersonacion/iniciar')
      .set('Accept', 'application/json')
      .send({ usuarioId: 77 });

    assert.equal(response.status, 409);
    assert.equal(response.body.ok, false);
    assert.match(response.body.message, /no tiene roles activos/i);
  } finally {
    loaded.restore();
  }
});

test('dashboard impersonation start allows estudiante role and returns redirect', async () => {
  const loaded = loadDashboardRoute({
    fetchUserByIdImpl: async (id) => ({
      id,
      correo: 'estudiante@udistrital.edu.co',
      documento: '777',
      nombre: 'Estudiante Test',
      roles: ['estudiante'],
    }),
    poolQueryImpl: async (sql) => {
      if (sql.includes('INSERT INTO log')) {
        return { rows: [] };
      }

      return { rows: [] };
    },
  });

  try {
    const app = buildApp(loaded.route, {
      id: 1,
      tipo: 'admin',
      documento: '100',
      roles: ['admin'],
    });
    const response = await request(app)
      .post('/impersonacion/iniciar')
      .set('Accept', 'application/json')
      .send({ usuarioId: 88 });

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.redirect, '/milab/inicio');
  } finally {
    loaded.restore();
  }
});

test('dashboard admin email edit requires enrollment type selection', async () => {
  const loaded = loadDashboardRoute();

  try {
    const app = buildApp(loaded.route, {
      id: 1,
      tipo: 'admin',
      documento: '100',
      roles: ['admin'],
    });
    const response = await request(app)
      .post('/usuarios/25/correo')
      .set('Accept', 'application/json')
      .send({ correo: 'estudiante@udistrital.edu.co' });

    assert.equal(response.status, 400);
    assert.equal(response.body.ok, false);
    assert.match(response.body.message, /enrolar como estudiante o docente/i);
  } finally {
    loaded.restore();
  }
});

test('dashboard admin email edit enrolls user as estudiante', async () => {
  const clientQueries = [];
  const loaded = loadDashboardRoute({
    clientQueryImpl: async (sql, params = []) => {
      clientQueries.push(sql);

      if (
        sql.includes('SELECT id, documento, correo, nombre, codigo, carrera, estado FROM usuario')
      ) {
        return {
          rows: [
            {
              id: params[0],
              documento: '1010',
              correo: 'no-email+1010@placeholder.milab.local',
              nombre: 'Cuenta Placeholder',
              codigo: null,
              carrera: null,
              estado: null,
            },
          ],
        };
      }

      if (sql.includes('SELECT source, auth_document')) {
        return { rows: [] };
      }

      return { rows: [] };
    },
    requestOatiImpl: async (servicePath) => {
      if (String(servicePath).includes('datos_basicos_activos_cedula/1010')) {
        return {
          datosEstudianteCollection: {
            datosBasicosEstudiante: [
              {
                nombre: 'Estudiante Prueba',
                codigo: '20251234',
                estado: 'A',
                carrera: '31',
              },
            ],
          },
        };
      }

      if (String(servicePath).includes('estados_codigo/A')) {
        return { estado: { nombre: 'ACTIVO' } };
      }

      if (String(servicePath).includes('carrera/31')) {
        return { carrerasCollection: { carrera: [{ nombre: 'Ingenieria de Sistemas' }] } };
      }

      return {};
    },
  });

  try {
    const app = buildApp(loaded.route, {
      id: 1,
      tipo: 'admin',
      documento: '100',
      roles: ['admin'],
    });
    const response = await request(app)
      .post('/usuarios/25/correo')
      .set('Accept', 'application/json')
      .send({
        correo: 'estudiante@udistrital.edu.co',
        tipoUsuario: 'estudiante',
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.tipoUsuario, 'estudiante');
    assert.equal(
      clientQueries.some((sql) => sql.includes('INSERT INTO usuario_rol (usuario_id, rol_id)')),
      true
    );
    assert.equal(
      clientQueries.some((sql) => sql.includes('INSERT INTO perfil_estudiante')),
      true
    );
  } finally {
    loaded.restore();
  }
});
