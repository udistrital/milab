const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/register_monitor.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const oatiClientPath = path.resolve(__dirname, '../../../src/libs/oati-client.js');
const facultyScopePath = path.resolve(__dirname, '../../../src/libs/faculty-scope.js');
const operationalRoleAssignmentsPath = path.resolve(
  __dirname,
  '../../../src/libs/operational-role-assignments.js'
);
const monitorRegistryPath = path.resolve(__dirname, '../../../src/libs/monitor-registry.js');
const permissionsPath = path.resolve(__dirname, '../../../src/libs/permissions.js');
const userIdentityPath = path.resolve(__dirname, '../../../src/libs/user-identity.js');
const authPath = path.resolve(__dirname, '../../../src/routes/middlewares/auth.js');
const limiterPath = path.resolve(__dirname, '../../../src/routes/middlewares/limiter.js');
const securityLoggerPath = path.resolve(
  __dirname,
  '../../../src/routes/middlewares/security-logger.js'
);

function buildApp(route, sessionUser) {
  const app = express();

  app.use((req, res, next) => {
    req.session = { user: sessionUser };
    res.render = (view, locals) => res.status(res.statusCode || 200).json({ view, locals });
    next();
  });
  app.use('/', route);

  return app;
}

function loadRoute({ poolQueryImpl, connectQueryImpl, requestOatiImpl, scopeImpl } = {}) {
  const originals = new Map();
  const poolCalls = [];
  const clientCalls = [];

  const client = {
    async query(sql, params = []) {
      clientCalls.push({ sql, params });
      if (typeof connectQueryImpl === 'function') {
        return connectQueryImpl(sql, params);
      }

      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }

      if (sql.includes('SELECT r.nombre')) {
        return { rows: [] };
      }

      return { rows: [] };
    },
    release() {},
  };

  const stubs = [
    [
      dbPath,
      {
        query: async (sql, params = []) => {
          poolCalls.push({ sql, params });
          if (typeof poolQueryImpl === 'function') {
            return poolQueryImpl(sql, params);
          }

          if (sql.includes('SELECT documento FROM coordinador WHERE documento = $1 LIMIT 1')) {
            return { rows: [{ documento: params[0] }] };
          }

          if (
            sql.includes(
              'SELECT facultad_id FROM coordinador_facultad WHERE coordinador_documento_id = $1'
            )
          ) {
            return { rows: [{ facultad_id: 10 }] };
          }

          if (sql.includes('SELECT * FROM facultad WHERE facultad_id = ANY($1::int[])')) {
            return { rows: [{ facultad_id: 10, nombre: 'Facultad 10' }] };
          }

          if (sql.includes('FROM ual WHERE activo = TRUE AND facultad_id = ANY($1::int[])')) {
            return { rows: [{ ual_id: 11, nombre: 'Lab 11', facultad_id: 10, activo: true }] };
          }

          if (sql.includes('SELECT ual_id FROM ual WHERE activo = TRUE AND facultad_id = $1')) {
            return { rows: [{ ual_id: 11 }] };
          }

          if (
            sql.includes(
              'SELECT ual_id FROM ual WHERE activo = TRUE AND facultad_id = $1 AND ual_id = ANY($2::int[])'
            )
          ) {
            return { rows: [{ ual_id: 11 }] };
          }

          if (sql.includes('SELECT c.documento,')) {
            return {
              rows: [{ documento: '900', nombre: 'Coordinador Demo', facultades: 'Facultad 10' }],
            };
          }

          return { rows: [] };
        },
        connect: async () => client,
      },
    ],
    [
      oatiClientPath,
      {
        getAcademicServicePath: (value) => value,
        requestOati:
          requestOatiImpl ||
          (async () => ({
            datosEstudianteCollection: {
              datosBasicosEstudiante: [
                {
                  estado: 'A',
                  nombre: 'Monitor Estudiante',
                  correo: 'monitor@udistrital.edu.co',
                  codigo: '20241001',
                  proyecto_curricular: 'Ingenieria',
                },
              ],
            },
          })),
      },
    ],
    [
      facultyScopePath,
      {
        resolveCoordinatorScope:
          scopeImpl || (async () => ({ coordinatorDocument: '900', facultyIds: [10] })),
      },
    ],
    [
      operationalRoleAssignmentsPath,
      {
        ensureOperationalRoleAssignmentsSchema: async () => {},
        replaceOperationalRoleAssignments: async () => {},
      },
    ],
    [
      monitorRegistryPath,
      {
        ensureMonitorSchema: async () => {},
        fetchMonitorByDocumento: async () => null,
        upsertMonitorProfile: async () => {},
      },
    ],
    [permissionsPath, { APP_PERMISSIONS: { USERS_MONITOR_MANAGE: 'users.monitor.manage' } }],
    [userIdentityPath, { ensurePerfilEstudiante: async () => 77 }],
    [authPath, { requirePermissions: () => (req, res, next) => next() }],
    [limiterPath, (req, res, next) => next()],
    [securityLoggerPath, { securityLogger: (req, res, next) => next() }],
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
    getPoolCalls: () => poolCalls,
    getClientCalls: () => clientCalls,
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

test('register_monitor load_info rejects invalid document format before OATI lookup', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, { tipo: 'coordinador', documento: 'coord-user' });
    const response = await request(app).get('/load_info').query({ documento: 'abc' });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/register_monitor');
    assert.match(response.body.locals.lookupMessage, /documento valido/i);
  } finally {
    loaded.restore();
  }
});

