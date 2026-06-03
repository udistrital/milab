const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/profile.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const oatiClientPath = path.resolve(__dirname, '../../../src/libs/oati-client.js');
const userIdentityPath = path.resolve(__dirname, '../../../src/libs/user-identity.js');

function buildApp(route, sessionData) {
  const app = express();

  app.use((req, res, next) => {
    req.session = sessionData;
    res.render = (view, locals) => res.status(res.statusCode || 200).json({ view, locals });
    next();
  });
  app.use('/', route);

  return app;
}

function loadRoute() {
  const originals = new Map();
  const stubs = [
    [
      dbPath,
      {
        query: async () => ({ rows: [] }),
      },
    ],
    [
      oatiClientPath,
      {
        getAcademicServicePath: (v) => v,
        requestOati: async () => ({ datosEstudianteCollection: { datosBasicosEstudiante: [] } }),
      },
    ],
    [
      userIdentityPath,
      {
        buildSessionUser: (u) => u,
        fetchUserByEmail: async () => null,
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

test('profile identify redirects to login when microsoftProfile is missing', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, {});
    const response = await request(app).get('/identify');

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/milab/auth/login');
  } finally {
    loaded.restore();
  }
});

test('profile identify renders validation error when documento is empty', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, {
      microsoftProfile: { correo: 'persona@udistrital.edu.co', nombre: 'Persona' },
    });
    const response = await request(app).post('/identify').type('form').send({ documento: '' });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/profile_identify');
    assert.match(response.body.locals.error, /numero de documento valido/i);
  } finally {
    loaded.restore();
  }
});

test('profile post rejects non institutional email', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, {
      microsoftProfile: { correo: 'no-institucional@gmail.com' },
    });
    const response = await request(app).post('/').type('form').send({
      modo: 'crear',
      nombre: 'Usuario Prueba',
      correo: 'no-institucional@gmail.com',
      documento: '12345',
      codigo: '2024123',
      estado: 'ACTIVO',
      carrera: 'Ingenieria',
      tipo_usuario: 'estudiante',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/profile');
    assert.match(response.body.locals.error, /Solo se permiten correos institucionales/i);
  } finally {
    loaded.restore();
  }
});
