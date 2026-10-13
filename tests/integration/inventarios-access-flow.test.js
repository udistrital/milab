const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { buildApp, resolveRepoPath } = require('./helpers/build-test-app');
const { createSessionHarness, createUser } = require('./helpers/session-fixtures');

const routerPath = resolveRepoPath('src/routes/api/inventarios.js');
const dbPath = resolveRepoPath('src/libs/db.js');

function loadInventoryApp(user, queryImpl = async () => ({ rows: [] })) {
  const sessionHarness = createSessionHarness({ user });
  const queries = [];
  const loaded = buildApp({
    entryPath: routerPath,
    sessionHarness,
    stubs: [
      [
        dbPath,
        {
          async query(sql, params) {
            queries.push({ sql, params });
            return queryImpl(sql, params);
          },
          async connect() {
            throw new Error('Unexpected database transaction in read-only inventory test');
          },
        },
      ],
    ],
    purgePaths: [routerPath],
  });

  return {
    ...loaded,
    queries,
  };
}

test('inventory access scopes coordinators to assigned faculty and dependencies', async () => {
  const loaded = loadInventoryApp(
    createUser({ tipo: 'coordinador', roles: ['coordinador'], documento: 'coord-1' })
  );

  try {
    const response = await request(loaded.app).get('/gestion_inventario');
    const laboratoryQuery = loaded.queries.find(({ sql }) => sql.includes('FROM ual u'));

    assert.equal(response.status, 200);
    assert.deepEqual(laboratoryQuery.params, [false, false, 'coord-1', true]);
    assert.equal(response.body.locals.isGlobalInventoryViewer, false);
    assert.equal(response.body.locals.laboratories.length, 0);
  } finally {
    loaded.restore();
  }
});

test('inventory access scopes laboratoristas to assigned laboratories', async () => {
  const loaded = loadInventoryApp(
    createUser({ tipo: 'laboratorista', roles: ['laboratorista'], documento: 'lab-1' })
  );

  try {
    const response = await request(loaded.app).get('/gestion_inventario');
    const laboratoryQuery = loaded.queries.find(({ sql }) => sql.includes('FROM ual u'));

    assert.equal(response.status, 200);
    assert.deepEqual(laboratoryQuery.params, [false, true, 'lab-1', false]);
    assert.equal(response.body.locals.isGlobalInventoryViewer, false);
  } finally {
    loaded.restore();
  }
});

test('coordinador_general can view all inventory and approvals without resolving them', async () => {
  const loaded = loadInventoryApp(
    createUser({
      tipo: 'coordinador_general',
      roles: ['coordinador_general'],
      documento: 'coord-general-1',
    }),
    async (sql) => {
      if (sql.includes('FROM inventario_carga c') && sql.includes('WHERE c.id = $1')) {
        return { rows: [{ id: 7, estado: 'pendiente_aprobacion' }] };
      }
      return { rows: [] };
    }
  );

  try {
    const management = await request(loaded.app).get('/gestion_inventario');
    const laboratoryQuery = loaded.queries.find(({ sql }) => sql.includes('FROM ual u'));
    assert.equal(management.status, 200);
    assert.deepEqual(laboratoryQuery.params, [true, false, 'coord-general-1', false]);
    assert.equal(management.body.locals.isGlobalInventoryViewer, true);
    assert.equal(management.body.locals.isEditor, false);

    loaded.queries.length = 0;
    const approvalDetail = await request(loaded.app).get('/aprobaciones/7');
    const approvalQuery = loaded.queries.find(({ sql }) => sql.includes('WHERE c.id = $1'));
    assert.equal(approvalDetail.status, 200);
    assert.equal(approvalQuery.params[1], true);
    assert.equal(approvalDetail.body.locals.canResolve, false);

    const resolution = await request(loaded.app)
      .post('/aprobaciones/7/resolver')
      .type('form')
      .send({ decision: 'aprobar' });
    assert.equal(
      resolution.body.locals.message2,
      'El rol coordinador general tiene acceso de solo lectura.'
    );
  } finally {
    loaded.restore();
  }
});
