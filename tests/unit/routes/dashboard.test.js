const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/dashboard.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const facultyScopePath = path.resolve(__dirname, '../../../src/libs/faculty-scope.js');
const authPath = path.resolve(__dirname, '../../../src/routes/middlewares/auth.js');
const appUrlPath = path.resolve(__dirname, '../../../src/libs/app-url.js');
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
  sendEmailNotificationImpl,
  buildAppUrlImpl,
} = {}) {
  const originals = new Map();
  const requireRolesCalls = [];

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
      path.resolve(__dirname, '../../../src/libs/email-notifications.js'),
      { sendEmailNotification: sendEmailNotificationImpl || (async () => ({ status: 'SENT' })) },
    ],
    [
      appUrlPath,
      { buildAppUrl: buildAppUrlImpl || ((pathname) => `https://milab.test${pathname}`) },
    ],
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
        requireRoles: (roles, options) => {
          requireRolesCalls.push({ roles, options });
          return (req, res, next) => next();
        },
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
    requireRolesCalls,
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
  assert.equal(labQ.includes('LEFT JOIN laboratorista_ual lu'), true);
  assert.equal(ceQ.includes('SELECT ce.*'), true);
  assert.equal(cdQ.includes('SELECT cd.*'), true);

  assert.equal(usuarioQ.includes('FROM coordinador c'), true);
  assert.equal(usuarioQ.includes('JOIN coordinador_facultad cf'), true);
  assert.equal(usuarioQ.includes('FROM laboratorista l'), true);
  assert.equal(usuarioQ.includes("r.nombre IN ('admin', 'estudiante', 'docente')"), true);
});

test('dashboard keeps sanctions out of the platform tab for coordinador scope', async () => {
  const loaded = loadDashboardRoute({
    scopeImpl: async () => ({ coordinatorDocument: '900', facultyIds: [10] }),
    poolQueryImpl: async (sql) => {
      if (sql.includes('FROM multa m')) {
        return {
          rows: [
            {
              id: 1,
              fecha_multa: new Date().toISOString(),
              con_estado_multa: 'ACTIVA',
              faculty_id: 10,
            },
            {
              id: 2,
              fecha_multa: new Date().toISOString(),
              con_estado_multa: 'ACTIVA',
              faculty_id: 99,
            },
          ],
        };
      }

      if (sql.includes('FROM laboratorista l')) {
        return { rows: [] };
      }

      if (sql.includes('FROM coordinador c')) {
        return { rows: [] };
      }

      if (sql.includes('WITH usuarios_base AS')) {
        return { rows: [] };
      }

      if (sql.includes('FROM usuario_rol ur')) {
        return { rows: [] };
      }

      if (sql.includes('FROM certificado_estudiante ce')) {
        return { rows: [] };
      }

      if (sql.includes('FROM certificado_docente cd')) {
        return { rows: [] };
      }

      return { rows: [] };
    },
    clientQueryImpl: async (sql, params = []) => {
      if (sql.includes('FROM information_schema.columns')) {
        return { rows: [{ column_name: params[1][0] }] };
      }

      if (sql.includes('FROM dependencia_facultad') && sql.includes('= ANY($1::int[])')) {
        return { rows: [{ nombre: 'Tecnologica' }] };
      }

      return { rows: [] };
    },
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'coordinador', documento: 'coord-user' });
    const response = await request(app).get('/');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/dashboard');

    const chartIds = (response.body.locals.availableCharts || []).map((chart) => chart.id);
    assert.equal(
      chartIds.some((id) => id.startsWith('sanciones') || id.startsWith('certificados')),
      false
    );
    assert.equal('sanciones' in response.body.locals.tablesData, false);
    assert.equal('multas' in response.body.locals.chartsData, false);
    assert.equal(response.body.locals.scopeCounters, undefined);
    assert.equal(response.body.locals.coberturaOperativa, null);
    assert.equal(response.body.locals.actividadPlataforma, null);
  } finally {
    loaded.restore();
  }
});

test('dashboard renders default admin chart set when there is no data', async () => {
  const loaded = loadDashboardRoute();

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', documento: '100' });
    const response = await request(app).get('/');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/dashboard');
    assert.equal(response.body.locals.dashboardRole, 'admin');
    assert.equal(response.body.locals.selectedChart, 'estudiantes');
    assert.equal(response.body.locals.availableCharts.length >= 1, true);
    assert.equal(response.body.locals.coberturaOperativa.totales.porcentajeCubierto, null);
    assert.equal(response.body.locals.actividadPlataforma.acciones30, 0);
  } finally {
    loaded.restore();
  }
});

