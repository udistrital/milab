const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('db_write module loads without throwing and exports script surface', () => {
  const modulePath = path.resolve(__dirname, '../../../src/routes/api/db_write.js');
  delete require.cache[modulePath];
  const exported = require(modulePath);

  assert.equal(typeof exported, 'object');
});
