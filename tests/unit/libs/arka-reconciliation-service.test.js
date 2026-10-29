const test = require('node:test');
const assert = require('node:assert/strict');
const { getBogotaMonthStart } = require('../../../src/libs/arka-reconciliation-service');

test('monthly period uses the Bogota calendar date', () => {
  assert.equal(getBogotaMonthStart(new Date('2026-03-01T04:30:00.000Z')), '2026-02-01');
  assert.equal(getBogotaMonthStart(new Date('2026-03-01T05:30:00.000Z')), '2026-03-01');
});