test('dashboard shows operational coverage but not platform activity to coordinador general', async () => {
  const loaded = loadDashboardRoute();

  try {
    const app = buildApp(loaded.route, { tipo: 'coordinador_general', documento: '200' });
    const response = await request(app).get('/');

    assert.equal(response.status, 200);
    assert.equal(response.body.locals.coberturaOperativa.totales.facultades, 0);
    assert.equal(response.body.locals.actividadPlataforma, null);
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
  const notificationCalls = [];
  const loaded = loadDashboardRoute({
    sendEmailNotificationImpl: async (payload) => {
      notificationCalls.push(payload);
      return { status: 'SENT' };
    },
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
    assert.equal(
      clientQueries.some((sql) => sql.includes('UPDATE coordinador')),
      true
    );
    assert.equal(
      clientQueries.some((sql) => sql.includes('UPDATE laboratorista')),
      true
    );
    assert.equal(
      clientQueries.some(
        (sql) =>
          sql.includes('SELECT source, auth_document, documento_ref, usuario_id') &&
          sql.includes('COALESCE(usuario_id, 0) = $3')
      ),
      true
    );
    assert.equal(notificationCalls.length, 0);
  } finally {
    loaded.restore();
  }
});

test('dashboard admin email edit optionally notifies the user with current sanctions', async () => {
  const notificationCalls = [];
  const loaded = loadDashboardRoute({
    sendEmailNotificationImpl: async (payload) => {
      notificationCalls.push(payload);
      return { status: 'SENT' };
    },
    clientQueryImpl: async (sql, params = []) => {
      if (
        sql.includes('SELECT id, documento, correo, nombre, codigo, carrera, estado FROM usuario')
      ) {
        return {
          rows: [
            {
              id: params[0],
              documento: '1010',
              correo: 'anterior@udistrital.edu.co',
              nombre: 'Usuario Prueba',
              codigo: '20251234',
              carrera: 'Sistemas',
              estado: 'ACTIVO',
            },
          ],
        };
      }

      if (sql.includes('SELECT source, auth_document, documento_ref, usuario_id')) {
        return { rows: [] };
      }

      if (sql.includes('FROM multa') && sql.includes('usuario_sancionado_id')) {
        return {
          rows: [
            {
              id: 9,
              tipo_sancion: 'Daño de equipo',
              cat_multa: 'Equipos',
              obs_multa: 'Revisar con el laboratorio',
              fecha_multa: '2026-09-10',
              con_estado_multa: 'ACTIVA',
              laboratorio: 'Laboratorio de Física',
            },
          ],
        };
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
      .post('/usuarios/25/correo')
      .set('Accept', 'application/json')
      .send({
        correo: 'nuevo@udistrital.edu.co',
        tipoUsuario: 'estudiante',
        notificarUsuario: true,
      });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.notificacion, { status: 'SENT' });
    assert.equal(notificationCalls.length, 1);
    assert.equal(notificationCalls[0].recipient, 'nuevo@udistrital.edu.co');
    assert.equal(notificationCalls[0].templateName, 'dashboard/user-account-notification');
    assert.equal(notificationCalls[0].variables.tipoUsuario, 'estudiante');
    assert.equal(notificationCalls[0].variables.sanciones[0].tipo_sancion, 'Daño de equipo');
    assert.equal(notificationCalls[0].variables.sanciones[0].laboratorio, 'Laboratorio de Física');
    assert.equal(notificationCalls[0].variables.registrationUrl, 'https://milab.test/register');
  } finally {
    loaded.restore();
  }
});

test('dashboard admin active toggle rejects invalid boolean payload', async () => {
  const loaded = loadDashboardRoute();

  try {
    const app = buildApp(loaded.route, {
      id: 1,
      tipo: 'admin',
      documento: '100',
      roles: ['admin'],
    });

    const response = await request(app)
      .post('/usuarios/25/activo')
      .set('Accept', 'application/json')
      .send({ activo: 'talvez' });

    assert.equal(response.status, 400);
    assert.equal(response.body.ok, false);
    assert.match(response.body.message, /estado activo valido/i);
  } finally {
    loaded.restore();
  }
});

test('dashboard admin active toggle updates usuario.activo and returns new status', async () => {
  const loaded = loadDashboardRoute({
    clientQueryImpl: async (sql, params = []) => {
      if (sql.includes('SELECT id, documento, nombre, activo FROM usuario WHERE id = $1')) {
        return {
          rows: [
            {
              id: params[0],
              documento: '1010',
              nombre: 'Usuario Demo',
              activo: true,
            },
          ],
        };
      }

      if (
        sql.includes('UPDATE usuario') &&
        sql.includes('RETURNING id, documento, nombre, activo')
      ) {
        return {
          rows: [
            {
              id: params[1],
              documento: '1010',
              nombre: 'Usuario Demo',
              activo: params[0],
            },
          ],
        };
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
      .post('/usuarios/25/activo')
      .set('Accept', 'application/json')
      .send({ activo: false });

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.id, 25);
    assert.equal(response.body.activo, false);
  } finally {
    loaded.restore();
  }
});

const ADMIN_SESSION_USER = { id: 1, tipo: 'admin', documento: '100', roles: ['admin'] };

const EDITABLE_USER_ROW = {
  id: 25,
  documento: '1010',
  correo: 'estudiante@udistrital.edu.co',
  nombre: 'Estudiante Prueba',
  codigo: '20151234',
  carrera: 'Tecnologia en Sistemas',
  estado: 'EGRESADO',
  activo: true,
};

async function multiRecordOatiImpl(servicePath) {
  const value = String(servicePath);
  if (value.includes('datos_basicos_activos_cedula/1010')) {
    return {
      datosEstudianteCollection: {
        datosBasicosEstudiante: [
          { nombre: 'Estudiante Prueba', codigo: '20151234', estado: 'E', carrera: '578' },
          { nombre: 'Estudiante Prueba', codigo: '20241234', estado: 'A', carrera: '31' },
        ],
      },
    };
  }
  if (value.includes('estados_codigo/E')) return { estado: { nombre: 'EGRESADO' } };
  if (value.includes('estados_codigo/A')) return { estado: { nombre: 'ACTIVO' } };
  if (value.includes('carrera/578')) {
    return { carrerasCollection: { carrera: [{ nombre: 'Tecnologia en Sistemas' }] } };
  }
  if (value.includes('carrera/31')) {
    return { carrerasCollection: { carrera: [{ nombre: 'Ingenieria de Sistemas' }] } };
  }
  return {};
}

test('dashboard admin user editor lists every OATI record for the user document', async () => {
  const loaded = loadDashboardRoute({
    poolQueryImpl: async (sql, params = []) => {
      if (sql.includes('FROM usuario') && sql.includes('WHERE id = $1')) {
        return { rows: [{ ...EDITABLE_USER_ROW, id: params[0] }] };
      }
      return { rows: [] };
    },
    requestOatiImpl: multiRecordOatiImpl,
  });

  try {
    const app = buildApp(loaded.route, ADMIN_SESSION_USER);
    const response = await request(app)
      .get('/usuarios/25/oati-registros')
      .set('Accept', 'application/json');

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.usuario.codigo, '20151234');
    assert.deepEqual(
      response.body.registros.map(({ codigo, estado, carrera }) => ({ codigo, estado, carrera })),
      [
        { codigo: '20151234', estado: 'EGRESADO', carrera: 'Tecnologia en Sistemas' },
        { codigo: '20241234', estado: 'ACTIVO', carrera: 'Ingenieria de Sistemas' },
      ]
    );
  } finally {
    loaded.restore();
  }
});

test('dashboard admin user editor reports OATI outages without failing silently', async () => {
  const loaded = loadDashboardRoute({
    poolQueryImpl: async (sql, params = []) => {
      if (sql.includes('FROM usuario') && sql.includes('WHERE id = $1')) {
        return { rows: [{ ...EDITABLE_USER_ROW, id: params[0] }] };
      }
      return { rows: [] };
    },
    requestOatiImpl: async () => {
      throw new Error('OATI down');
    },
  });

  try {
    const app = buildApp(loaded.route, ADMIN_SESSION_USER);
    const response = await request(app)
      .get('/usuarios/25/oati-registros')
      .set('Accept', 'application/json');

    assert.equal(response.status, 502);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.usuario.documento, '1010');
  } finally {
    loaded.restore();
  }
});

test('dashboard admin user editor associates the selected OATI record keeping document and email', async () => {
  const clientCalls = [];
  const loaded = loadDashboardRoute({
    clientQueryImpl: async (sql, params = []) => {
      clientCalls.push({ sql, params });
      if (sql.includes('FROM usuario') && sql.includes('WHERE id = $1')) {
        return { rows: [{ ...EDITABLE_USER_ROW, id: params[0] }] };
      }
      if (sql.includes('UPDATE usuario') && sql.includes('RETURNING')) {
        return {
          rows: [
            {
              ...EDITABLE_USER_ROW,
              nombre: params[0],
              codigo: params[1],
              carrera: params[2],
              estado: params[3],
            },
          ],
        };
      }
      return { rows: [] };
    },
    requestOatiImpl: multiRecordOatiImpl,
  });

  try {
    const app = buildApp(loaded.route, ADMIN_SESSION_USER);
    const response = await request(app)
      .post('/usuarios/25/oati-registro')
      .set('Accept', 'application/json')
      .send({ codigo: '20241234' });

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.usuario.codigo, '20241234');
    assert.equal(response.body.usuario.estado, 'ACTIVO');
    assert.equal(response.body.usuario.carrera, 'Ingenieria de Sistemas');
    assert.equal(response.body.usuario.documento, '1010');
    assert.equal(response.body.usuario.correo, 'estudiante@udistrital.edu.co');

    const updateCall = clientCalls.find(({ sql }) => sql.includes('UPDATE usuario'));
    const setClause = updateCall.sql.split('WHERE')[0];
    assert.doesNotMatch(setClause, /correo|documento/);
    assert.deepEqual(updateCall.params, [
      'Estudiante Prueba',
      '20241234',
      'Ingenieria de Sistemas',
      'ACTIVO',
      25,
    ]);

    const profileCall = clientCalls.find(({ sql }) =>
      sql.includes('INSERT INTO perfil_estudiante')
    );
    assert.deepEqual(profileCall.params, [
      25,
      '1010',
      'Estudiante Prueba',
      '20241234',
      'Ingenieria de Sistemas',
      'ACTIVO',
    ]);
    assert.match(profileCall.sql, /codigo = EXCLUDED\.codigo/);

    const logCall = clientCalls.find(({ sql }) => sql.includes('INSERT INTO log'));
    assert.match(logCall.params[2], /20241234.*20151234/);
    assert.equal(
      clientCalls.some(({ sql }) => sql === 'COMMIT'),
      true
    );
  } finally {
    loaded.restore();
  }
});

test('dashboard admin user editor rejects codes that OATI does not return for the document', async () => {
  const clientCalls = [];
  const loaded = loadDashboardRoute({
    clientQueryImpl: async (sql, params = []) => {
      clientCalls.push(sql);
      if (sql.includes('FROM usuario') && sql.includes('WHERE id = $1')) {
        return { rows: [{ ...EDITABLE_USER_ROW, id: params[0] }] };
      }
      return { rows: [] };
    },
    requestOatiImpl: multiRecordOatiImpl,
  });

  try {
    const app = buildApp(loaded.route, ADMIN_SESSION_USER);
    const response = await request(app)
      .post('/usuarios/25/oati-registro')
      .set('Accept', 'application/json')
      .send({ codigo: '99999999' });

    assert.equal(response.status, 409);
    assert.equal(response.body.ok, false);
    assert.equal(
      clientCalls.some((sql) => sql.includes('UPDATE usuario')),
      false
    );
  } finally {
    loaded.restore();
  }
});

test('dashboard admin user editor validates the selected OATI code format', async () => {
  const loaded = loadDashboardRoute();

  try {
    const app = buildApp(loaded.route, ADMIN_SESSION_USER);
    const response = await request(app)
      .post('/usuarios/25/oati-registro')
      .set('Accept', 'application/json')
      .send({ codigo: '2024abc' });

    assert.equal(response.status, 400);
    assert.equal(response.body.ok, false);
  } finally {
    loaded.restore();
  }
});

test('dashboard resolves coordinador_general as a global consultation role', () => {
  const loaded = loadDashboardRoute();
  try {
    const { getDashboardRole, getAvailableChartIds } = loaded.route.__private;
    assert.equal(
      getDashboardRole({ roles: ['coordinador', 'coordinador_general'] }),
      'coordinador_general'
    );
    assert.equal(getDashboardRole({ roles: ['admin', 'coordinador_general'] }), 'admin');
    assert.deepEqual(getAvailableChartIds('coordinador_general'), getAvailableChartIds('admin'));
  } finally {
    loaded.restore();
  }
});

test('dashboard limitDetailRows trims detail payload and reports totals', () => {
  const loaded = loadDashboardRoute();
  try {
    const { limitDetailRows } = loaded.route.__private;
    const rows = Array.from({ length: 600 }, (_, index) => ({ id: index }));
    const { limited, meta } = limitDetailRows({ multas: rows, usuariosRegistrados: rows }, [
      'usuariosRegistrados',
    ]);
    assert.equal(limited.multas.length, 500);
    assert.equal(limited.usuariosRegistrados.length, 600);
    assert.deepEqual(meta.multas, { total: 600, shown: 500 });
  } finally {
    loaded.restore();
  }
});

test('dashboard summarizes paz y salvo certificates by validity, origin and reason', () => {
  const loaded = loadDashboardRoute();
  try {
    const { buildCertificatePazYSalvoSummary } = loaded.route.__private;
    const now = new Date('2026-05-15T12:00:00Z');
    const summary = buildCertificatePazYSalvoSummary(
      [
        {
          fecha_creacion: '2026-05-10T12:00:00Z',
          fecha_vencimiento: '2026-06-10',
          motivo_exp: 'Grado',
        },
        {
          fecha_creacion: '2026-01-10',
          fecha_vencimiento: '2026-02-10',
          motivo_exp: 'Grado',
          motivo_expedicion: 'L',
        },
      ],
      [{ fecha_creacion: '2026-05-02T12:00:00Z', motivo_exp: 'Retiro', origen_descarga: 'D' }],
      true,
      now
    );
    assert.equal(summary.estudiantes, 2);
    assert.equal(summary.docentes, 1);
    assert.equal(summary.vigentes, 1);
    assert.equal(summary.vencidos, 1);
    assert.equal(summary.emitidosMes, 2);
    assert.deepEqual(
      summary.origen.map((item) => item.value),
      [2, 1]
    );
    assert.deepEqual(summary.motivos[0], { nombre: 'Grado', total: 2 });
  } finally {
    loaded.restore();
  }
});

test('dashboard paz y salvo cards link each role to its own workflow', () => {
  const loaded = loadDashboardRoute();
  try {
    const { buildPazYSalvoCards } = loaded.route.__private;
    const indicators = {
      sanciones: {
        abiertas: 4,
        personasBloqueadas: 3,
        pendientes: 1,
        porSaldar: 1,
        desdePrestamos: 0,
        maxDias: 120,
        antiguedad: [{ value: 2 }, { value: 1 }, { value: 1 }],
      },
      reclamaciones: { pendientes: 1, maxDiasEspera: 2 },
      certificados: null,
    };
    const find = (cards, text) => cards.find((card) => card.label.includes(text));

    const coordCards = buildPazYSalvoCards('coordinador', indicators);
    assert.equal(find(coordCards, 'autorización').href, '/milab/api/aprobacion_multa');
    assert.equal(find(coordCards, 'Reclamaciones').href, null);

    const labCards = buildPazYSalvoCards('laboratorista', indicators);
    assert.equal(find(labCards, 'Reclamaciones').href, '/milab/api/sanciones/reclamaciones');
    assert.equal(find(labCards, 'más de 90').value, 1);
  } finally {
    loaded.restore();
  }
});

test('dashboard monitoring is limited to admin, coordinador general, coordinador and laboratorista', () => {
  const loaded = loadDashboardRoute();
  try {
    const dashboardGuard = loaded.requireRolesCalls.find((call) =>
      /ver el dashboard/.test(call.options?.message2 || '')
    );
    assert.deepEqual(dashboardGuard.roles, [
      'admin',
      'coordinador_general',
      'coordinador',
      'laboratorista',
    ]);
    const { getDashboardRole } = loaded.route.__private;
    assert.equal(getDashboardRole({ roles: ['estudiante'] }), '');
    assert.equal(getDashboardRole({ roles: ['docente'] }), '');
  } finally {
    loaded.restore();
  }
});

test('dashboard paz y salvo indicators respect the scope of each role', async () => {
  const loaded = loadDashboardRoute();
  try {
    const { buildPazYSalvoIndicators } = loaded.route.__private;
    const certificateRows = {
      students: [{ fecha_creacion: '2026-05-10', fecha_vencimiento: '2099-01-01' }],
      teachers: [{ fecha_creacion: '2026-05-10', origen_descarga: 'D' }],
    };
    const run = async (role, scope) => {
      const calls = [];
      const client = {
        async query(sql, params = []) {
          calls.push({ sql, params });
          if (sql.includes('FROM information_schema.columns')) {
            return { rows: [{ column_name: params[1][0] }] };
          }
          return { rows: [] };
        },
      };
      const result = await buildPazYSalvoIndicators(client, role, scope, certificateRows);
      const dataCalls = calls.filter(
        (call) => !call.sql.includes('information_schema') && call.sql.includes('FROM multa m')
      );
      const claimCall = calls.find((call) => call.sql.includes('FROM reclamacion_sancion r'));
      assert.equal(dataCalls.length, 2);
      assert.ok(claimCall);
      return { result, dataCalls, claimCall };
    };

    for (const role of ['admin', 'coordinador_general']) {
      const { result, dataCalls, claimCall } = await run(role, {});
      dataCalls.forEach((call) => assert.match(call.sql, /AND TRUE/));
      assert.match(claimCall.sql, /WHERE TRUE/);
      assert.deepEqual(
        result.rankingGroups.map((group) => group.title),
        ['Facultades', 'UAL']
      );
      assert.equal(result.certificados.docentes, 1);
    }

    const coordinator = await run('coordinador', { facultyIds: [10, 11] });
    coordinator.dataCalls.forEach((call) => {
      assert.match(call.sql, /u\.facultad_id = ANY\(\$1::int\[\]\)/);
      assert.deepEqual(call.params[0], [10, 11]);
    });
    assert.match(coordinator.claimCall.sql, /u\.facultad_id = ANY\(\$1::int\[\]\)/);
    assert.deepEqual(coordinator.claimCall.params, [[10, 11]]);
    assert.deepEqual(
      coordinator.result.rankingGroups.map((group) => group.title),
      ['Dependencias', 'UAL']
    );
    assert.equal(coordinator.result.certificados.docentes, null);
    assert.equal(coordinator.result.certificados.estudiantes, 1);

    const lab = await run('laboratorista', { ualIds: [7], laboratoristaDocument: '555' });
    lab.dataCalls.forEach((call) => {
      assert.match(call.sql, /m\.ual_id = ANY\(\$1::int\[\]\)/);
      assert.deepEqual(call.params[0], [7]);
    });
    assert.match(lab.claimCall.sql, /r\.responsable_documento_id = \$1/);
    assert.deepEqual(lab.claimCall.params, ['555']);
    assert.deepEqual(
      lab.result.rankingGroups.map((group) => group.title),
      ['UAL']
    );
    assert.equal(lab.result.certificados, null);
    assert.equal(
      lab.result.cards.some((card) => /Paz y salvos vigentes/.test(card.label)),
      false
    );
  } finally {
    loaded.restore();
  }
});

test('dashboard renders paz y salvo indicators for coordinador_general', async () => {
  const loaded = loadDashboardRoute({
    clientQueryImpl: async (sql, params = []) => {
      if (sql.includes('FROM information_schema.columns')) {
        return { rows: [{ column_name: params[1][0] }] };
      }
      if (sql.includes('AS personas_bloqueadas')) {
        return {
          rows: [
            {
              abiertas: 3,
              personas_bloqueadas: 2,
              activas: 1,
              pendientes: 1,
              por_saldar: 1,
              hasta_30: 1,
              de_31_a_90: 1,
              mas_90: 1,
              max_dias: 140,
              desde_prestamos: 1,
            },
          ],
        };
      }
      if (sql.includes('AS dependencia_nombre')) {
        return {
          rows: [
            {
              ual_id: 7,
              ual_nombre: 'Lab Física',
              dependencia_id: 50,
              dependencia_nombre: 'Laboratorios Ciencias',
              padre_id: 41,
              facultad_id: 41,
              facultad_nombre: 'FACULTAD DE CIENCIAS MATEMATICAS Y NATURALES',
              abiertas: 3,
            },
          ],
        };
      }
      if (sql.includes('FROM reclamacion_sancion r')) {
        return {
          rows: [
            {
              total: 4,
              pendientes: 1,
              max_dias_espera: 3,
              procede: 1,
              no_procede: 2,
              horas_promedio: '12.5',
            },
          ],
        };
      }
      return { rows: [] };
    },
  });

  try {
    const app = buildApp(loaded.route, {
      tipo: 'coordinador_general',
      roles: ['coordinador_general'],
      documento: '300',
    });
    const response = await request(app).get('/');

    assert.equal(response.status, 200);
    const { locals } = response.body;
    assert.equal(locals.dashboardRole, 'coordinador_general');
    assert.equal(locals.pazYSalvo.sanciones.personasBloqueadas, 2);
    assert.equal(locals.pazYSalvo.sanciones.desdePrestamos, 1);
    assert.equal(locals.pazYSalvo.reclamaciones.tasaProcede, 33);
    assert.equal(locals.pazYSalvo.reclamaciones.horasPromedio, 12.5);
    assert.equal('cobertura' in locals.pazYSalvo, false);
    assert.equal(
      locals.pazYSalvo.cards.some((card) => card.label.includes('UAL sin laboratorista')),
      false
    );
    assert.deepEqual(
      locals.pazYSalvo.rankingGroups.map((group) => group.title),
      ['Facultades', 'UAL']
    );
    assert.equal(
      locals.pazYSalvo.rankingGroups[0].items[0].nombre,
      'FACULTAD DE CIENCIAS MATEMATICAS Y NATURALES'
    );
  } finally {
    loaded.restore();
  }
});

test('dashboard scopes coordinator certificates by the faculty encoded in the student code', async () => {
  const loaded = loadDashboardRoute({
    poolQueryImpl: async (sql) => {
      if (sql.includes('FROM certificado_estudiante ce')) {
        return {
          rows: [
            { id: 1, fecha_creacion: new Date().toISOString(), codigo_usuario: '20231077001' },
            { id: 2, fecha_creacion: new Date().toISOString(), codigo_usuario: '20231005001' },
          ],
        };
      }
      return { rows: [] };
    },
    clientQueryImpl: async (sql, params = []) => {
      if (sql.includes('FROM information_schema.columns')) {
        return { rows: [{ column_name: params[1][0] }] };
      }
      if (sql.includes('FROM dependencia_facultad') && sql.includes('= ANY($1::int[])')) {
        return { rows: [{ nombre: 'FACULTAD DE TECNOLOGIA - POLITECNICA / TECNOLOGICA' }] };
      }
      return { rows: [] };
    },
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'coordinador', documento: 'coord-user' });
    const response = await request(app).get('/');

    assert.equal(response.status, 200);
    assert.equal(response.body.locals.pazYSalvo.certificados.estudiantes, 1);
    assert.equal('certificadosEstudiantes' in response.body.locals.tablesData, false);
  } finally {
    loaded.restore();
  }
});

test('dashboard laboratorista scope reads the UAL faculty column from ual', async () => {
  const ualQueries = [];
  const loaded = loadDashboardRoute({
    clientQueryImpl: async (sql, params = []) => {
      if (sql.includes('FROM information_schema.columns')) {
        return { rows: [{ column_name: params[1][0] }] };
      }
      if (sql.includes('FROM laboratorista WHERE')) {
        return { rows: [{ documento: '123' }] };
      }
      if (sql.includes('FROM laboratorista_ual') && !sql.includes('EXISTS')) {
        return { rows: [{ ual_id: 7 }] };
      }
      if (/FROM ual\s+WHERE/.test(sql)) {
        ualQueries.push(sql);
        return { rows: [{ ual_id: 7, nombre: 'Lab Física', facultad_id: 50 }] };
      }
      return { rows: [] };
    },
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'laboratorista', documento: '123' });
    const response = await request(app).get('/');

    assert.equal(response.status, 200);
    assert.equal(response.body.locals.dashboardRole, 'laboratorista');
    assert.match(ualQueries[0], /facultad_id AS facultad_id/);
    assert.doesNotMatch(ualQueries[0], /dependencia_facultad_id/);
  } finally {
    loaded.restore();
  }
});

test('dashboard general overview builds platform charts without sanctions or certificates', () => {
  const { route } = loadDashboardRoute();
  const { buildGeneralOverview, getAvailableChartIds } = route.__private;
  const now = new Date(2026, 4, 15);
  const rows = {
    estudiantes: [
      { carrera: 'Sistemas', estado: 'ACTIVO', fecha_creacion: new Date(2026, 4, 5) },
      { carrera: '', estado: 'egresado', fecha_creacion: new Date(2026, 3, 5) },
    ],
    docentes: [{ estado: '', fecha_creacion: new Date(2025, 4, 5) }],
    laboratoristas: [
      { activo: true, fecha_creacion: new Date(2025, 1, 1) },
      { activo: false, fecha_creacion: new Date(2025, 1, 1) },
    ],
    coordinadores: [],
    usuariosRegistrados: [{ fecha_creacion: new Date(2026, 4, 2) }],
  };

  for (const role of ['admin', 'coordinador_general', 'coordinador', 'laboratorista']) {
    assert.equal(
      getAvailableChartIds(role).some(
        (id) => id.startsWith('sanciones') || id.startsWith('certificados')
      ),
      false,
      `${role} no debe ver sanciones ni paz y salvos en Toda la plataforma`
    );
  }

  const overview = buildGeneralOverview(getAvailableChartIds('admin'), rows, now);

  assert.deepEqual(overview.hints, {
    estudiantes: '1 nuevos este mes',
    docentes: '0 nuevos este mes',
    laboratoristas: '1 activos de 2',
    coordinadores: '0 nuevos este mes',
    usuariosRegistrados: '1 nuevos este mes',
  });
  assert.equal(overview.actividad.labels.length, 12);
  assert.deepEqual(
    overview.actividad.datasets.map((dataset) => [
      dataset.key,
      dataset.data.reduce((a, b) => a + b, 0),
    ]),
    [
      ['estudiantes', 2],
      ['docentes', 0],
      ['laboratoristas', 0],
      ['coordinadores', 0],
    ]
  );
  assert.deepEqual(
    overview.usuarios.map((item) => [item.key, item.value]),
    [
      ['estudiantes', 2],
      ['docentes', 1],
      ['laboratoristas', 2],
      ['coordinadores', 0],
    ]
  );
  assert.deepEqual(
    overview.programas.map((item) => item.nombre),
    ['Sin programa', 'Sistemas']
  );
  assert.deepEqual(overview.estadosCuenta, [
    { nombre: 'ACTIVO', total: 2 },
    { nombre: 'EGRESADO', total: 1 },
  ]);
  assert.deepEqual(
    overview.laboratoristasEstado.map((item) => item.value),
    [1, 1]
  );

  const labOverview = buildGeneralOverview(getAvailableChartIds('laboratorista'), rows, now);
  assert.equal(labOverview.usuarios, null);
  assert.equal(labOverview.programas, null);
  assert.equal(labOverview.estadosCuenta, null);
  assert.deepEqual(
    labOverview.actividad.datasets.map((dataset) => dataset.key),
    ['laboratoristas']
  );
  assert.deepEqual(Object.keys(labOverview).sort(), [
    'actividad',
    'estadosCuenta',
    'hints',
    'laboratoristasEstado',
    'programas',
    'usuarios',
  ]);
});

test('dashboard operational coverage groups UAL and staff by root faculty', async () => {
  const { fetchOperationalCoverage } = require(routePath).__private;
  const client = {
    async query(sql) {
      if (sql.includes('WHERE padre_id IS NULL')) {
        return {
          rows: [
            { facultad_id: 1, nombre: 'Ingeniería' },
            { facultad_id: 2, nombre: 'Artes' },
          ],
        };
      }
      if (sql.includes('AS ual_activas')) {
        return {
          rows: [
            { facultad_id: 1, ual_activas: 4, ual_con_laboratorista: 3 },
            { facultad_id: 2, ual_activas: 6, ual_con_laboratorista: 0 },
          ],
        };
      }
      if (sql.includes('COUNT(DISTINCT l.documento)')) {
        return { rows: [{ facultad_id: 1, total: 2 }] };
      }
      if (sql.includes('COUNT(DISTINCT c.documento)')) {
        return { rows: [{ facultad_id: 1, total: 1 }] };
      }
      return {
        rows: [{ laboratoristas: 5, coordinadores: 2, monitores: 3, monitores_por_vencer: 1 }],
      };
    },
  };

  const coverage = await fetchOperationalCoverage(client, new Date('2026-05-15T12:00:00Z'));

  assert.deepEqual(coverage.totales, {
    facultades: 2,
    ualActivas: 10,
    ualConLaboratorista: 3,
    porcentajeCubierto: 30,
    laboratoristas: 5,
    coordinadores: 2,
    monitores: 3,
    monitoresPorVencer: 1,
  });
  assert.deepEqual(
    coverage.facultades.map((item) => [item.nombre, item.ualActivas, item.laboratoristas]),
    [
      ['Artes', 6, 0],
      ['Ingeniería', 4, 2],
    ]
  );
  assert.equal(coverage.facultadesSinCoordinador, 1);
});

test('dashboard platform activity summarizes the audit log', async () => {
  const { fetchPlatformActivity } = require(routePath).__private;
  const client = {
    async query(sql) {
      if (sql.includes("to_char(fecha_creacion, 'YYYY-MM')")) {
        return {
          rows: [
            { mes: '2026-05', total: 7 },
            { mes: '2025-01', total: 99 },
          ],
        };
      }
      if (sql.includes('AS acciones_30')) {
        return { rows: [{ acciones_30: 15, acciones_previas: 10, actores_30: 4 }] };
      }
      if (sql.includes('regexp_replace')) {
        return {
          rows: [
            { accion: 'agregar facultad', total: 3 },
            { accion: 'crear sanción', total: 2 },
            { accion: '', total: 1 },
          ],
        };
      }
      if (sql.includes('AS rol')) {
        return {
          rows: [
            { rol: 'admin', total: 4 },
            { rol: 'laboratorista', total: 5 },
            { rol: 'sistema', total: 1 },
          ],
        };
      }
      if (sql.includes('ISODOW')) {
        return {
          rows: [
            { dia: 1, total: 6 },
            { dia: 7, total: 2 },
          ],
        };
      }
      return { rows: [{ nombre: 'Ana', total: 9 }] };
    },
  };

  const activity = await fetchPlatformActivity(client, new Date('2026-05-15T12:00:00Z'));

  assert.equal(activity.acciones30, 15);
  assert.equal(activity.actores30, 4);
  assert.equal(activity.variacion, 50);
  assert.equal(activity.mensual.data.length, 12);
  assert.equal(activity.mensual.data[11], 7);
  assert.equal(
    activity.mensual.data.reduce((sum, value) => sum + value, 0),
    7
  );
  assert.deepEqual(
    activity.acciones.map((item) => item.nombre),
    ['Agregar facultad', 'Crear sanción', 'Sin descripción']
  );
  assert.deepEqual(activity.roles, [
    { nombre: 'Laboratorista', total: 5 },
    { nombre: 'Administrador', total: 4 },
    { nombre: 'Otros', total: 1 },
  ]);
  assert.deepEqual(activity.semana.data, [6, 0, 0, 0, 0, 0, 2]);
  assert.deepEqual(activity.actores, [{ nombre: 'Ana', total: 9 }]);
});
