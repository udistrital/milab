const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeRequestPath,
  validateFormTextLengths,
} = require('../../../src/routes/middlewares/form-text-limits');

function createRequest({
  method = 'POST',
  originalUrl = '/milab/api/admins',
  body = {},
  query = {},
  acceptedType = 'json',
  contentType = '',
} = {}) {
  return {
    method,
    originalUrl,
    body,
    query,
    xhr: false,
    accepts: () => acceptedType,
    is: (type) => contentType === type,
  };
}

function createResponse() {
  return {
    statusCode: 200,
    payload: null,
    rendered: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
    render(view, payload) {
      this.rendered = { view, payload };
      return this;
    },
  };
}

function runMiddleware(req) {
  const res = createResponse();
  let nextCalled = false;
  validateFormTextLengths(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

test('allows a text field at its configured limit', () => {
  const { res, nextCalled } = runMiddleware(createRequest({ body: { nombre: 'n'.repeat(200) } }));

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test('rejects oversized fields and returns JSON for API requests', () => {
  const { res, nextCalled } = runMiddleware(
    createRequest({
      originalUrl: '/pazysalvos/api/admins',
      body: { nombre: 'n'.repeat(201) },
    })
  );

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.success, false);
  assert.match(res.payload.message2, /200 caracteres/);
});

test('normalizes application base paths before matching validation rules', () => {
  assert.equal(normalizeRequestPath({ originalUrl: '/milab/api/admins?x=1' }), '/api/admins');
  assert.equal(
    normalizeRequestPath({ originalUrl: '/pazysalvos/prestamos/salas/12' }),
    '/prestamos/salas/12'
  );
});

test('checks text values inside JSON fields', () => {
  const { res, nextCalled } = runMiddleware(
    createRequest({
      originalUrl: '/milab/prestamos/practicas/reservar',
      body: {
        detalle_practica_json: JSON.stringify({ observaciones: 'x'.repeat(2001) }),
      },
      contentType: 'application/json',
    })
  );

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.success, false);
});

test('applies the shorter limit when a student search uses a code', () => {
  const { res, nextCalled } = runMiddleware(
    createRequest({
      originalUrl: '/milab/api/verificar_estudiante',
      body: { tipo_busqueda: 'codigo', valor_busqueda: '1'.repeat(20) },
    })
  );

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
  assert.match(res.payload.message2, /19 caracteres/);
});

test('does not let numeric JSON values bypass text limits', () => {
  const { res, nextCalled } = runMiddleware(
    createRequest({
      originalUrl: '/milab/api/verificar_estudiante',
      body: { tipo_busqueda: 'codigo', valor_busqueda: 1e20 },
      contentType: 'application/json',
    })
  );

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
});

test('validates each document in a bulk student query', () => {
  const { res, nextCalled } = runMiddleware(
    createRequest({
      originalUrl: '/milab/api/get_list_estudiantes/consulta_masiva',
      body: { consulta_masiva: `1,${'2'.repeat(51)}` },
    })
  );

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
  assert.match(res.payload.message2, /Cada documento o código/);
});

test('renders an HTML error for browser form submissions', () => {
  const { res, nextCalled } = runMiddleware(
    createRequest({
      method: 'GET',
      originalUrl: '/milab/api/register_labs/load_info?documento=' + '1'.repeat(51),
      acceptedType: 'html',
      query: { documento: '1'.repeat(51) },
    })
  );

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
  assert.equal(res.rendered.view, 'home/message_error');
  assert.match(res.rendered.payload.message2, /50 caracteres/);
});

test('allows course codes through the database column limit', () => {
  const { res, nextCalled } = runMiddleware(
    createRequest({
      originalUrl: '/milab/api/capacitacion-gestion/solicitar',
      body: { codigo_curso: 'C'.repeat(100) },
    })
  );

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test('checks text values nested in the practice schema', () => {
  const { res, nextCalled } = runMiddleware(
    createRequest({
      originalUrl: '/milab/prestamos/coordinador/practicas/config/schema',
      body: {
        schema_json: { campos_adicionales: [{ ayuda: 'x'.repeat(2001) }] },
      },
    })
  );

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
  assert.match(res.payload.message2, /2000 caracteres/);
});

test('passes through requests without a matching form rule', () => {
  const { res, nextCalled } = runMiddleware(
    createRequest({
      originalUrl: '/milab/api/capacitacion-gestion/inscribirme/1',
      body: { message: 'x'.repeat(5000) },
    })
  );

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});
