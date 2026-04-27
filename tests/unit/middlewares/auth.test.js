const test = require('node:test');
const assert = require('node:assert/strict');

const {
  renderAuthError,
  requireJsonRoles,
  requireRoles,
  requireUser,
} = require('../../../src/routes/middlewares/auth');

function createRenderResponse() {
  return {
    rendered: null,
    render(view, payload) {
      this.rendered = { view, payload };
      return this;
    },
  };
}

function createJsonResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test('renderAuthError renders default payload merged with overrides', () => {
  const res = createRenderResponse();

  renderAuthError(res, { message2: 'Sin sesión activa' });

  assert.deepEqual(res.rendered, {
    view: 'home/message_error',
    payload: {
      message: '¡Algo ha salido mal!',
      message2: 'Sin sesión activa',
      limit: 'noSession',
    },
  });
});

test('requireUser blocks when session user is missing', () => {
  const middleware = requireUser();
  const res = createRenderResponse();
  let nextCalled = false;

  middleware({ session: {} }, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.rendered.view, 'home/message_error');
});

test('requireRoles allows authorized roles and blocks unauthorized ones', () => {
  const middleware = requireRoles(['admin', 'coordinador']);
  const allowedRes = createRenderResponse();
  let allowedNextCalled = false;

  middleware({ session: { user: { tipo: 'admin' } } }, allowedRes, () => {
    allowedNextCalled = true;
  });

  assert.equal(allowedNextCalled, true);
  assert.equal(allowedRes.rendered, null);

  const deniedRes = createRenderResponse();
  let deniedNextCalled = false;
  middleware({ session: { user: { tipo: 'estudiante' } } }, deniedRes, () => {
    deniedNextCalled = true;
  });

  assert.equal(deniedNextCalled, false);
  assert.equal(deniedRes.rendered.view, 'home/message_error');
});

test('requireJsonRoles returns 401 for missing user and 403 for invalid role', () => {
  const middleware = requireJsonRoles('admin', { message: 'No autorizado' });

  const unauthenticatedRes = createJsonResponse();
  middleware({ session: {} }, unauthenticatedRes, () => {});
  assert.equal(unauthenticatedRes.statusCode, 401);
  assert.deepEqual(unauthenticatedRes.payload, {
    ok: false,
    message: 'No autorizado',
  });

  const forbiddenRes = createJsonResponse();
  middleware({ session: { user: { tipo: 'coordinador' } } }, forbiddenRes, () => {});
  assert.equal(forbiddenRes.statusCode, 403);
  assert.deepEqual(forbiddenRes.payload, {
    ok: false,
    message: 'No autorizado',
  });
});

test('requireJsonRoles calls next for allowed role', () => {
  const middleware = requireJsonRoles(['admin', 'coordinador']);
  const res = createJsonResponse();
  let nextCalled = false;

  middleware({ session: { user: { tipo: 'coordinador' } } }, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.payload, null);
});
