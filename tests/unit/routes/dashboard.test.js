const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('dashboard exports an Express router with handlers', () => {
  const modulePath = path.resolve(__dirname, '../../../src/routes/api/dashboard.js');
  delete require.cache[modulePath];
  const router = require(modulePath);

  assert.equal(typeof router, 'function');
  assert.equal(typeof router.use, 'function');
  assert.equal(Array.isArray(router.stack), true);
  assert.equal(router.stack.length > 0, true);
});
