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

test('an unconfirmed preview blocks the selected inventory panel and links to its report', async () => {
  const loaded = loadInventoryApp(
    createUser({ tipo: 'laboratorista', roles: ['laboratorista'], documento: 'lab-1' }),
    async (sql) => {
      if (sql.includes('JOIN dependencia_facultad df')) {
        return {
          rows: [
            {
              ual_id: 4,
              nombre: 'Laboratorio de prueba',
              facultad: 'Facultad de prueba',
              dependencia: 'Dependencia de prueba',
            },
          ],
        };
      }
      if (sql.includes('FROM inventario_carga') && sql.includes('estado IN')) {
        return {
          rows: [
            {
              id: 42,
              tipo_inventario: 'equipo_arka',
              estado: 'previsualizada',
              creada_por_documento: 'lab-1',
            },
          ],
        };
      }
      return { rows: [] };
    }
  );

  try {
    const response = await request(loaded.app).get(
      '/gestion_inventario?ual_id=4&panel=equipo_arka'
    );
    const equipmentStatus = response.body.locals.statuses.find(
      (status) => status.tipo_inventario === 'equipo_arka'
    );

    assert.equal(response.status, 200);
    assert.equal(equipmentStatus.estado, 'previsualizada');
    assert.equal(equipmentStatus.bloqueado, true);
    assert.equal(equipmentStatus.carga_previsualizada_id, 42);
  } finally {
    loaded.restore();
  }
});

test('the laboratorista who created a preview can confirm it from recent loads', async () => {
  const loaded = loadInventoryApp(
    createUser({ tipo: 'laboratorista', roles: ['laboratorista'], documento: 'lab-1' }),
    async (sql) => {
      if (sql.includes('JOIN dependencia_facultad df')) {
        return {
          rows: [
            {
              ual_id: 4,
              nombre: 'Laboratorio de prueba',
              facultad: 'Facultad de prueba',
              dependencia: 'Dependencia de prueba',
            },
          ],
        };
      }
      if (sql.includes('SELECT DISTINCT c.documento, c.nombre')) {
        return { rows: [{ documento: 'coord-1', nombre: 'Coordinador de prueba' }] };
      }
      if (sql.includes('FROM inventario_carga c') && sql.includes('ORDER BY c.fecha_creacion')) {
        return {
          rows: [
            {
              id: 43,
              tipo_inventario: 'equipo_arka',
              estado: 'previsualizada',
              archivo_nombre: 'inventario.xlsx',
              creada_por_documento: 'lab-1',
              fecha_creacion: '2026-10-13T21:00:00-05:00',
              total_filas: 1,
              filas_exitosas: 1,
              filas_fallidas: 0,
              declaracion_sin_inventario: false,
              primera_fila_original: {
                placa: 'ARKA-001',
                descripcion: 'Microscopio',
                'codigo catalogo': 'CAT-001',
              },
            },
          ],
        };
      }
      return { rows: [] };
    }
  );

  try {
    const response = await request(loaded.app).get('/gestion_inventario?ual_id=4&panel=recent');
    const [preview] = response.body.locals.recentLoads;

    assert.equal(response.status, 200);
    assert.equal(preview.puedeConfirmar, true);
    assert.deepEqual(preview.additionalIdentifierHeaders, ['codigo catalogo']);
    assert.equal(response.body.locals.coordinators[0].documento, 'coord-1');
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
