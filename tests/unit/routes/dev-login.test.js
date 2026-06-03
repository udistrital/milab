const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../../src/routes/api/dev-login.js');

function loadRouterWithEnv(partialEnv) {
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    ENABLE_DEV_LOGIN: process.env.ENABLE_DEV_LOGIN,
    DEV_LOGIN_ALLOWED_IPS: process.env.DEV_LOGIN_ALLOWED_IPS,
    DEV_LOGIN_HEADER_SECRET: process.env.DEV_LOGIN_HEADER_SECRET,
    ADMINDEV_HASH: process.env.ADMINDEV_HASH,
  };

  if (Object.hasOwn(partialEnv, 'NODE_ENV')) {
    process.env.NODE_ENV = partialEnv.NODE_ENV;
  }

  if (Object.hasOwn(partialEnv, 'ENABLE_DEV_LOGIN')) {
    process.env.ENABLE_DEV_LOGIN = partialEnv.ENABLE_DEV_LOGIN;
  }

  if (Object.hasOwn(partialEnv, 'DEV_LOGIN_ALLOWED_IPS')) {
    process.env.DEV_LOGIN_ALLOWED_IPS = partialEnv.DEV_LOGIN_ALLOWED_IPS;
  }

  if (Object.hasOwn(partialEnv, 'DEV_LOGIN_HEADER_SECRET')) {
    process.env.DEV_LOGIN_HEADER_SECRET = partialEnv.DEV_LOGIN_HEADER_SECRET;
  }

  if (Object.hasOwn(partialEnv, 'ADMINDEV_HASH')) {
    process.env.ADMINDEV_HASH = partialEnv.ADMINDEV_HASH;
  }

  delete require.cache[modulePath];
  const router = require(modulePath);

  if (originalEnv.NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalEnv.NODE_ENV;

  if (originalEnv.ENABLE_DEV_LOGIN === undefined) delete process.env.ENABLE_DEV_LOGIN;
  else process.env.ENABLE_DEV_LOGIN = originalEnv.ENABLE_DEV_LOGIN;

  if (originalEnv.DEV_LOGIN_ALLOWED_IPS === undefined) delete process.env.DEV_LOGIN_ALLOWED_IPS;
  else process.env.DEV_LOGIN_ALLOWED_IPS = originalEnv.DEV_LOGIN_ALLOWED_IPS;

  if (originalEnv.DEV_LOGIN_HEADER_SECRET === undefined) {
    delete process.env.DEV_LOGIN_HEADER_SECRET;
  } else {
    process.env.DEV_LOGIN_HEADER_SECRET = originalEnv.DEV_LOGIN_HEADER_SECRET;
  }

  if (originalEnv.ADMINDEV_HASH === undefined) delete process.env.ADMINDEV_HASH;
  else process.env.ADMINDEV_HASH = originalEnv.ADMINDEV_HASH;

  return router;
}

test('dev-login exports an empty router when feature flag is disabled', () => {
  const router = loadRouterWithEnv({
    NODE_ENV: 'dev',
    ENABLE_DEV_LOGIN: 'false',
  });

  assert.equal(typeof router, 'function');
  assert.equal(typeof router.use, 'function');
  assert.equal(Array.isArray(router.stack), true);
  assert.equal(router.stack.length, 0);
});

test('dev-login exports handlers when running in dev with feature flag enabled', () => {
  const router = loadRouterWithEnv({
    NODE_ENV: 'dev',
    ENABLE_DEV_LOGIN: 'true',
  });

  assert.equal(typeof router, 'function');
  assert.equal(typeof router.use, 'function');
  assert.equal(Array.isArray(router.stack), true);
  assert.equal(router.stack.length > 0, true);
});

test('dev-login exports an empty router in production even if flag is enabled', () => {
  const router = loadRouterWithEnv({
    NODE_ENV: 'production',
    ENABLE_DEV_LOGIN: 'true',
  });

  assert.equal(typeof router, 'function');
  assert.equal(typeof router.use, 'function');
  assert.equal(Array.isArray(router.stack), true);
  assert.equal(router.stack.length, 0);
});
