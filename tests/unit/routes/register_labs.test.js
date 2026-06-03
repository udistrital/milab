const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/register_labs.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const oatiClientPath = path.resolve(__dirname, '../../../src/libs/oati-client.js');
const mailPath = path.resolve(__dirname, '../../../src/libs/mail.js');
const emailLayoutPath = path.resolve(__dirname, '../../../src/libs/email-layout.js');
const facultyScopePath = path.resolve(__dirname, '../../../src/libs/faculty-scope.js');
const appUrlPath = path.resolve(__dirname, '../../../src/libs/app-url.js');
const registrationTokenPath = path.resolve(__dirname, '../../../src/libs/registration-token.js');
const limiterPath = path.resolve(__dirname, '../../../src/routes/middlewares/limiter.js');
const securityLoggerPath = path.resolve(
  __dirname,
  '../../../src/routes/middlewares/security-logger.js'
);
const authPath = path.resolve(__dirname, '../../../src/routes/middlewares/auth.js');

function buildApp(route, sessionUser, extraSession = {}) {
  const app = express();

  app.use((req, res, next) => {
    req.session = {
      user: sessionUser,
      ...extraSession,
    };
    res.render = (view, locals) => res.status(res.statusCode || 200).json({ view, locals });
    next();
  });
  app.use('/', route);

  return app;
}

function loadRoute({ scopeImpl, poolQueryImpl } = {}) {
  const originals = new Map();
  const stubs = [
    [
      dbPath,
      {
        query: async (sql, params = []) => {
          if (typeof poolQueryImpl === 'function') {
            return poolQueryImpl(sql, params);
          }

          return { rows: [] };
        },
        connect: async () => ({
          query: async () => ({ rows: [], rowCount: 1 }),
          release() {},
        }),
      },
    ],
    [
      oatiClientPath,
      {
        getAcademicServicePath: (v) => v,
        requestOati: async () => ({}),
      },
    ],
    [mailPath, { sendMail: async () => {} }],
    [
      emailLayoutPath,
      {
        buildBrandedEmailAttachments: () => [],
        buildEmailFooterHtml: () => '',
        buildEmailHeaderHtml: () => '',
        escapeHtml: (v) => v,
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
      appUrlPath,
      {
        appBaseUrl: 'https://labs.udistrital.edu.co/milab',
        buildAppUrl: (v) => v,
      },
    ],
    [registrationTokenPath, { getRegistrationTokenSecret: () => 'secret' }],
    [limiterPath, (req, res, next) => next()],
    [securityLoggerPath, { securityLogger: (req, res, next) => next() }],
    [
      authPath,
      {
        requireRoles: () => (req, res, next) => next(),
        requireUser: () => (req, res, next) => next(),
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

test('register_labs new denies access without token grant or privileged role', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, { tipo: 'estudiante', documento: '1' });
    const response = await request(app).get('/new');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.equal(response.body.locals.limit, 'noSession');
  } finally {
    loaded.restore();
  }
});

test('register_labs load_info shows coordinator error when no faculties are associated', async () => {
  const loaded = loadRoute({
    scopeImpl: async () => ({ coordinatorDocument: null, facultyIds: [] }),
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'coordinador', documento: 'coord-user' });
    const response = await request(app).get('/load_info');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.match(response.body.locals.message2, /No se encontró información del coordinador/i);
  } finally {
    loaded.restore();
  }
});

test('register_labs post validates selected faculty and labs before querying persistence', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', documento: '1024467835' });
    const response = await request(app).post('/').type('form').send({
      nombre: 'Laboratorista Test',
      documento: '12345',
      correo: 'laboratorista@udistrital.edu.co',
      contrato: 'CPS',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/register_labs');
    assert.match(response.body.locals.error, /seleccionar una facultad y al menos un laboratorio/i);
  } finally {
    loaded.restore();
  }
});
