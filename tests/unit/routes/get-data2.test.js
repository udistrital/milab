const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/get-data2.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const recaptchaPath = path.resolve(__dirname, '../../../src/libs/recaptcha.js');
const oatiClientPath = path.resolve(__dirname, '../../../src/libs/oati-client.js');
const limiterPath = path.resolve(__dirname, '../../../src/routes/middlewares/limiter.js');

function buildApp(route, sessionState = {}) {
  const app = express();

  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.session = sessionState;
    next();
  });
  app.use((req, res, next) => {
    res.render = (view, locals) => res.status(res.statusCode || 200).json({ view, locals });
    next();
  });
  app.use('/', route);

  return app;
}

function loadRoute({ recaptchaResult = { success: true }, oatiImpl } = {}) {
  const originalDb = require.cache[dbPath];
  const originalRecaptcha = require.cache[recaptchaPath];
  const originalOatiClient = require.cache[oatiClientPath];
  const originalLimiter = require.cache[limiterPath];
  let dbCalls = 0;
  let oatiCalls = 0;

  delete require.cache[routePath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      async query() {
        dbCalls += 1;
        return { rows: [] };
      },
    },
  };
  require.cache[recaptchaPath] = {
    id: recaptchaPath,
    filename: recaptchaPath,
    loaded: true,
    exports: {
      verifyRecaptchaToken: async () => recaptchaResult,
    },
  };
  require.cache[oatiClientPath] = {
    id: oatiClientPath,
    filename: oatiClientPath,
    loaded: true,
    exports: {
      getAcademicServicePath(servicePath) {
        return servicePath;
      },
      async requestOati(pathname) {
        oatiCalls += 1;

        if (typeof oatiImpl === 'function') {
          return oatiImpl(pathname);
        }

        return {
          docentesCollection: {
            docente: [
              {
                estado_docente: 'ACTIVO',
                nombre: 'Nombre Docente',
              },
            ],
          },
        };
      },
    },
  };
  require.cache[limiterPath] = {
    id: limiterPath,
    filename: limiterPath,
    loaded: true,
    exports: (req, res, next) => next(),
  };
  return {
    route: require(routePath),
    getDbCalls: () => dbCalls,
    getAxiosGetCalls: () => oatiCalls,
    restore() {
      if (originalDb) {
        require.cache[dbPath] = originalDb;
      } else {
        delete require.cache[dbPath];
      }

      if (originalRecaptcha) {
        require.cache[recaptchaPath] = originalRecaptcha;
      } else {
        delete require.cache[recaptchaPath];
      }

      if (originalOatiClient) {
        require.cache[oatiClientPath] = originalOatiClient;
      } else {
        delete require.cache[oatiClientPath];
      }

      if (originalLimiter) {
        require.cache[limiterPath] = originalLimiter;
      } else {
        delete require.cache[limiterPath];
      }

      delete require.cache[routePath];
    },
  };
}

test('get-data2 rejects missing recaptcha before touching db or OAS', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/').type('form').send({
      numero_documento_identificacion: '123456',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/register_2');
    assert.equal(response.body.locals.error, 'Por favor completa el reCAPTCHA.');
    assert.equal(response.body.locals.selectedType, 'docente');
    assert.equal(loaded.getDbCalls(), 0);
    assert.equal(loaded.getAxiosGetCalls(), 0);
  } finally {
    loaded.restore();
  }
});

test('get-data2 rejects failed recaptcha before querying db or OAS', async () => {
  const loaded = loadRoute({ recaptchaResult: { success: false } });

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/').type('form').send({
      numero_documento_identificacion: '123456',
      'g-recaptcha-response': 'token',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/register_2');
    assert.equal(response.body.locals.error, 'No se pudo verificar el reCAPTCHA.');
    assert.equal(response.body.locals.selectedType, 'docente');
    assert.equal(loaded.getDbCalls(), 0);
    assert.equal(loaded.getAxiosGetCalls(), 0);
  } finally {
    loaded.restore();
  }
});

test('get-data2 stores teacher data and masks output when lookup succeeds', async () => {
  const loaded = loadRoute();
  const sessionState = {};

  try {
    const app = buildApp(loaded.route, sessionState);
    const response = await request(app).post('/').type('form').send({
      numero_documento_identificacion: '123456',
      'g-recaptcha-response': 'token',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/register_data1');
    assert.equal(response.body.locals.confirmacion, null);
    assert.equal(response.body.locals.error, null);
    assert.deepEqual(sessionState.teacherData, {
      con_estado_completo: 'ACTIVO',
      con_documento_completo: '123456',
      con_nombre_completo: 'Nombre Docente',
    });
    assert.equal(loaded.getDbCalls(), 1);
    assert.equal(loaded.getAxiosGetCalls(), 1);
  } finally {
    loaded.restore();
  }
});
