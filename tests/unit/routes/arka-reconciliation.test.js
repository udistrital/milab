const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const {
  loadModuleWithStubs,
  resolveRepoPath,
} = require('../../integration/helpers/build-test-app');
const { createSessionHarness, createUser } = require('../../integration/helpers/session-fixtures');

const routePath = resolveRepoPath('src/routes/api/arka-reconciliation.js');
const dbPath = resolveRepoPath('src/libs/db.js');
const arkaClientPath = resolveRepoPath('src/libs/arka-reconciliation-client.js');
const servicePath = resolveRepoPath('src/libs/arka-reconciliation-service.js');
const authPath = resolveRepoPath('src/routes/middlewares/auth.js');
const realAuthModule = require(authPath);

class ArkaIntegrationError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function loadArkaRoute({ client, user } = {}) {
  const sessionHarness = createSessionHarness({
    user: createUser({
      roles: ['admin'],
      tipo: 'admin',
      ...user,
    }),
  });
  const loaded = loadModuleWithStubs({
    entryPath: routePath,
    stubs: [
      [dbPath, { query: async () => ({ rows: [] }) }],
      [
        arkaClientPath,
        {
          ArkaIntegrationError,
          createArkaClient: () => client,
        },
      ],
      [servicePath, { createArkaReconciliationService: () => ({}) }],
      [authPath, realAuthModule],
    ],
    purgePaths: [routePath],
  });
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    sessionHarness.attach(req);
    res.render = (view, locals) => res.status(res.statusCode || 200).json({ view, locals });
    next();
  });
  app.use(loaded.loaded);
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    return res.status(error?.status || 500).json({
      error: error?.message || 'Unexpected test error',
    });
  });

  return { app, restore: loaded.restore };
}

test('inventory search resolves and returns ARKA inventory by document for read-only roles', async () => {
  const calls = [];
  const loaded = loadArkaRoute({
    user: { roles: ['coordinador_general'], tipo: 'coordinador_general' },
    client: {
      async getInventoryByDocument(document) {
        calls.push(document);
        return {
          terceroId: 1165,
          items: [{ arkaId: 41, placa: 'ARKA-001', nombre: 'Microscopio' }],
        };
      },
    },
  });

  try {
    const response = await request(loaded.app)
      .post('/buscar-inventario')
      .type('form')
      .send({ documento: ' 1030672 ' });

    assert.equal(response.status, 200);
    assert.deepEqual(calls, ['1030672']);
    assert.deepEqual(response.body.locals.inventorySearch, {
      documento: '1030672',
      terceroId: 1165,
      items: [{ arkaId: 41, placa: 'ARKA-001', nombre: 'Microscopio' }],
    });
  } finally {
    loaded.restore();
  }
});

test('inventory search rejects an invalid document without querying ARKA', async () => {
  let clientCalls = 0;
  const loaded = loadArkaRoute({
    client: {
      async getInventoryByDocument() {
        clientCalls += 1;
        return { terceroId: 1165, items: [] };
      },
    },
  });

  try {
    const response = await request(loaded.app)
      .post('/buscar-inventario')
      .type('form')
      .send({ documento: ' ' });

    assert.equal(response.status, 400);
    assert.match(response.body.locals.inventorySearchError, /número de documento válido/i);
    assert.equal(clientCalls, 0);
  } finally {
    loaded.restore();
  }
});

test('inventory search renders a safe integration error when the third party is not found', async () => {
  const loaded = loadArkaRoute({
    client: {
      async getInventoryByDocument() {
        throw new ArkaIntegrationError(
          'Terceros no encontró un identificador para el documento consultado.',
          'ARKA_THIRD_PARTY_NOT_FOUND'
        );
      },
    },
  });

  try {
    const response = await request(loaded.app)
      .post('/buscar-inventario')
      .type('form')
      .send({ documento: '1030672' });

    assert.equal(response.status, 404);
    assert.match(response.body.locals.inventorySearchError, /Terceros no encontró/i);
    assert.equal(response.body.locals.inventorySearch, null);
  } finally {
    loaded.restore();
  }
});