test('register_monitor post rejects non institutional email', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, { tipo: 'coordinador', documento: 'coord-user' });
    const response = await request(app)
      .post('/')
      .type('form')
      .send({
        documento: '12345',
        correo: 'monitor@gmail.com',
        numero_contrato: 'CPS-01',
        facultad_id: '10',
        ual_ids: ['11'],
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/register_monitor');
    assert.match(response.body.locals.error, /Solo se permiten correos institucionales/i);
  } finally {
    loaded.restore();
  }
});

test('register_monitor post requires coordinator selection for admin users', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', documento: '100', id: 5 });
    const response = await request(app)
      .post('/')
      .type('form')
      .send({
        documento: '12345',
        correo: 'monitor@udistrital.edu.co',
        numero_contrato: 'CPS-01',
        facultad_id: '10',
        ual_ids: ['11'],
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/register_monitor');
    assert.match(response.body.locals.error, /seleccionar el coordinador responsable/i);
  } finally {
    loaded.restore();
  }
});

test('register_monitor post rejects labs outside the selected faculty', async () => {
  const loaded = loadRoute({
    poolQueryImpl: async (sql, params = []) => {
      if (sql.includes('SELECT documento FROM coordinador WHERE documento = $1 LIMIT 1')) {
        return { rows: [{ documento: params[0] }] };
      }

      if (
        sql.includes(
          'SELECT facultad_id FROM coordinador_facultad WHERE coordinador_documento_id = $1'
        )
      ) {
        return { rows: [{ facultad_id: 10 }] };
      }

      if (
        sql.includes(
          'SELECT ual_id FROM ual WHERE activo = TRUE AND facultad_id = $1 AND ual_id = ANY($2::int[])'
        )
      ) {
        return { rows: [] };
      }

      return { rows: [] };
    },
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', documento: '100', id: 5 });
    const response = await request(app)
      .post('/')
      .type('form')
      .send({
        documento: '12345',
        correo: 'monitor@udistrital.edu.co',
        numero_contrato: 'CPS-01',
        facultad_id: '10',
        ual_ids: ['11'],
        coordinador_documento: '900',
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/register_monitor');
    assert.match(response.body.locals.error, /laboratorios seleccionados deben pertenecer/i);
  } finally {
    loaded.restore();
  }
});

test('register_monitor post persists a valid monitor registration flow', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', documento: '100', id: 5 });
    const response = await request(app)
      .post('/')
      .type('form')
      .send({
        documento: '12345',
        correo: 'monitor@udistrital.edu.co',
        numero_contrato: 'CPS-01',
        facultad_id: '10',
        ual_ids: ['11'],
        coordinador_documento: '900',
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/register_monitor');
    assert.match(
      response.body.locals.successMessage,
      /Monitor registrado o actualizado correctamente/i
    );

    const clientCalls = loaded.getClientCalls();
    assert.equal(
      clientCalls.some((call) => call.sql === 'BEGIN'),
      true
    );
    assert.equal(
      clientCalls.some((call) =>
        call.sql.includes('INSERT INTO log (nombre, documento, accion, persona)')
      ),
      true
    );
    assert.equal(
      clientCalls.some((call) => call.sql === 'COMMIT'),
      true
    );
  } finally {
    loaded.restore();
  }
});
