const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/register.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const mailPath = path.resolve(__dirname, '../../../src/libs/mail.js');
const emailLayoutPath = path.resolve(__dirname, '../../../src/libs/email-layout.js');
const userIdentityPath = path.resolve(__dirname, '../../../src/libs/user-identity.js');
const limiterPath = path.resolve(__dirname, '../../../src/routes/middlewares/limiter.js');
const securityLoggerPath = path.resolve(
  __dirname,
  '../../../src/routes/middlewares/security-logger.js'
);
const errorHandlerPath = path.resolve(
  __dirname,
  '../../../src/routes/middlewares/error-handler.js'
);

function buildApp(route, sessionState) {
  const app = express();

  app.use((req, res, next) => {
    req.session = sessionState;
    res.render = (view, locals) => res.status(res.statusCode || 200).json({ view, locals });
    next();
  });

  app.use(express.urlencoded({ extended: true }));
  app.use('/', route);
  return app;
}

function loadRegisterRoute({ poolQueryImpl, userIdentityStub } = {}) {
  const originals = new Map();
  const stubs = [
    [
      dbPath,
      {
        query: async (sql, params = []) => {
          if (typeof poolQueryImpl === 'function') {
            return poolQueryImpl(sql, params);
          }
          return { rows: [], rowCount: 0 };
        },
      },
    ],
    [mailPath, { sendMail: async () => {} }],
    [
      emailLayoutPath,
      {
        buildBrandedEmailAttachments: () => [],
        buildEmailFooterHtml: () => '',
        buildEmailHeaderHtml: () => '',
        escapeHtml: (value) => String(value || ''),
      },
    ],
    [
      userIdentityPath,
      userIdentityStub || {
        isPlaceholderEmail: (correo) => String(correo || '').endsWith('@placeholder.milab.local'),
        isSyntheticInstitutionalEmail: (correo, documento) =>
          String(correo || '').toLowerCase() ===
          `${String(documento || '').toLowerCase()}@udistrital.edu.co`,
      },
    ],
    [limiterPath, (req, res, next) => next()],
    [securityLoggerPath, { securityLogger: (req, res, next) => next() }],
    [
      errorHandlerPath,
      {
        renderApplicationError: (res, payload) => res.status(payload.status || 500).json(payload),
        wantsJson: () => false,
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

test('register exports an Express router with handlers', () => {
  delete require.cache[routePath];
  const router = require(routePath);

  assert.equal(typeof router, 'function');
  assert.equal(typeof router.use, 'function');
  assert.equal(Array.isArray(router.stack), true);
  assert.equal(router.stack.length > 0, true);
});

test('email_verification promotes placeholder account by documento and allows first-time registration', async () => {
  let updateCalled = false;

  const loaded = loadRegisterRoute({
    poolQueryImpl: async (sql, params = []) => {
      if (sql === 'SELECT * FROM usuario WHERE documento=$1 OR correo=$2') {
        return {
          rows: [
            {
              documento: '1000586756',
              correo: 'no-email+1000586756@placeholder.milab.local',
            },
          ],
          rowCount: 1,
        };
      }

      if (sql.includes('UPDATE usuario') && sql.includes('SET correo = $1')) {
        updateCalled = true;
        assert.equal(params[0], 'michael.gutierrez@udistrital.edu.co');
        assert.equal(params[1], '1000586756');
        return { rowCount: 1, rows: [] };
      }

      return { rows: [], rowCount: 0 };
    },
  });

  const sessionState = {
    studentData: {
      con_documento_completo: '1000586756',
      con_codigo_completo: '20251377015',
      con_nombre_completo: 'GUTIERREZ ALVAREZ MICHAEL STIVEN',
      con_estado_completo: 'ACTIVO',
      con_carrera_completa: 'INGENIERIA DE PRODUCCION (CICLOS PROPEDEUTICOS)',
    },
  };

  try {
    const app = buildApp(loaded.route, sessionState);
    const response = await request(app).post('/email_verification').type('form').send({
      tipo_usuario: 'estudiante',
      correo: 'michael.gutierrez@udistrital.edu.co',
      password: 'Abcd1234!',
      confirmar_password: 'Abcd1234!',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/email_verification');
    assert.equal(response.body.locals.correo, 'michael.gutierrez@udistrital.edu.co');
    assert.equal(updateCalled, true);
    assert.equal(sessionState.usuario_no_verificado.documento, '1000586756');
    assert.equal(sessionState.usuario_no_verificado.correo, 'michael.gutierrez@udistrital.edu.co');
  } finally {
    loaded.restore();
  }
});

test('email_verification also promotes placeholder account for docente registration', async () => {
  let updateCalled = false;

  const loaded = loadRegisterRoute({
    poolQueryImpl: async (sql, params = []) => {
      if (sql === 'SELECT * FROM usuario WHERE documento=$1 OR correo=$2') {
        return {
          rows: [
            {
              documento: '80500123',
              correo: 'no-email+80500123@placeholder.milab.local',
            },
          ],
          rowCount: 1,
        };
      }

      if (sql.includes('UPDATE usuario') && sql.includes('SET correo = $1')) {
        updateCalled = true;
        assert.equal(params[0], 'docente.prueba@udistrital.edu.co');
        assert.equal(params[1], '80500123');
        return { rowCount: 1, rows: [] };
      }

      return { rows: [], rowCount: 0 };
    },
  });

  const sessionState = {
    teacherData: {
      con_documento_completo: '80500123',
      con_nombre_completo: 'DOCENTE PRUEBA',
      con_estado_completo: 'ACTIVO',
    },
  };

  try {
    const app = buildApp(loaded.route, sessionState);
    const response = await request(app).post('/email_verification').type('form').send({
      tipo_usuario: 'docente',
      correo: 'docente.prueba@udistrital.edu.co',
      password: 'Abcd1234!',
      confirmar_password: 'Abcd1234!',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/email_verification');
    assert.equal(response.body.locals.correo, 'docente.prueba@udistrital.edu.co');
    assert.equal(updateCalled, true);
    assert.equal(sessionState.usuario_no_verificado.documento, '80500123');
    assert.equal(sessionState.usuario_no_verificado.correo, 'docente.prueba@udistrital.edu.co');
    assert.equal(sessionState.usuario_no_verificado.tipo, 'docente');
  } finally {
    loaded.restore();
  }
});

test('email_verification continues for pending no-email records even when pre-update affects zero rows', async () => {
  const loaded = loadRegisterRoute({
    poolQueryImpl: async (sql, params = []) => {
      if (sql === 'SELECT * FROM usuario WHERE documento=$1 OR correo=$2') {
        return {
          rows: [
            {
              documento: '1000586756',
              correo: 'no-email+1000586756@placeholder.milab.local',
            },
          ],
          rowCount: 1,
        };
      }

      if (sql.includes('UPDATE usuario') && sql.includes('SET correo = $1')) {
        assert.equal(params[0], 'michael.gutierrez@udistrital.edu.co');
        assert.equal(params[1], '1000586756');
        return { rowCount: 0, rows: [] };
      }

      return { rows: [], rowCount: 0 };
    },
  });

  const sessionState = {
    studentData: {
      con_documento_completo: '1000586756',
      con_codigo_completo: '20251377015',
      con_nombre_completo: 'GUTIERREZ ALVAREZ MICHAEL STIVEN',
      con_estado_completo: 'ACTIVO',
      con_carrera_completa: 'INGENIERIA DE PRODUCCION (CICLOS PROPEDEUTICOS)',
    },
  };

  try {
    const app = buildApp(loaded.route, sessionState);
    const response = await request(app).post('/email_verification').type('form').send({
      tipo_usuario: 'estudiante',
      correo: 'michael.gutierrez@udistrital.edu.co',
      password: 'Abcd1234!',
      confirmar_password: 'Abcd1234!',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/email_verification');
    assert.equal(response.body.locals.correo, 'michael.gutierrez@udistrital.edu.co');
    assert.equal(sessionState.usuario_no_verificado.documento, '1000586756');
    assert.equal(sessionState.usuario_no_verificado.correo, 'michael.gutierrez@udistrital.edu.co');
  } finally {
    loaded.restore();
  }
});
