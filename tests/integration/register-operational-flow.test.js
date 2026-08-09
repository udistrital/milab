const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { buildApp, resolveRepoPath } = require('./helpers/build-test-app');
const { createSessionHarness, createUser } = require('./helpers/session-fixtures');

const routePath = resolveRepoPath('src/routes/api/register_labs.js');
const dbPath = resolveRepoPath('src/libs/db.js');
const oatiClientPath = resolveRepoPath('src/libs/oati-client.js');
const facultyScopePath = resolveRepoPath('src/libs/faculty-scope.js');
const mailPath = resolveRepoPath('src/libs/mail.js');
const emailLayoutPath = resolveRepoPath('src/libs/email-layout.js');
const appUrlPath = resolveRepoPath('src/libs/app-url.js');
const tokenPath = resolveRepoPath('src/libs/registration-token.js');
const authPath = resolveRepoPath('src/routes/middlewares/auth.js');
const limiterPath = resolveRepoPath('src/routes/middlewares/limiter.js');
const securityLoggerPath = resolveRepoPath('src/routes/middlewares/security-logger.js');

function createClient(queryImpl) {
  return {
    async query(sql, params = []) {
      if (typeof queryImpl === 'function') {
        return queryImpl(sql, params);
      }

      if (sql.includes('SELECT * FROM facultad WHERE facultad_id = ANY($1::int[])')) {
        return { rows: [{ facultad_id: 10, nombre: 'Facultad 10' }] };
      }

      if (sql.includes('FROM ual WHERE activo = TRUE AND facultad_id = ANY($1::int[])')) {
        return { rows: [{ ual_id: 11, nombre: 'Lab 11', facultad_id: 10 }] };
      }

      if (sql.includes('SELECT c.documento,')) {
        return { rows: [{ documento: '900', nombre: 'Coord Demo', facultades: 'Facultad 10' }] };
      }

      return { rows: [] };
    },
    release() {},
  };
}

function loadRegisterLabsApp({ sessionState, queryImpl }) {
  const sessionHarness = createSessionHarness(sessionState);
  const client = createClient(queryImpl);

  return buildApp({
    entryPath: routePath,
    sessionHarness,
    stubs: [
      [dbPath, { query: client.query.bind(client), connect: async () => client }],
      [oatiClientPath, { getAcademicServicePath: (value) => value, requestOati: async () => ({}) }],
      [facultyScopePath, { resolveCoordinatorScope: async () => ({ coordinatorDocument: '900', facultyIds: [10] }) }],
      [mailPath, { sendMail: async () => {} }],
      [emailLayoutPath, { buildBrandedEmailAttachments: () => [], buildEmailFooterHtml: () => '', buildEmailHeaderHtml: () => '', escapeHtml: (value) => String(value || '') }],
      [appUrlPath, { appBaseUrl: 'https://milab.test', buildAppUrl: (path) => `https://milab.test${path}` }],
      [tokenPath, { getRegistrationTokenSecret: () => 'secret' }],
      [authPath, { requireRoles: () => (req, res, next) => next(), requireUser: () => (req, res, next) => next() }],
      [limiterPath, (req, res, next) => next()],
      [securityLoggerPath, { securityLogger: (req, res, next) => next() }],
    ],
    purgePaths: [routePath],
  });
}

test('register_labs allows token-verified users into the operational registration form', async () => {
  const loaded = loadRegisterLabsApp({
    sessionState: { registrationTokenVerified: true },
  });

  try {
    const response = await request(loaded.app).get('/new');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/register_labs');
  } finally {
    loaded.restore();
  }
});

test('register_labs load_info reports invalid document input without calling OATI', async () => {
  const loaded = loadRegisterLabsApp({
    sessionState: { user: createUser({ tipo: 'admin', roles: ['admin'] }) },
  });

  try {
    const response = await request(loaded.app).get('/load_info').query({ documento: 'abc' });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/register_labs');
    assert.match(response.body.locals.lookupMessage, /documento valido/i);
  } finally {
    loaded.restore();
  }
});

test('register_labs POST requires a coordinator selection for admin-led registration', async () => {
  const loaded = loadRegisterLabsApp({
    sessionState: { user: createUser({ tipo: 'admin', roles: ['admin'], documento: '100' }) },
  });

  try {
    const response = await request(loaded.app)
      .post('/')
      .type('form')
      .send({
        documento: '12345',
        correo: 'lab@udistrital.edu.co',
        nombre: 'Lab Uno',
        facultad_id: '10',
        ual_ids: ['11'],
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/register_labs');
    assert.match(response.body.locals.error, /seleccionar el coordinador responsable/i);
  } finally {
    loaded.restore();
  }
});