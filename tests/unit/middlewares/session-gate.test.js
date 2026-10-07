const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const middlewarePath = path.resolve(__dirname, '../../../src/routes/middlewares/session-gate.js');

function createResponse() {
  return {
    statusCode: 200,
    redirectedTo: null,
    jsonBody: null,
    clearCookie() {},
    set() {
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.jsonBody = payload;
      return this;
    },
    redirect(status, targetPath) {
      this.statusCode = status;
      this.redirectedTo = targetPath;
      return this;
    },
  };
}

function loadMiddleware() {
  delete require.cache[middlewarePath];
  return require(middlewarePath);
}

function expiredSession() {
  return { destroy: (callback) => callback(null) };
}

test('sessionGateMiddleware redirects home for expired HTML session', () => {
  const loaded = loadMiddleware();
  const req = {
    method: 'GET',
    originalUrl: '/milab/prestamos',
    session: expiredSession(),
    get: () => 'text/html',
  };
  const res = createResponse();
  let nextCalled = false;

  loaded.sessionGateMiddleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.redirectedTo, '/milab/');
  assert.equal(res.statusCode, 303);
});

test('sessionGateMiddleware returns 401 JSON for expired API session', () => {
  const loaded = loadMiddleware();
  const req = {
    method: 'GET',
    originalUrl: '/milab/api/get_list_multas',
    session: expiredSession(),
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

test('sessionGateMiddleware redirects home when a protected API path is opened directly in the browser', () => {
  const loaded = loadMiddleware();
  const req = {
    method: 'GET',
    originalUrl: '/milab/api/estudiantes_registrados',
    session: expiredSession(),
    get: (header) =>
      header === 'accept'
        ? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        : undefined,
  };
  const res = createResponse();
  let nextCalled = false;

  loaded.sessionGateMiddleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.redirectedTo, '/milab/');
  assert.equal(res.jsonBody, null);
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
