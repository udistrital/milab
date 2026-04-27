const test = require('node:test');
const assert = require('node:assert/strict');

const {
  findEmailConflict,
  isInstitutionalEmail,
  isUniqueViolation,
  normalizeInstitutionalEmail,
  normalizeLogDocument,
} = require('../../../src/libs/account-email');

test('normalizeInstitutionalEmail trims and lowercases input', () => {
  assert.equal(
    normalizeInstitutionalEmail('  ACMendeza@UDistrital.edu.co  '),
    'acmendeza@udistrital.edu.co'
  );
  assert.equal(normalizeInstitutionalEmail(null), '');
});

test('isInstitutionalEmail accepts only udistrital addresses', () => {
  assert.equal(isInstitutionalEmail('persona@udistrital.edu.co'), true);
  assert.equal(isInstitutionalEmail('persona@gmail.com'), false);
  assert.equal(isInstitutionalEmail(''), false);
});

test('isUniqueViolation detects postgres unique constraint errors', () => {
  assert.equal(isUniqueViolation({ code: '23505' }), true);
  assert.equal(isUniqueViolation({ code: '99999' }), false);
  assert.equal(isUniqueViolation(null), false);
});

test('normalizeLogDocument returns only numeric identifiers', () => {
  assert.equal(normalizeLogDocument(' 1024467835 '), '1024467835');
  assert.equal(normalizeLogDocument('acmendeza'), null);
  assert.equal(normalizeLogDocument(''), null);
  assert.equal(normalizeLogDocument(12345), '12345');
});

test('findEmailConflict returns null when required inputs are missing', async () => {
  let queryCalled = false;
  const client = {
    async query() {
      queryCalled = true;
      return { rows: [] };
    },
  };

  assert.equal(await findEmailConflict(client, '', '123'), null);
  assert.equal(await findEmailConflict(client, 'user@udistrital.edu.co', ''), null);
  assert.equal(queryCalled, false);
});

test('findEmailConflict normalizes email and returns first matching row', async () => {
  const client = {
    async query(query, values) {
      assert.match(query, /existing_accounts/);
      assert.deepEqual(values, ['persona@udistrital.edu.co', 'auth-user']);
      return {
        rows: [{ source: 'auth', auth_document: 'other-user' }],
      };
    },
  };

  const result = await findEmailConflict(client, ' Persona@UDistrital.edu.co ', 'auth-user');
  assert.deepEqual(result, { source: 'auth', auth_document: 'other-user' });
});
