const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/estudiantes_registrados.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const accountEmailPath = path.resolve(__dirname, '../../../src/libs/account-email.js');
const facultyScopePath = path.resolve(__dirname, '../../../src/libs/faculty-scope.js');
const authPath = path.resolve(__dirname, '../../../src/routes/middlewares/auth.js');
const errorHandlerPath = path.resolve(
  __dirname,
  '../../../src/routes/middlewares/error-handler.js'
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

function loadRoute({
  connectQueryImpl,
  facultyNamesImpl,
  findConflictImpl,
  resolveAcademicFacultyNameImpl,
} = {}) {
  const originals = new Map();
  const clientCalls = [];

  const client = {
    async query(sql, params = []) {
      clientCalls.push({ sql, params });
      if (typeof connectQueryImpl === 'function') {
        return connectQueryImpl(sql, params);
      }

      if (sql.includes('FROM usuario u') && sql.includes('GROUP BY u.id')) {
        return {
          rows: [
            {
              con_nombre: 'Estudiante Demo',
              con_tipo: 'estudiante',
              con_documento: '12345',
              con_codigo: '20241001',
              con_carrera: 'Ingenieria',
              con_estado: 'ACTIVO',
              con_correo: 'estudiante@udistrital.edu.co',
            },
          ],
        };
      }

      if (sql.includes('WHERE u.documento = $1')) {
        return {
          rows: [
            {
              documento: '12345',
              nombre: 'Estudiante Demo',
              correo: 'estudiante@udistrital.edu.co',
              carrera: 'Ingenieria',
              tipo: 'estudiante',
            },
          ],
        };
      }

      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }

      if (sql.includes('SELECT documento FROM coordinador WHERE nombre_u = $1')) {
        return { rows: [{ documento: '900' }] };
      }

      return { rows: [] };
    },
    release() {},
  };

  const stubs = [
    [dbPath, { connect: async () => client }],
    [
      accountEmailPath,
      {
        findEmailConflict: findConflictImpl || (async () => null),
        isInstitutionalEmail: (correo) => /@udistrital\.edu\.co$/i.test(String(correo || '')),
        isUniqueViolation: () => false,
        normalizeLogDocument: (value) => value,
        normalizeInstitutionalEmail: (value) =>
          String(value || '')
            .trim()
            .toLowerCase(),
      },
    ],
    [
      facultyScopePath,
      {
        resolveAcademicFacultyName: resolveAcademicFacultyNameImpl || (() => 'Ingenieria'),
        resolveCoordinatorFacultyNames: facultyNamesImpl || (async () => ['Ingenieria']),
      },
    ],
    [
      authPath,
      {
        requireJsonRoles: () => (req, res, next) => next(),
        requireRoles: () => (req, res, next) => next(),
      },
    ],
    [
      errorHandlerPath,
      {
        wantsJson: () => false,
        renderApplicationError: (res, payload) => res.status(payload.status || 500).json(payload),
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

test('estudiantes_registrados exports an Express router with handlers', () => {
  delete require.cache[routePath];
  const router = require(routePath);

  assert.equal(typeof router, 'function');
  assert.equal(typeof router.use, 'function');
  assert.equal(Array.isArray(router.stack), true);
  assert.equal(router.stack.length > 0, true);
});

test('estudiantes_registrados blocks coordinador without associated faculties', async () => {
  const loaded = loadRoute({ facultyNamesImpl: async () => [] });

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

test('estudiantes_registrados actualizar-correo rejects edits outside coordinator scope', async () => {
  const loaded = loadRoute({
    facultyNamesImpl: async () => ['Otra Facultad'],
    resolveAcademicFacultyNameImpl: () => 'Ingenieria',
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'coordinador', documento: 'coord-user' });
    const response = await request(app)
      .post('/actualizar-correo')
      .type('form')
      .send({ documento: '12345', correo: 'nuevo@udistrital.edu.co' });

    assert.equal(response.status, 403);
    assert.match(response.body.message, /No tienes permisos para editar el correo/i);
  } finally {
    loaded.restore();
  }
});

test('estudiantes_registrados actualizar-correo updates an allowed user email', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', documento: '100' });
    const response = await request(app)
      .post('/actualizar-correo')
      .type('form')
      .send({ documento: '12345', correo: 'nuevo@udistrital.edu.co' });

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(
      loaded.getClientCalls().some((call) => call.sql.includes('UPDATE usuario SET correo = $1')),
      true
    );
  } finally {
    loaded.restore();
  }
});
