const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const modulePath = path.resolve(__dirname, '../../../src/routes/api/get-estado-multa.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const limiterPath = path.resolve(__dirname, '../../../src/routes/middlewares/public-rate-limit.js');

function loadRouteWithStubs(poolQueryImpl) {
  const originals = new Map();

  const poolStub = {
    async query(sql, params = []) {
      return poolQueryImpl(sql, params);
    },
  };

  const limiterStub = {
    publicApiLimiter: (req, res, next) => next(),
  };

  delete require.cache[modulePath];

  for (const [stubPath, stubExports] of [
    [dbPath, poolStub],
    [limiterPath, limiterStub],
  ]) {
    originals.set(stubPath, require.cache[stubPath]);
    require.cache[stubPath] = {
      id: stubPath,
      filename: stubPath,
      loaded: true,
      exports: stubExports,
    };
  }

  const route = require(modulePath);
  const app = express();
  app.use((req, _res, next) => {
    req.log = { warn: () => {} };
    next();
  });
  app.use('/', route);

  return {
    app,
    restore() {
      for (const [stubPath, original] of originals.entries()) {
        if (original) {
          require.cache[stubPath] = original;
        } else {
          delete require.cache[stubPath];
        }
      }
      delete require.cache[modulePath];
    },
  };
}

test('get-estado-multa exports an Express router with handlers', () => {
  delete require.cache[modulePath];
  const router = require(modulePath);

  assert.equal(typeof router, 'function');
  assert.equal(typeof router.use, 'function');
  assert.equal(Array.isArray(router.stack), true);
  assert.equal(router.stack.length > 0, true);
});

test('get-estado-multa rejects invalid identifiers with 400', async () => {
  const loaded = loadRouteWithStubs(async () => ({ rows: [] }));

  try {
    const response = await request(loaded.app).get('/abc-12');

    assert.equal(response.status, 400);
    assert.match(String(response.body.error || ''), /Documento invalido|Documento inválido/i);
  } finally {
    loaded.restore();
  }
});

test('get-estado-multa adds no-cache headers and returns paz y salvo by default', async () => {
  const loaded = loadRouteWithStubs(async (sql) => {
    if (sql.includes('information_schema.columns')) {
      return { rows: [] };
    }
    return { rows: [] };
  });

  try {
    const response = await request(loaded.app).get('/20211102026');

    assert.equal(response.status, 200);
    assert.equal(response.body.multado, false);
    assert.equal(response.body.estado, 'PAZ_Y_SALVO');
    assert.equal(response.headers['cache-control'], 'no-store, max-age=0');
    assert.equal(response.headers.pragma, 'no-cache');
  } finally {
    loaded.restore();
  }
});
