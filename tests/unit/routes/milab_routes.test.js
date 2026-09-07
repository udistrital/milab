const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('milab_routes mounts prestamos router', () => {
  const modulePath = path.resolve(__dirname, '../../../src/milab_routes.js');
  delete require.cache[modulePath];
  const app = require(modulePath);
  const stack = app._router?.stack || app.router?.stack || [];

  assert.equal(typeof app, 'function');
  assert.equal(Array.isArray(stack), true);
  assert.equal(
    stack.some((layer) => String(layer.regexp || '') === '/^\\/prestamos\\/?(?=\\/|$)/i'),
    true
  );
});
