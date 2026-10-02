const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isPublicApiRequest,
  requireApiSessionUnlessPublic,
} = require('../../../src/routes/middlewares/api-session-gate');

test('public consultation accepts canonical /milab URL without a session', () => {
  for (const method of ['GET', 'POST']) {
    assert.equal(isPublicApiRequest({ method, originalUrl: '/milab/api/consulta-invit' }), true);
  }
});

test('public consultation still accepts the legacy API URL', () => {
  assert.equal(
    isPublicApiRequest({ method: 'GET', originalUrl: '/api/consulta-invit?source=guest' }),
    true
  );
});

test('student peace-of-mind verification remains protected', () => {
  assert.equal(
    isPublicApiRequest({ method: 'GET', originalUrl: '/milab/api/verificar_estudiante' }),
    false
  );
});

test('public API gate lets the canonical anonymous consultation through', () => {
  let nextCalled = false;
  const response = {
    status() {
      throw new Error('Public request must not be rejected.');
    },
    render() {
      throw new Error('Public request must not render an auth error.');
    },
  };

  requireApiSessionUnlessPublic(
    { method: 'GET', originalUrl: '/milab/api/consulta-invit', session: {} },
    response,
    () => {
      nextCalled = true;
    }
  );

  assert.equal(nextCalled, true);
});
