const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const middlewarePath = path.resolve(__dirname, '../../../src/routes/middlewares/session-gate.js');

function createResponse() {
  return {
    statusCode: 200,
    redirectedTo: null,
    jsonBody: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.jsonBody = payload;
      return this;
    },
    redirect(targetPath) {
      this.redirectedTo = targetPath;
      return this;
    },
  };
}

function loadMiddleware() {
  delete require.cache[middlewarePath];
  return require(middlewarePath);
}

test('sessionGateMiddleware redirects to login for expired HTML session', () => {
  const loaded = loadMiddleware();
  const req = {
    method: 'GET',
    originalUrl: '/milab/prestamos',
    session: {},
    get: () => 'text/html',
  };
  const res = createResponse();
  let nextCalled = false;

  loaded.sessionGateMiddleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.redirectedTo, '/milab/auth/login');
});

test('sessionGateMiddleware returns 401 JSON for expired API session', () => {
  const loaded = loadMiddleware();
  const req = {
    method: 'GET',
    originalUrl: '/milab/api/get_list_multas',
    session: {},
    get: () => 'application/json',
    xhr: true,
  };
  const res = createResponse();
  let nextCalled = false;

  loaded.sessionGateMiddleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.jsonBody.code, 'SESSION_EXPIRED');
});

test('sessionGateMiddleware allows public milab API route without session', () => {
  const loaded = loadMiddleware();
  const req = {
    method: 'GET',
    originalUrl: '/milab/api/consulta-invit',
    session: {},
    get: () => 'text/html',
  };
  const res = createResponse();
  let nextCalled = false;

  loaded.sessionGateMiddleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.redirectedTo, null);
  assert.equal(res.jsonBody, null);
});

test('sessionGateMiddleware allows public service status without session', () => {
  const loaded = loadMiddleware();
  const req = {
    method: 'GET',
    originalUrl: '/milab/api/check-services',
    session: {},
    get: () => 'application/json',
  };
  const res = createResponse();
  let nextCalled = false;

  loaded.sessionGateMiddleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.redirectedTo, null);
  assert.equal(res.jsonBody, null);
});

test('sessionGateMiddleware allows profile identify flow when microsoft profile is present', () => {
  const loaded = loadMiddleware();
  const req = {
    method: 'GET',
    originalUrl: '/milab/api/profile/identify',
    session: {
      microsoftProfile: { email: 'user@udistrital.edu.co' },
    },
    get: () => 'text/html',
  };
  const res = createResponse();
  let nextCalled = false;

  loaded.sessionGateMiddleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
});
