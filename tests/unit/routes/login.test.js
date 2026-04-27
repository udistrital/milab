const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/login.js');
const limiterPath = path.resolve(__dirname, '../../../src/routes/middlewares/limiter.js');

function buildApp(route) {
  const app = express();

  app.use(express.urlencoded({ extended: false }));
  app.use('/auth', route);

  return app;
}

function loadLoginRoute() {
  const originalLimiter = require.cache[limiterPath];

  delete require.cache[routePath];
  require.cache[limiterPath] = {
    id: limiterPath,
    filename: limiterPath,
    loaded: true,
    exports: (req, res, next) => next(),
  };

  return {
    route: require(routePath),
    restore() {
      if (originalLimiter) {
        require.cache[limiterPath] = originalLimiter;
      } else {
        delete require.cache[limiterPath];
      }

      delete require.cache[routePath];
    },
  };
}

test('login redirects to Microsoft authentication', async () => {
  const loaded = loadLoginRoute();

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/auth/login').type('form').send({
      documento: '123456',
      password: 'secret',
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/auth/microsoft');
  } finally {
    loaded.restore();
  }
});
