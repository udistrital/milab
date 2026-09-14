const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/microsoft.js');
const passportPath = require.resolve('passport');
const oatiClientPath = path.resolve(__dirname, '../../../src/libs/oati-client.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const userIdentityPath = path.resolve(__dirname, '../../../src/libs/user-identity.js');

function createSessionState(initial = {}) {
  const state = { ...initial };

  Object.defineProperty(state, 'regenerate', {
    configurable: true,
    enumerable: false,
    value(callback) {
      for (const key of Object.keys(state)) {
        delete state[key];
      }
      if (typeof callback === 'function') {
        callback(null);
      }
    },
  });

  return state;
}

function loadMicrosoftRoute({
  passportUser,
  fetchUserByEmailImpl,
  buildSessionUserImpl,
  requestOatiImpl,
  poolQueryImpl,
} = {}) {
  const originals = new Map();
  const stubs = [
    [
      passportPath,
      {
        authenticate: () => (req, res, next) => {
          if (req.path === '/microsoft/callback') {
            req.user = passportUser || null;
          }
          next();
        },
      },
    ],
    [
      oatiClientPath,
      {
        requestOati: requestOatiImpl || (async () => ({})),
        getAcademicServicePath: (value) => value,
      },
    ],
    [
      dbPath,
      {
        query: poolQueryImpl || (async () => ({ rows: [] })),
      },
    ],
    [
      userIdentityPath,
      {
        buildSessionUser:
          buildSessionUserImpl ||
          ((row) => ({
            id: row.id,
            correo: row.correo,
            documento: row.documento,
            documento_real: row.documento,
            nombre: row.nombre,
            roles: row.roles || [],
            tipo: (row.roles || [])[0] || '',
          })),
        fetchUserByEmail: fetchUserByEmailImpl || (async () => null),
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

  const router = require(routePath);

  return {
    router,
    restore() {
      delete require.cache[routePath];
      for (const [modulePath, original] of originals.entries()) {
        if (original) {
          require.cache[modulePath] = original;
        } else {
          delete require.cache[modulePath];
        }
      }
    },
  };
}

function buildApp(router, sessionState) {
  const app = express();
  app.use((req, res, next) => {
    req.session = sessionState;
    next();
  });
  app.use('/', router);
  return app;
}

test('microsoft exports an Express router with handlers', () => {
  delete require.cache[routePath];
  const router = require(routePath);

  assert.equal(typeof router, 'function');
  assert.equal(typeof router.use, 'function');
  assert.equal(Array.isArray(router.stack), true);
  assert.equal(router.stack.length > 0, true);
});

test('microsoft callback authenticates when email exists in usuario (admin-corrected email case)', async () => {
  const sessionState = createSessionState();
  const fetchedEmails = [];

  const loaded = loadMicrosoftRoute({
    passportUser: {
      displayName: 'Estudiante Uno',
      emails: [{ value: 'estudiante@udistrital.edu.co' }],
      id: 'ms-123',
    },
    fetchUserByEmailImpl: async (correo) => {
      fetchedEmails.push(correo);
      return {
        id: 25,
        correo,
        documento: '10101010',
        nombre: 'Estudiante Uno',
        roles: ['estudiante'],
      };
    },
    poolQueryImpl: async () => ({ rows: [] }),
    requestOatiImpl: async () => ({ docentesCollection: { docente: [] } }),
  });

  try {
    const app = buildApp(loaded.router, sessionState);
    const response = await request(app).get('/microsoft/callback?code=fake&state=fake');

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/milab/inicio');
    assert.deepEqual(fetchedEmails, ['estudiante@udistrital.edu.co']);
    assert.equal(sessionState.user?.correo, 'estudiante@udistrital.edu.co');
    assert.equal(sessionState.user?.tipo, 'estudiante');
  } finally {
    loaded.restore();
  }
});
