const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createApplicationErrorHandler,
  renderApplicationError,
} = require('../../../src/routes/middlewares/error-handler');

function createHtmlResponse() {
  return {
    statusCode: 200,
    rendered: null,
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
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
    headersSent: false,
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

test('renderApplicationError renders the shared error page with default payload', () => {
  const res = createHtmlResponse();

  renderApplicationError(res);

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.rendered, {
    view: 'home/message_error',
    payload: {
      message: 'No pudimos completar tu solicitud',
      message2:
        'Por favor inténtalo de nuevo. Si el problema persiste, contáctanos en milab@udistrital.edu.co.',
      limit: null,
    },
  });
});

test('renderApplicationError exposes diagnostics to the admin who started impersonation', () => {
  const res = createHtmlResponse();
  const req = {
    method: 'GET',
    originalUrl: '/milab/api/dashboard',
    session: {
      user: { tipo: 'laboratorista' },
      impersonationAdminUser: { tipo: 'admin' },
    },
  };

  renderApplicationError(res, {}, req, new Error('dashboard template failed'));

  assert.match(res.rendered.payload.adminErrorDetail, /dashboard template failed/);
  assert.match(res.rendered.payload.adminErrorDetail, /GET \/milab\/api\/dashboard/);
  assert.equal(Object.hasOwn(res.rendered.payload, 'error'), false);
});

test('renderApplicationError does not expose diagnostics to a non-admin user', () => {
  const res = createHtmlResponse();
  const req = { session: { user: { tipo: 'laboratorista' } } };

  renderApplicationError(res, {}, req, new Error('private diagnostic'));

  assert.equal(Object.hasOwn(res.rendered.payload, 'adminErrorDetail'), false);
  assert.equal(Object.hasOwn(res.rendered.payload, 'error'), false);
});

test('application error handler renders html error page for browser requests', () => {
  const logger = {
    errorCalls: [],
    error(...args) {
      this.errorCalls.push(args);
    },
  };
  const handler = createApplicationErrorHandler(logger);
  const req = {
    method: 'GET',
    originalUrl: '/milab/api/consulta-invit',
    xhr: false,
    accepts() {
      return 'html';
    },
  };
  const res = createHtmlResponse();
  let nextCalled = false;

  handler(new Error('relation "menu_item" does not exist'), req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 500);
  assert.equal(res.rendered.view, 'home/message_error');
  assert.equal(logger.errorCalls.length, 1);
});

test('application error handler returns json for api requests expecting json', () => {
  const logger = { error() {} };
  const handler = createApplicationErrorHandler(logger);
  const req = {
    method: 'GET',
    originalUrl: '/milab/api/check-services',
    xhr: false,
    accepts() {
      return 'json';
    },
  };
  const res = createJsonResponse();

  handler({ status: 503, message: 'db offline' }, req, res, () => {});

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.payload, {
    ok: false,
    message: 'No pudimos completar tu solicitud',
    message2:
      'Por favor inténtalo de nuevo. Si el problema persiste, contáctanos en milab@udistrital.edu.co.',
  });
});
