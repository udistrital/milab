const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('node:fs');
const ejs = require('ejs');

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

test('all inventory profiles require active laboratorista and coordinator assignments before role scope', async () => {
  for (const role of ['admin', 'coordinador_general', 'coordinador', 'laboratorista']) {
    const loaded = loadInventoryApp(createUser({ tipo: role, roles: [role] }));
    try {
      const response = await request(loaded.app).get('/gestion_inventario');
      assert.equal(response.status, 200, role);
      const { sql } = loaded.queries.find(({ sql }) =>
        sql.includes('JOIN dependencia_facultad facultad')
      );
      const eligibility = sql.slice(
        sql.indexOf('WHERE u.activo = TRUE'),
        sql.indexOf('$1::boolean')
      );
      assert.match(eligibility, /AND EXISTS \(\s*SELECT 1\s*FROM laboratorista_ual assigned_lab/);
      assert.match(
        eligibility,
        /JOIN laboratorista lab\s+ON lab.documento = assigned_lab.laboratorista_documento_id\s+AND lab.activo = TRUE/
      );
      assert.match(
        eligibility,
        /WHERE assigned_lab.ual_id = u.ual_id\s+AND assigned_lab.activo = TRUE/
      );
      assert.match(
        eligibility,
        /AND EXISTS \(\s*SELECT 1\s*FROM coordinador_facultad_alcance assigned_scope/
      );
      assert.match(
        eligibility,
        /JOIN coordinador assigned_coordinator\s+ON assigned_coordinator.documento = assigned_scope.coordinador_documento_id\s+AND assigned_coordinator.activo = TRUE/
      );
      assert.match(
        eligibility,
        /WHERE assigned_scope.facultad_id = u.facultad_id\s+AND assigned_scope.activo = TRUE/
      );
      assert.doesNotMatch(eligibility, /\bOR\b/);
    } finally {
      loaded.restore();
    }
  }
});

test('a laboratory omitted by readiness requirements cannot be selected directly by any role', async () => {
  for (const role of ['admin', 'coordinador_general', 'coordinador', 'laboratorista']) {
    const loaded = loadInventoryApp(createUser({ tipo: role, roles: [role] }));
    try {
      const response = await request(loaded.app).get('/gestion_inventario?ual_id=999');
      assert.equal(response.status, 403, role);
      assert.match(response.body.locals.message2, /No tienes acceso al laboratorio seleccionado/);
      assert.equal(
        loaded.queries.some(({ sql }) => sql.includes('FROM inventario_estado_laboratorio')),
        false
      );
    } finally {
      loaded.restore();
    }
  }
});

test('inventory location selectors match each role and restore the selected UAL hierarchy', async () => {
  const units = [
    { id: 1, nombre: 'Facultad Uno', facultad_id: null },
    { id: 10, nombre: 'Dependencia Uno', facultad_id: 1 },
    { id: 11, nombre: 'Dependencia sin UAL', facultad_id: 1 },
  ];
  const laboratory = {
    ual_id: 4,
    nombre: 'Laboratorio asignado',
    facultad_id: 1,
    dependencia_id: 10,
    facultad: 'Facultad Uno',
    dependencia: 'Dependencia Uno',
  };
  const template = fs.readFileSync(
    resolveRepoPath('src/views/home/inventarios/gestion_inventario/index.ejs'),
    'utf8'
  );

  for (const role of ['admin', 'coordinador_general', 'coordinador', 'laboratorista']) {
    const globalViewer = ['admin', 'coordinador_general'].includes(role);
    const loaded = loadInventoryApp(
      createUser({ tipo: role, roles: [role], documento: 'user-1' }),
      async (sql) => {
        if (sql.includes('FROM dependencia_facultad df')) {
          return { rows: globalViewer ? units : units.filter((unit) => unit.facultad_id) };
        }
        if (sql.includes('JOIN dependencia_facultad df')) return { rows: [laboratory] };
        return { rows: [] };
      }
    );

    try {
      const response = await request(loaded.app).get('/gestion_inventario?ual_id=4');
      assert.equal(response.status, 200, role);
      const html = ejs.render(template, { ...response.body.locals, include: () => '' });
      assert.equal(html.includes('id="inventory-faculty"'), globalViewer, role);
      assert.equal(html.includes('id="inventory-dependency"'), role !== 'laboratorista', role);
      assert.match(html, /data-faculty-id="1"/);
      assert.match(html, /data-dependency-id="10"/);
      assert.match(html, /value="4"[\s\S]*?selected/);
      assert.match(html, /\/milab\/js\/inventory-location-filters.js/);
      const unitsQuery = loaded.queries.find(({ sql }) =>
        sql.includes('FROM dependencia_facultad df')
      );
      if (role === 'laboratorista') {
        assert.equal(unitsQuery, undefined);
      } else {
        assert.deepEqual(unitsQuery.params, [globalViewer, role === 'coordinador', 'user-1']);
        assert.match(unitsQuery.sql, /ca\.facultad_id = df\.dependencia_facultad_id/);
        assert.match(unitsQuery.sql, /ca\.activo = TRUE/);
        assert.match(html, /Dependencia sin UAL/);
        assert.match(html, /value="10"[\s\S]*?selected/);
      }
      if (globalViewer) assert.match(html, /value="1"\s+selected/);
    } finally {
      loaded.restore();
    }
  }
});

test('location filters cannot grant access to an unassigned inventory laboratory', async () => {
  for (const role of ['coordinador', 'laboratorista']) {
    const loaded = loadInventoryApp(createUser({ tipo: role, roles: [role] }));
    try {
      const response = await request(loaded.app).get(
        '/gestion_inventario?ual_id=999&facultad_id=1&dependencia_id=10'
      );
      assert.equal(response.status, 403);
      assert.match(response.body.locals.message2, /No tienes acceso/);
      assert.equal(
        loaded.queries.some(({ sql }) => sql.includes('FROM inventario_estado_laboratorio')),
        false
      );
    } finally {
      loaded.restore();
    }
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

test('inventory management shows and preselects only the laboratory coordinator once assigned', async () => {
  const loaded = loadInventoryApp(
    createUser({ tipo: 'laboratorista', roles: ['laboratorista'], documento: 'lab-1' }),
    async (sql) => {
      if (sql.includes('JOIN dependencia_facultad df')) {
        return {
          rows: [
            {
              ual_id: 4,
              nombre: 'Laboratorio Uno',
              facultad_id: 1,
              facultad: 'Facultad Uno',
              dependencia: 'Dependencia Uno',
              coordinador_encargado_documento: 'coord-owner',
              coordinador_encargado_nombre: 'Coordinador Encargado',
            },
          ],
        };
      }
      if (sql.includes('SELECT DISTINCT c.documento, c.nombre')) {
        assert.match(sql, /NOT EXISTS \(\s+SELECT 1 FROM coordinador_ual_encargado/);
        assert.match(sql, /encargado\.coordinador_documento <> c.documento/);
        return {
          rows: [{ documento: 'coord-owner', nombre: 'Coordinador Encargado', encargado: true }],
        };
      }
      if (sql.includes('FROM inventario_carga c')) {
        return {
          rows: [
            {
              id: 43,
              tipo_inventario: 'complementario',
              estado: 'previsualizada',
              archivo_nombre: 'inventario.xlsx',
              creada_por_documento: 'lab-1',
              total_filas: 1,
              filas_exitosas: 1,
              filas_fallidas: 0,
            },
          ],
        };
      }
      return { rows: [] };
    }
  );
  try {
    const response = await request(loaded.app).get('/gestion_inventario?ual_id=4&panel=recent');
    assert.equal(response.status, 200);
    assert.equal(response.body.locals.coordinators.length, 1);
    const html = ejs.render(
      fs.readFileSync(
        resolveRepoPath('src/views/home/inventarios/gestion_inventario/index.ejs'),
        'utf8'
      ),
      { ...response.body.locals, include: () => '' }
    );
    assert.match(html, /Coordinador encargado:/);
    assert.match(html, /Coordinador Encargado/);
    assert.match(html, /value="coord-owner"\s+selected/);
    assert.match(html, /Las siguientes cargas solo se envían a este coordinador/);
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

test('pending inventory approvals display the laboratorista name and document', async () => {
  const batch = {
    id: 7,
    laboratorio: 'Laboratorio Uno',
    dependencia: 'Dependencia Uno',
    tipo_inventario: 'equipo_arka',
    archivo_nombre: 'inventario.xlsx',
    fecha_creacion: '2026-10-14T18:00:00-05:00',
    filas_exitosas: 1,
    creada_por_documento: 'lab-1',
    solicitante_nombre: 'Laboratorista Uno',
  };
  const loaded = loadInventoryApp(
    createUser({ tipo: 'coordinador', roles: ['coordinador'] }),
    async () => ({ rows: [batch] })
  );
  try {
    const response = await request(loaded.app).get('/aprobaciones');
    assert.equal(response.status, 200);
    assert.match(loaded.queries[0].sql, /LEFT JOIN laboratorista solicitante/);
    assert.match(loaded.queries[0].sql, /solicitante\.nombre AS solicitante_nombre/);
    const template = fs.readFileSync(
      resolveRepoPath('src/views/home/inventarios/aprobaciones/index.ejs'),
      'utf8'
    );
    const html = ejs.render(template, { ...response.body.locals, include: () => '' });
    assert.match(html, /Laboratorista solicitante/);
    assert.match(html, /Laboratorista Uno/);
    assert.match(html, /lab-1/);
    assert.match(html, /\/aprobaciones\/7/);
  } finally {
    loaded.restore();
  }
});

test('approval review bounds long descriptions, escapes content and exposes navigation and confirmation', async () => {
  const description = 'Descripción extensa <script>no ejecutar</script> '.repeat(30);
  const loaded = loadInventoryApp(
    createUser({ tipo: 'coordinador', roles: ['coordinador'] }),
    async (sql) => {
      if (sql.includes('FROM inventario_carga c')) {
        return {
          rows: [
            {
              id: 7,
              estado: 'pendiente_aprobacion',
              tipo_inventario: 'equipo_arka',
              laboratorio: 'Laboratorio Uno',
              dependencia: 'Dependencia Uno',
              creada_por_documento: 'lab-1',
              solicitante_nombre: 'Laboratorista Uno',
            },
          ],
        };
      }
      return {
        rows: [
          { estado: 'pendiente_aprobacion', numero_fila: 2, payload: { descripcion: description } },
          { estado: 'pendiente_aprobacion', numero_fila: 3, payload: { descripcion: 'Corta' } },
        ],
      };
    }
  );
  try {
    const response = await request(loaded.app).get('/aprobaciones/7');
    assert.equal(response.status, 200);
    const template = fs.readFileSync(
      resolveRepoPath('src/views/home/inventarios/aprobaciones/detalle.ejs'),
      'utf8'
    );
    const html = ejs.render(template, { ...response.body.locals, include: () => '' });
    assert.match(html, /Laboratorista Uno/);
    assert.match(html, /inventory-review-description-cell/);
    assert.equal((html.match(/data-description-toggle/g) || []).length, 1);
    assert.match(html, /data-grid-action-ignore aria-expanded="false">Ver más/);
    assert.match(html, /&lt;script&gt;no ejecutar&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>no ejecutar/);
    assert.match(html, /href="#inventoryReviewEnd"/);
    assert.match(html, /href="#inventoryReviewStart"/);
    assert.match(html, /data-confirm-submit=/);
    assert.match(html, /name="decision"\s+value="rechazar"/);
    assert.match(html, /name="decision"\s+value="aprobar"/);
  } finally {
    loaded.restore();
  }
});
