const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSanctionPersonReturnPath,
  createSanctionPersonLookup,
  resolveSanctionPersonLookup,
  SANCTION_PERSON_ACTIONS_PATH,
} = require('../../../src/libs/sanction-person-lookup');

test('return path to the person actions step carries the lookup token and optional feedback', () => {
  const token = 'b'.repeat(64);

  assert.equal(
    buildSanctionPersonReturnPath(token),
    `${SANCTION_PERSON_ACTIONS_PATH}?lookup_token=${token}`
  );
  assert.equal(
    buildSanctionPersonReturnPath(token, 'saldada'),
    `${SANCTION_PERSON_ACTIONS_PATH}?lookup_token=${token}&success=saldada`
  );
});

test('return path rejects malformed lookup tokens', () => {
  assert.equal(buildSanctionPersonReturnPath(''), null);
  assert.equal(buildSanctionPersonReturnPath('abc'), null);
  assert.equal(buildSanctionPersonReturnPath('z'.repeat(64)), null);
  assert.equal(buildSanctionPersonReturnPath(undefined), null);
});

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
