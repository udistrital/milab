const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../../src/routes/api/index.js');

function withEnv(partialEnv, fn) {
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    ALLOW_PUBLIC_SERVICE_STATUS: process.env.ALLOW_PUBLIC_SERVICE_STATUS,
  };

  if (Object.hasOwn(partialEnv, 'NODE_ENV')) {
    process.env.NODE_ENV = partialEnv.NODE_ENV;
  }

  if (Object.hasOwn(partialEnv, 'ALLOW_PUBLIC_SERVICE_STATUS')) {
    process.env.ALLOW_PUBLIC_SERVICE_STATUS = partialEnv.ALLOW_PUBLIC_SERVICE_STATUS;
  }

  try {
    return fn();
  } finally {
    if (originalEnv.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv.NODE_ENV;

    if (originalEnv.ALLOW_PUBLIC_SERVICE_STATUS === undefined) {
      delete process.env.ALLOW_PUBLIC_SERVICE_STATUS;
    } else {
      process.env.ALLOW_PUBLIC_SERVICE_STATUS = originalEnv.ALLOW_PUBLIC_SERVICE_STATUS;
    }
  }
}

test('api router fails fast when ALLOW_PUBLIC_SERVICE_STATUS is enabled outside dev envs', () => {
  withEnv(
    {
      NODE_ENV: 'production',
      ALLOW_PUBLIC_SERVICE_STATUS: 'true',
    },
    () => {
      delete require.cache[modulePath];
      assert.throws(() => require(modulePath), {
        message: /ALLOW_PUBLIC_SERVICE_STATUS/i,
      });
    }
  );
});
