const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(
  __dirname,
  '../../../src/routes/api/generate_cert_estudiante_lab.js'
);
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const appUrlPath = path.resolve(__dirname, '../../../src/libs/app-url.js');
const generatePathPath = path.resolve(__dirname, '../../../src/libs/generate-path.js');
const oatiClientPath = path.resolve(__dirname, '../../../src/libs/oati-client.js');
const certificateEmailPath = path.resolve(__dirname, '../../../src/libs/certificate-email.js');
const userIdentityPath = path.resolve(__dirname, '../../../src/libs/user-identity.js');
const authPath = path.resolve(__dirname, '../../../src/routes/middlewares/auth.js');

function buildApp(route) {
  const app = express();

  app.use((req, res, next) => {
    req.session = {
      user: {
        tipo: 'admin',
        documento: '1024467835',
      },
    };
    res.render = (view, locals) => res.status(res.statusCode || 200).json({ view, locals });
    next();
  });
  app.use('/', route);

  return app;
}

function loadRoute() {
  const originals = new Map();
  const requestOatiCalls = [];
  const stubs = [
    [dbPath, { query: async () => ({ rows: [] }) }],
    [appUrlPath, { buildAppUrl: (value) => value }],
    [generatePathPath, { buildGeneratePath: (value) => value }],
    [
      oatiClientPath,
      {
        getAcademicServicePath: (value) => value,
        requestOati: async (value) => {
          requestOatiCalls.push(value);
          return { datosEstudianteCollection: { datosBasicosEstudiante: [] } };
        },
      },
    ],
    [
      certificateEmailPath,
      {
        buildCertificateEmailFailureFeedback: () => null,
        buildCertificateEmailFeedback: () => null,
        sendCertificateEmail: async () => null,
      },
    ],
    [userIdentityPath, { ensurePerfilEstudiante: async () => 1 }],
    [
      authPath,
      {
        requireRoles: () => (req, res, next) => next(),
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
    requestOatiCalls,
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

test('generate_cert_estudiante_lab parses form submissions before querying OATI', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/').type('form').send({
      numero_documento_identificacion: '1000694178',
      con_codigo: '2024100001',
      motivo_exp: 'Grado',
      correo: 'estudiante@udistrital.edu.co',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.deepEqual(loaded.requestOatiCalls, ['datos_basicos_activos_cedula/1000694178']);
    assert.notEqual(response.body.locals.message, 'No fue posible procesar la solicitud.');
  } finally {
    loaded.restore();
  }
});

test('generate_cert_estudiante_lab returns a controlled error when the form data is missing', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/').type('form').send({});

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.equal(response.body.locals.message, 'No fue posible procesar la solicitud.');
    assert.equal(
      response.body.locals.message2,
      'Verifica los datos del formulario e inténtalo nuevamente.'
    );
    assert.deepEqual(loaded.requestOatiCalls, []);
  } finally {
    loaded.restore();
  }
});
