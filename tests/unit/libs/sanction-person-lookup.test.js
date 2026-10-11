const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createSanctionPersonLookup,
  resolveSanctionPersonLookup,
} = require('../../../src/libs/sanction-person-lookup');

function createRequest(role = 'admin', document = '12345678') {
  return {
    session: {
      user: {
        tipo: role,
        documento: document,
      },
    },
  };
}

test('sanction person lookup is kept in the session and bound to its actor and person type', () => {
  const req = createRequest();
  const person = {
    usuarioId: 42,
    documento: '87654321',
    nombre: 'Persona de prueba',
  };
  const token = createSanctionPersonLookup(req, 'estudiante', person);

  assert.match(token, /^[a-f0-9]{64}$/);
  assert.deepEqual(resolveSanctionPersonLookup(req, token, 'estudiante'), person);
  assert.equal(resolveSanctionPersonLookup(req, token, 'docente'), null);
  assert.equal(
    resolveSanctionPersonLookup(createRequest('admin', '99999999'), token, 'estudiante'),
    null
  );
  assert.equal(
    resolveSanctionPersonLookup(createRequest('laboratorista'), token, 'estudiante'),
    null
  );
});

test('sanction person lookup expires and removes itself from the session', () => {
  const req = createRequest();
  const token = createSanctionPersonLookup(req, 'docente', {
    usuarioId: 7,
    documento: '12345678',
    nombre: 'Docente de prueba',
  });
  req.session.sanctionPersonLookups[token].expiresAt = Date.now() - 1;

  assert.equal(resolveSanctionPersonLookup(req, token, 'docente'), null);
  assert.equal(req.session.sanctionPersonLookups[token], undefined);
});
