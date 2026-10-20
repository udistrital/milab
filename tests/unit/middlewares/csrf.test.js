const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const multer = require('multer');
const request = require('supertest');

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
  assert.equal(res.rendered.payload.status, 403);
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

test('createCsrfVerifier allows the multipart inventory route to validate CSRF after parsing', () => {
  const verifyCsrfWithMultipartRouteExemption = createCsrfVerifier({
    skipPaths: ['/inventarios/cargas/previsualizar'],
  });
  const req = {
    method: 'POST',
    path: '/inventarios/cargas/previsualizar',
    session: { csrfToken: 'csrf-token-123' },
    body: {},
    headers: {},
  };
  const res = createResponse();
  let nextCalled = false;

  verifyCsrfWithMultipartRouteExemption(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.rendered, null);
});

test('mounted multipart inventory route validates its parsed CSRF field', async () => {
  const csrfToken = 'inventory-csrf-token';
  const app = express();
  const upload = multer({ storage: multer.memoryStorage() }).single('archivo');

  app.use((req, res, next) => {
    req.session = { csrfToken };
    res.render = (view, payload) => res.status(res.statusCode).json({ view, payload });
    next();
  });
  app.use('/milab', createCsrfVerifier({ skipPaths: ['/inventarios/cargas/previsualizar'] }));
  app.post('/milab/inventarios/cargas/previsualizar', upload, verifyCsrfToken, (req, res) =>
    res.json({ csrfToken: req.body._csrf })
  );

  const validRequest = await request(app)
    .post('/milab/inventarios/cargas/previsualizar')
    .field('_csrf', csrfToken)
    .attach('archivo', Buffer.from('excel'), 'inventario.xlsx');
  assert.equal(validRequest.status, 200);
  assert.equal(validRequest.body.csrfToken, csrfToken);

  const invalidRequest = await request(app)
    .post('/milab/inventarios/cargas/previsualizar')
    .attach('archivo', Buffer.from('excel'), 'inventario.xlsx');
  assert.equal(invalidRequest.status, 403);
  assert.equal(invalidRequest.body.payload.status, 403);
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
