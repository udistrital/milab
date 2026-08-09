const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

const { buildApp, resolveRepoPath } = require('./helpers/build-test-app');
const {
  createMicrosoftProfile,
  createSessionHarness,
  createUser,
} = require('./helpers/session-fixtures');

const appPath = resolveRepoPath('src/milab_routes.js');
const profilePath = resolveRepoPath('src/routes/api/profile.js');
const indexPath = resolveRepoPath('src/routes/api/index.js');
const loginPath = resolveRepoPath('src/routes/api/login.js');
const microsoftPath = resolveRepoPath('src/routes/api/microsoft.js');
const logoutPath = resolveRepoPath('src/routes/api/logout.js');
const homePath = resolveRepoPath('src/routes/web/home.js');
const dbPath = resolveRepoPath('src/libs/db.js');
const oatiClientPath = resolveRepoPath('src/libs/oati-client.js');
const userIdentityPath = resolveRepoPath('src/libs/user-identity.js');
const passportPath = require.resolve('passport');

function buildApiIndexStub() {
  const router = express.Router();
  router.use('/profile', require(profilePath));
  return router;
}

function buildPassportStub(user) {
  return {
    authenticate(_strategy, options = {}) {
      return (req, res, next) => {
        if (req.path === '/microsoft') {
          return res.redirect('/mock-microsoft');
        }

        if (!user) {
          return res.redirect(options.failureRedirect || '/');
        }

        req.user = user;
        return next();
      };
    },
  };
}

function loadMilabApp({ sessionState, microsoftUser, fetchUserByEmail }) {
  const sessionHarness = createSessionHarness(sessionState);
  const stubs = [
    [
      indexPath,
      buildApiIndexStub(),
    ],
    [
      passportPath,
      buildPassportStub(microsoftUser),
    ],
    [
      dbPath,
      {
        query: async () => ({ rows: [] }),
        connect: async () => ({
          query: async () => ({ rows: [] }),
          release() {},
        }),
      },
    ],
    [
      oatiClientPath,
      {
        getAcademicServicePath: (value) => value,
        requestOati: async () => ({ datosEstudianteCollection: { datosBasicosEstudiante: [] } }),
      },
    ],
    [
      userIdentityPath,
      {
        fetchUserByEmail: fetchUserByEmail || (async () => null),
        buildSessionUser: (user) => ({
          id: user.id,
          correo: user.correo,
          documento: user.documento,
          documento_real: user.documento,
          nombre: user.nombre,
          roles: user.roles || [],
          tipo: user.tipo || user.roles?.[0] || 'admin',
        }),
      },
    ],
  ];

  return {
    sessionHarness,
    ...buildApp({
      entryPath: appPath,
      sessionHarness,
      stubs,
      purgePaths: [appPath, indexPath, profilePath, loginPath, microsoftPath, logoutPath, homePath],
    }),
  };
}

test('auth login entry redirects to microsoft auth route', async () => {
  const loaded = loadMilabApp({ sessionState: {} });

  try {
    const response = await request(loaded.app).post('/auth/login').type('form').send({
      documento: '123',
      password: 'secret',
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/auth/microsoft');
  } finally {
    loaded.restore();
  }
});

test('microsoft callback stores authenticated user in session and redirects home', async () => {
  const usuario = createUser({
    correo: 'persona@udistrital.edu.co',
    documento: '9001',
    roles: ['admin', 'docente', 'estudiante'],
    tipo: 'admin',
  });
  const loaded = loadMilabApp({
    sessionState: {},
    microsoftUser: {
      id: 'ms-123',
      displayName: 'Persona Microsoft',
      emails: [{ value: usuario.correo }],
    },
    fetchUserByEmail: async (correo) => (correo === usuario.correo ? usuario : null),
  });

  try {
    const response = await request(loaded.app).get('/auth/microsoft/callback');

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/milab/inicio');
    assert.equal(loaded.sessionHarness.state.user.correo, usuario.correo);
    assert.equal(loaded.sessionHarness.state.microsoftProfile, null);
  } finally {
    loaded.restore();
  }
});

test('microsoft callback keeps pending profile identification flow for first-time users', async () => {
  const loaded = loadMilabApp({
    sessionState: {},
    microsoftUser: {
      id: 'ms-456',
      displayName: 'Persona Microsoft',
      emails: [{ value: 'nueva@udistrital.edu.co' }],
    },
    fetchUserByEmail: async () => null,
  });

  try {
    const callbackResponse = await request(loaded.app).get('/auth/microsoft/callback');

    assert.equal(callbackResponse.status, 302);
    assert.equal(callbackResponse.headers.location, '/milab/api/profile/identify');
    assert.deepEqual(loaded.sessionHarness.state.microsoftProfile, createMicrosoftProfile({
      nombre: 'Persona Microsoft',
      correo: 'nueva@udistrital.edu.co',
      microsoftId: 'ms-456',
    }));

    const identifyResponse = await request(loaded.app).get('/api/profile/identify');
    assert.equal(identifyResponse.status, 200);
    assert.equal(identifyResponse.body.view, 'home/profile_identify');
    assert.equal(identifyResponse.body.locals.correo, 'nueva@udistrital.edu.co');
  } finally {
    loaded.restore();
  }
});

test('profile identify rejects empty document while preserving microsoft email context', async () => {
  const loaded = loadMilabApp({
    sessionState: {
      microsoftProfile: createMicrosoftProfile({ correo: 'nuevo@udistrital.edu.co' }),
    },
  });

  try {
    const response = await request(loaded.app)
      .post('/api/profile/identify')
      .type('form')
      .send({ documento: '' });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/profile_identify');
    assert.match(response.body.locals.error, /ingrese un numero de documento valido/i);
    assert.equal(response.body.locals.correo, 'nuevo@udistrital.edu.co');
  } finally {
    loaded.restore();
  }
});