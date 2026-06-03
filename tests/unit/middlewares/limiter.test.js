const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../../src/routes/middlewares/limiter.js');
const rateLimitPath = require.resolve('express-rate-limit');

function loadLimiterModule() {
  const originalRateLimit = require.cache[rateLimitPath];
  let capturedOptions;

  delete require.cache[modulePath];
  require.cache[rateLimitPath] = {
    id: rateLimitPath,
    filename: rateLimitPath,
    loaded: true,
    exports: (options) => {
      capturedOptions = options;
      return (req, res, next) => next();
    },
  };

  const limiter = require(modulePath);

  return {
    limiter,
    getOptions: () => capturedOptions,
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

function createRenderResponse() {
  return {
    statusCode: 200,
    headers: {},
    rendered: null,
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    render(view, payload) {
      this.rendered = { view, payload };
      return this;
    },
  };
}

test('limiter configures express-rate-limit with expected window and max', () => {
  const loaded = loadLimiterModule();

  try {
    const options = loaded.getOptions();
    assert.equal(options.windowMs, 60000);
    assert.equal(options.max, 4);
    assert.equal(typeof options.handler, 'function');
  } finally {
    loaded.restore();
  }
});

test('limiter handler blocks exhausted IP and ipBlockMiddleware rejects subsequent requests', () => {
  const loaded = loadLimiterModule();

  try {
    const req = {
      ip: '10.0.0.1',
      originalUrl: '/auth/login',
      rateLimit: { remaining: 0 },
    };
    const res = createRenderResponse();
    let nextCalled = false;

    loaded.getOptions().handler(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.headers['X-IP-BLOCKED'], 'true');
    assert.equal(res.rendered.view, 'home/login_2');

    const blockedReq = { ip: '10.0.0.1' };
    const blockedRes = createRenderResponse();
    let blockedNextCalled = false;
    loaded.limiter.ipBlockMiddleware(blockedReq, blockedRes, () => {
      blockedNextCalled = true;
    });

    assert.equal(blockedNextCalled, false);
    assert.equal(blockedRes.statusCode, 429);
    assert.equal(blockedRes.rendered.view, 'home/message_error');
  } finally {
    loaded.restore();
  }
});
