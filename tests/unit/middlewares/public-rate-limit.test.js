const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../../src/routes/middlewares/public-rate-limit.js');
const rateLimitPath = require.resolve('express-rate-limit');

function loadModule() {
  const originalRateLimit = require.cache[rateLimitPath];
  const captured = [];

  delete require.cache[modulePath];
  require.cache[rateLimitPath] = {
    id: rateLimitPath,
    filename: rateLimitPath,
    loaded: true,
    exports: (options) => {
      captured.push(options);
      const middleware = (req, res, next) => next();
      middleware._options = options;
      return middleware;
    },
  };

  const exported = require(modulePath);
  return {
    exported,
    captured,
    restore() {
      if (originalRateLimit) {
        require.cache[rateLimitPath] = originalRateLimit;
      } else {
        delete require.cache[rateLimitPath];
      }

      delete require.cache[modulePath];
    },
  };
}

function createResponse() {
  return {
    statusCode: 200,
    payload: null,
    rendered: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
    render(view, payload) {
      this.rendered = { view, payload };
      return this;
    },
  };
}

test('public-rate-limit configures API and page limiters with expected max values', () => {
  const loaded = loadModule();

  try {
    assert.equal(loaded.captured.length, 2);
    assert.equal(loaded.captured[0].max, 20);
    assert.equal(loaded.captured[1].max, 30);
  } finally {
    loaded.restore();
  }
});

test('publicApiLimiter handler responds with 429 JSON message', () => {
  const loaded = loadModule();

  try {
    const res = createResponse();
    loaded.captured[0].handler({}, res);

    assert.equal(res.statusCode, 429);
    assert.match(res.payload.error, /Demasiadas solicitudes/i);
  } finally {
    loaded.restore();
  }
});

test('publicPageLimiter handler responds with 429 rendered message', () => {
  const loaded = loadModule();

  try {
    const res = createResponse();
    loaded.captured[1].handler({}, res);

    assert.equal(res.statusCode, 429);
    assert.equal(res.rendered.view, 'home/message_error');
    assert.match(res.rendered.payload.message2, /Inténtalo nuevamente/i);
  } finally {
    loaded.restore();
  }
});
