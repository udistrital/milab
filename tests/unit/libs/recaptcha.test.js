const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRecaptchaVerificationUrl,
  verifyRecaptchaToken,
} = require('../../../src/libs/recaptcha');

test('buildRecaptchaVerificationUrl encodes secret and token', () => {
  const url = buildRecaptchaVerificationUrl('secret value', 'token/value');

  assert.equal(
    url,
    'https://www.google.com/recaptcha/api/siteverify?secret=secret%20value&response=token%2Fvalue'
  );
});

test('verifyRecaptchaToken returns failure when required inputs are missing', async () => {
  let called = false;

  const result = await verifyRecaptchaToken({
    secretKey: '',
    token: 'token',
    fetchImpl: async () => {
      called = true;
      return { json: async () => ({ success: true }) };
    },
  });

  assert.deepEqual(result, { success: false });
  assert.equal(called, false);
});

test('verifyRecaptchaToken returns verification payload from fetch response', async () => {
  let calledUrl;
  let calledOptions;

  const result = await verifyRecaptchaToken({
    secretKey: 'secret',
    token: 'token',
    fetchImpl: async (url, options) => {
      calledUrl = url;
      calledOptions = options;

      return {
        async json() {
          return { success: true, score: 0.9 };
        },
      };
    },
  });

  assert.equal(calledUrl, 'https://www.google.com/recaptcha/api/siteverify');
  assert.deepEqual(calledOptions, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'secret=secret&response=token',
  });
  assert.deepEqual(result, { success: true, score: 0.9 });
});

test('verifyRecaptchaToken returns failure when fetch throws', async () => {
  const result = await verifyRecaptchaToken({
    secretKey: 'secret',
    token: 'token',
    fetchImpl: async () => {
      throw new Error('network failure');
    },
  });

  assert.deepEqual(result, { success: false });
});
