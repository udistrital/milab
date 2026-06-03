const test = require('node:test');
const assert = require('node:assert/strict');

const {
  csrfTokenMiddleware,
  verifyCsrfToken,
  createCsrfVerifier,
} = require('../../../src/routes/middlewares/csrf');

function createResponse() {
  return {
    statusCode: 200,
    rendered: null,
    jsonPayload: null,
    locals: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    render(view, payload) {
      this.rendered = { view, payload };
      return this;
    },
    json(payload) {
      this.jsonPayload = payload;
      return this;
    },
  };
}

test('verifyCsrfToken rejects POST without token', () => {
  const req = {
    method: 'POST',
    session: { csrfToken: 'csrf-token-123' },
    body: {},
    headers: {},
  };
  const res = createResponse();
  let nextCalled = false;

  verifyCsrfToken(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.rendered.view, 'home/message_error');
  assert.match(res.rendered.payload.message, /Solicitud no válida/i);
});

test('verifyCsrfToken rejects POST with invalid token', () => {
  const req = {
    method: 'POST',
    session: { csrfToken: 'csrf-token-123' },
    body: { _csrf: 'csrf-token-999' },
    headers: {},
  };
  const res = createResponse();
  let nextCalled = false;

  verifyCsrfToken(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.rendered.view, 'home/message_error');
});

test('verifyCsrfToken allows POST with valid token in body', () => {
  const req = {
    method: 'POST',
    session: { csrfToken: 'csrf-token-123' },
    body: { _csrf: 'csrf-token-123' },
    headers: {},
  };
  const res = createResponse();
  let nextCalled = false;

  verifyCsrfToken(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.rendered, null);
});

test('verifyCsrfToken allows POST with valid token in header', () => {
  const req = {
    method: 'POST',
    session: { csrfToken: 'csrf-token-123' },
    body: {},
    headers: { 'x-csrf-token': 'csrf-token-123' },
  };
  const res = createResponse();
  let nextCalled = false;

  verifyCsrfToken(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.rendered, null);
});

test('verifyCsrfToken rejects PUT without token', () => {
  const req = {
    method: 'PUT',
    session: { csrfToken: 'csrf-token-123' },
    body: {},
    headers: {},
  };
  const res = createResponse();
  let nextCalled = false;

  verifyCsrfToken(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.rendered.view, 'home/message_error');
});

test('verifyCsrfToken returns JSON error for API request', () => {
  const req = {
    method: 'PATCH',
    path: '/api/profile',
    session: { csrfToken: 'csrf-token-123' },
    body: {},
    headers: {},
    get() {
      return 'application/json';
    },
  };
  const res = createResponse();
  let nextCalled = false;

  verifyCsrfToken(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.rendered, null);
  assert.equal(res.jsonPayload.message, 'Solicitud no válida');
});

test('createCsrfVerifier allows configured exempt API path', () => {
  const verifyCsrfWithExemptions = createCsrfVerifier({ skipPaths: ['/api/check-services'] });
  const req = {
    method: 'POST',
    path: '/api/check-services',
    session: { csrfToken: 'csrf-token-123' },
    body: {},
    headers: {},
  };
  const res = createResponse();
  let nextCalled = false;

  verifyCsrfWithExemptions(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.rendered, null);
  assert.equal(res.jsonPayload, null);
});

test('csrfTokenMiddleware injects token into locals', () => {
  const req = {
    session: {},
  };
  const res = createResponse();
  let nextCalled = false;

  csrfTokenMiddleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(typeof res.locals.csrfToken, 'string');
  assert.equal(res.locals.csrfToken.length > 0, true);
  assert.equal(req.session.csrfToken, res.locals.csrfToken);
});
