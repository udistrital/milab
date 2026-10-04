const test = require('node:test');
const assert = require('node:assert/strict');
const { getSessionPolicy, startSessionLifetime } = require('../../../src/libs/session-policy');

test('session policy fixes inactivity at 30 minutes and absolute duration at 8 hours', () => {
  assert.deepEqual(getSessionPolicy(), {
    idleTimeoutMs: 1800000,
    absoluteTimeoutMs: 28800000,
  });
});

test('environment settings cannot override the fixed session policy', () => {
  const overrides = {
    SESSION_IDLE_TIMEOUT_MS: '120000',
    SESSION_MAX_AGE_MS: '60000',
    SESSION_ABSOLUTE_TIMEOUT_MS: '3600000',
  };
  const originals = new Map();
  try {
    for (const [name, value] of Object.entries(overrides)) {
      originals.set(name, process.env[name]);
      process.env[name] = value;
    }
    assert.deepEqual(getSessionPolicy(), {
      idleTimeoutMs: 1800000,
      absoluteTimeoutMs: 28800000,
    });
  } finally {
    for (const [name, value] of originals) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('the shared policy cannot be modified at runtime', () => {
  const policy = getSessionPolicy();
  assert.equal(Object.isFrozen(policy), true);
  assert.equal(Reflect.set(policy, 'idleTimeoutMs', 1), false);
  assert.equal(getSessionPolicy().idleTimeoutMs, 1800000);
});

test('authentication starts both session clocks', () => {
  const session = {};
  startSessionLifetime(session, 123);
  assert.deepEqual(session.lifetime, { startedAt: 123, lastActivityAt: 123 });
});
