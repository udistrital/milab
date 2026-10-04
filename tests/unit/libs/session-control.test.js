const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.resolve(__dirname, '../../../src/public/js/session-control.js'),
  'utf8'
);

function createClient() {
  let now = 0;
  const listeners = new Map();
  const timers = new Map();
  const intervals = [];
  const requests = [];
  const redirects = [];
  const errors = [];
  const elements = new Map();
  const xhrListeners = new Map();
  let response = {
    status: 200,
    ok: true,
    headers: { get: () => null },
    json: async () => ({ ok: true, expiresInMs: 1800000 }),
  };
  class XMLHttpRequest {
    send() {}
    addEventListener(name, listener) {
      xhrListeners.set(name, listener);
    }
    getResponseHeader() {
      return '1';
    }
  }
  const document = {
    body: {
      dataset: { isAuthenticated: 'true', sessionExpiresIn: '1800000' },
      prepend(element) {
        elements.set(element.id, element);
      },
    },
    querySelector: () => ({ content: 'csrf-token' }),
    getElementById: (id) => elements.get(id),
    createElement: () => ({
      setAttribute() {},
      remove() {
        elements.delete(this.id);
      },
    }),
    addEventListener: (name, listener) => listeners.set(name, listener),
    visibilityState: 'visible',
  };
  const window = {
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (response instanceof Error) throw response;
      return response;
    },
    location: {
      origin: 'https://milab.test',
      href: 'https://milab.test/milab/inicio',
      replace: (url) => redirects.push(url),
    },
    console: { error: (...args) => errors.push(args) },
    XMLHttpRequest,
    setTimeout: (callback, delay) => {
      const id = Symbol();
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    setInterval: (callback) => intervals.push(callback),
  };
  vm.runInNewContext(source, { window, document, URL, Date: { now: () => now } });
  return {
    window,
    document,
    listeners,
    timers,
    intervals,
    requests,
    redirects,
    errors,
    xhrListeners,
    advance: (ms) => {
      now += ms;
    },
    setResponse: (value) => {
      response = value;
    },
    flush: () => new Promise((resolve) => setImmediate(resolve)),
  };
}

test('an idle page never sends background activity heartbeats', async () => {
  const client = createClient();
  client.advance(120000);
  client.intervals[0]();
  await client.flush();
  assert.equal(client.requests.length, 0);
  assert.equal(client.timers.size, 1);
});

test('trusted typing keeps form sessions alive with throttled CSRF-protected activity', async () => {
  const client = createClient();
  client.listeners.get('input')({ isTrusted: true });
  client.advance(60000);
  client.intervals[0]();
  await client.flush();
  assert.equal(client.requests.length, 1);
  assert.equal(client.requests[0].url, '/milab/auth/session/activity');
  assert.equal(client.requests[0].options.method, 'POST');
  assert.equal(client.requests[0].options.headers['X-CSRF-Token'], 'csrf-token');
  client.intervals[0]();
  assert.equal(client.requests.length, 1);
  client.advance(60000);
  client.listeners.get('keydown')({ isTrusted: false });
  client.intervals[0]();
  assert.equal(client.requests.length, 1);
});

test('fetch session expiration navigates home without consuming the application response', async () => {
  const client = createClient();
  const expired = {
    status: 401,
    headers: { get: (name) => (name === 'X-Session-Expired' ? '1' : null) },
  };
  client.setResponse(expired);
  const returned = await client.window.fetch('/milab/api/dashboard/usuarios/685/correo');
  assert.equal(returned, expired);
  assert.deepEqual(client.redirects, ['/milab/']);
});

test('XHR session expiration also returns home', () => {
  const client = createClient();
  const xhr = new client.window.XMLHttpRequest();
  xhr.responseURL = 'https://milab.test/milab/api/submit';
  xhr.status = 401;
  xhr.send();
  client.xhrListeners.get('load')();
  assert.deepEqual(client.redirects, ['/milab/']);
});

test('permission denials and third-party 401 responses do not close the session', async () => {
  const client = createClient();
  client.setResponse({ status: 403, headers: { get: () => null } });
  await client.window.fetch('/milab/api/dashboard');
  client.setResponse({ status: 401, headers: { get: () => '1' } });
  await client.window.fetch('https://external.test/api');
  assert.equal(client.redirects.length, 0);
});

test('expiration timer checks server state without renewing it and respects activity in another tab', async () => {
  const client = createClient();
  const timer = [...client.timers.values()][0];
  assert.equal(timer.delay, 1800050);
  await timer.callback();
  assert.equal(client.requests[0].url, '/milab/auth/session/status');
  assert.equal(client.requests[0].options.method, 'GET');
  assert.equal(client.redirects.length, 0);
  assert.equal(client.timers.size, 1);
});

test('network failures are visible and do not masquerade as logout', async () => {
  const client = createClient();
  client.setResponse(new Error('Network offline'));
  await [...client.timers.values()][0].callback();
  assert.equal(client.errors.length, 1);
  assert.ok(client.document.getElementById('session-connection-error'));
  assert.equal(client.redirects.length, 0);
  assert.equal([...client.timers.values()].at(-1).delay, 15000);
});
