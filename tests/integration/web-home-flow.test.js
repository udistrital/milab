const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

const { buildApp, resolveRepoPath } = require('./helpers/build-test-app');
const { createSessionHarness, createUser } = require('./helpers/session-fixtures');

const appPath = resolveRepoPath('src/milab_routes.js');
const indexPath = resolveRepoPath('src/routes/api/index.js');
const prestamosPath = resolveRepoPath('src/routes/api/prestamos.js');
const dbPath = resolveRepoPath('src/libs/db.js');
const homePath = resolveRepoPath('src/routes/web/home.js');

function emptyRouter() {
  return express.Router();
}

function loadMilabHomeApp(sessionState) {
  const sessionHarness = createSessionHarness(sessionState);
  return buildApp({
    entryPath: appPath,
    sessionHarness,
    stubs: [
      [indexPath, emptyRouter()],
      [prestamosPath, emptyRouter()],
      [
        dbPath,
        {
          query: async () => ({ rows: [] }),
          connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
        },
      ],
    ],
    purgePaths: [appPath, indexPath, prestamosPath, homePath],
  });
}

test('mounted home flow renders public landing and preserves canonical redirects', async () => {
  const loaded = loadMilabHomeApp({});

  try {
    const landing = await request(loaded.app).get('/');
    assert.equal(landing.status, 200);
    assert.equal(landing.body.view, 'home/index_2');

    const inicio = await request(loaded.app).get('/inicio');
    assert.equal(inicio.status, 302);
    assert.equal(inicio.headers.location, '/milab/');

    const consulta = await request(loaded.app).get('/consulta');
    assert.equal(consulta.status, 302);
    assert.equal(consulta.headers.location, '/milab/api/consulta-invit');
  } finally {
    loaded.restore();
  }
});

test('mounted home flow redirects authenticated users away from public auth pages', async () => {
  const loaded = loadMilabHomeApp({
    user: createUser({ tipo: 'coordinador', roles: ['coordinador'] }),
  });

  try {
    const response = await request(loaded.app).get('/auth/login');

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/milab/inicio');
  } finally {
    loaded.restore();
  }
});
