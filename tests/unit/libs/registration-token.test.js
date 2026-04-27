const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../../src/libs/registration-token.js');

function loadRegistrationTokenModule(secret) {
  const previousSecret = process.env.REGISTRATION_TOKEN_SECRET;

  if (secret === undefined) {
    delete process.env.REGISTRATION_TOKEN_SECRET;
  } else {
    process.env.REGISTRATION_TOKEN_SECRET = secret;
  }

  delete require.cache[modulePath];
  const loadedModule = require(modulePath);

  return {
    ...loadedModule,
    restore() {
      if (previousSecret === undefined) {
        delete process.env.REGISTRATION_TOKEN_SECRET;
      } else {
        process.env.REGISTRATION_TOKEN_SECRET = previousSecret;
      }

      delete require.cache[modulePath];
    },
  };
}

test('getRegistrationTokenSecret returns configured secret', () => {
  const loaded = loadRegistrationTokenModule('super-secret-token');

  try {
    assert.equal(loaded.getRegistrationTokenSecret(), 'super-secret-token');
  } finally {
    loaded.restore();
  }
});

test('getRegistrationTokenSecret returns undefined when secret is absent', () => {
  const loaded = loadRegistrationTokenModule(undefined);

  try {
    assert.equal(loaded.getRegistrationTokenSecret(), undefined);
  } finally {
    loaded.restore();
  }
});
