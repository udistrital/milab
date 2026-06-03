const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../../src/routes/api/dev-login.js');

function loadRouterWithEnv(partialEnv) {
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    ENABLE_DEV_LOGIN: process.env.ENABLE_DEV_LOGIN,
  };

  if (Object.hasOwn(partialEnv, 'NODE_ENV')) {
    process.env.NODE_ENV = partialEnv.NODE_ENV;
  }

  if (Object.hasOwn(partialEnv, 'ENABLE_DEV_LOGIN')) {
    process.env.ENABLE_DEV_LOGIN = partialEnv.ENABLE_DEV_LOGIN;
  }

  delete require.cache[modulePath];
  const router = require(modulePath);

  if (originalEnv.NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalEnv.NODE_ENV;

  if (originalEnv.ENABLE_DEV_LOGIN === undefined) delete process.env.ENABLE_DEV_LOGIN;
  else process.env.ENABLE_DEV_LOGIN = originalEnv.ENABLE_DEV_LOGIN;

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
