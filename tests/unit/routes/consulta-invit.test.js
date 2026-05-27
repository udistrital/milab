const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/consulta-invit.js');
const recaptchaPath = path.resolve(__dirname, '../../../src/libs/recaptcha.js');
const appUrlPath = path.resolve(__dirname, '../../../src/libs/app-url.js');
const axiosPath = require.resolve('axios');

function buildApp(route) {
  const app = express();

  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    res.render = (view, locals) => res.status(res.statusCode || 200).json({ view, locals });
    next();
  });
  app.use('/', route);

  return app;
}

function loadRoute({ recaptchaResult = { success: true }, axiosGetImpl } = {}) {
  const originalRecaptcha = require.cache[recaptchaPath];
  const originalAppUrl = require.cache[appUrlPath];
  const originalAxios = require.cache[axiosPath];
  const originalEnv = {
    RECAPTCHA_SITE_KEY: process.env.RECAPTCHA_SITE_KEY,
  };
  let getCalls = 0;

  process.env.RECAPTCHA_SITE_KEY = 'site-key';

  delete require.cache[routePath];
  require.cache[recaptchaPath] = {
    id: recaptchaPath,
    filename: recaptchaPath,
    loaded: true,
    exports: {
      verifyRecaptchaToken: async () => recaptchaResult,
    },
  };
  require.cache[appUrlPath] = {
    id: appUrlPath,
    filename: appUrlPath,
    loaded: true,
    exports: {
      buildAppUrl(route) {
        return `https://milab.test${route}`;
      },
    },
  };
  require.cache[axiosPath] = {
    id: axiosPath,
    filename: axiosPath,
    loaded: true,
    exports: {
      async get(url) {
        getCalls += 1;

        if (typeof axiosGetImpl === 'function') {
          return axiosGetImpl(url);
        }

        return { data: { estado: 'PAZ_Y_SALVO' } };
      },
    },
  };

  return {
    route: require(routePath),
    getCalls: () => getCalls,
    restore() {
      if (originalRecaptcha) {
        require.cache[recaptchaPath] = originalRecaptcha;
      } else {
        delete require.cache[recaptchaPath];
      }

      if (originalAppUrl) {
        require.cache[appUrlPath] = originalAppUrl;
      } else {
        delete require.cache[appUrlPath];
      }

      if (originalAxios) {
        require.cache[axiosPath] = originalAxios;
      } else {
        delete require.cache[axiosPath];
      }

      Object.entries(originalEnv).forEach(([key, value]) => {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      });

      delete require.cache[routePath];
    },
  };
}

test('consulta-invit rejects missing recaptcha before calling downstream APIs', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/').type('form').send({ documento: '123456' });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/consulta-invit');
    assert.equal(response.body.locals.error, 'Por favor completa el reCAPTCHA.');
    assert.equal(loaded.getCalls(), 0);
  } finally {
    loaded.restore();
  }
});

test('consulta-invit rejects missing documento before calling downstream APIs', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/').type('form').send({
      'g-recaptcha-response': 'token',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/consulta-invit');
    assert.equal(
      response.body.locals.error,
      'Debes ingresar un documento para realizar la consulta.'
    );
    assert.equal(loaded.getCalls(), 0);
  } finally {
    loaded.restore();
  }
});

test('consulta-invit rejects invalid recaptcha without querying the multa API', async () => {
  const loaded = loadRoute({ recaptchaResult: { success: false } });

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/').type('form').send({
      documento: '123456',
      'g-recaptcha-response': 'token',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/consulta-invit');
    assert.equal(response.body.locals.error, 'No se pudo verificar el reCAPTCHA.');
    assert.equal(loaded.getCalls(), 0);
  } finally {
    loaded.restore();
  }
});

test('consulta-invit renders estado when recaptcha and API lookup succeed', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/').type('form').send({
      documento: '123456',
      'g-recaptcha-response': 'token',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/consulta-invit');
    assert.equal(response.body.locals.estadoSinFormato, 'PAZ_Y_SALVO');
    assert.equal(response.body.locals.estadoResultado, 'El estudiante está: PAZ_Y_SALVO');
    assert.equal(loaded.getCalls(), 1);
  } finally {
    loaded.restore();
  }
});

test('consulta-invit maps 404 lookup failures to a user-facing message', async () => {
  const loaded = loadRoute({
    axiosGetImpl: async () => {
      const error = new Error('not found');
      error.response = { status: 404 };
      throw error;
    },
  });

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/').type('form').send({
      documento: '123456',
      'g-recaptcha-response': 'token',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/consulta-invit');
    assert.equal(
      response.body.locals.error,
      'No se encontró información para el documento ingresado.'
    );
  } finally {
    loaded.restore();
  }
});
