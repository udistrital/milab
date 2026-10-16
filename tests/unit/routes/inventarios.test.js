const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const fs = require('node:fs');
const ejs = require('ejs');
const XLSX = require('xlsx');
const {
  loadModuleWithStubs,
  resolveRepoPath,
} = require('../../integration/helpers/build-test-app');
const { createSessionHarness, createUser } = require('../../integration/helpers/session-fixtures');
const { INVENTORY_TYPES, parseWorkbook, validateInventoryRows } = require(
  resolveRepoPath('src/libs/inventario-import.js')
);

const routePath = resolveRepoPath('src/routes/api/inventarios.js');
const dbPath = resolveRepoPath('src/libs/db.js');
const authPath = resolveRepoPath('src/routes/middlewares/auth.js');
const realAuthModule = require(authPath);

function createWorkbookBuffer(rows) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventario');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

function loadInventoryRoute({ pool, user } = {}) {
  const sessionHarness = createSessionHarness({
    csrfToken: 'test-csrf-token',
    user: createUser({
      tipo: 'laboratorista',
      roles: ['laboratorista'],
      documento: 'lab-1',
      nombre: 'Laboratorista Uno',
      ...user,
    }),
  });
  const loaded = loadModuleWithStubs({
    entryPath: routePath,
    stubs: [
      [dbPath, pool || { query: async () => ({ rows: [] }), connect: async () => ({}) }],
      [authPath, realAuthModule],
    ],
    purgePaths: [routePath],
  });
  const app = express();
  app.use(express.json());
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

function createTransactionClient(onQuery = () => ({ rows: [] })) {
  const calls = [];
  return {
    calls,
    client: {
      async query(sql, params) {
        calls.push({ sql, params });
        return onQuery(sql, params);
      },
      release() {},
    },
  };
}

test('inventory example templates download importable workbooks for every type', async () => {
  const loaded = loadInventoryRoute();

  try {
    for (const inventoryType of Object.values(INVENTORY_TYPES)) {
      const response = await request(loaded.app)
        .get(`/plantillas/${inventoryType}`)
        .buffer(true)
        .parse((res, callback) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        });

      assert.equal(response.status, 200);
      assert.match(
        response.headers['content-type'],
        /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/
      );
      assert.match(
        response.headers['content-disposition'],
        new RegExp(`plantilla_ejemplo_${inventoryType}\\.xlsx`)
      );

      const parsedWorkbook = parseWorkbook(response.body, `plantilla_${inventoryType}.xlsx`);
      const rows = validateInventoryRows(parsedWorkbook, inventoryType);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].estado, 'exitosa');

      const workbook = XLSX.read(response.body, { type: 'buffer' });
      assert.deepEqual(workbook.SheetNames, ['Inventario', 'Instrucciones']);
    }

    const invalidTypeResponse = await request(loaded.app).get('/plantillas/invalid');
    assert.equal(invalidTypeResponse.status, 404);
  } finally {
    loaded.restore();
  }
});

test('inventory upload is denied for roles without inventory permissions', async () => {
  let queryCalls = 0;
  const loaded = loadInventoryRoute({
    pool: {
      async query() {
        queryCalls += 1;
        return { rows: [] };
      },
      async connect() {
        queryCalls += 1;
        throw new Error('Database should not be reached');
      },
    },
    user: { tipo: 'estudiante', roles: ['estudiante'] },
  });

  try {
    const response = await request(loaded.app).post('/cargas/previsualizar');
    assert.equal(response.status, 200);
    assert.match(response.body.locals.message2, /solo el laboratorista asignado/i);
    assert.equal(queryCalls, 0);
  } finally {
    loaded.restore();
  }
});

test('inventory upload rejects a laboratory outside the laboratorista assignment', async () => {
  let transactionCalls = 0;
  const loaded = loadInventoryRoute({
    pool: {
      async query() {
        return { rows: [{ permitido: false }] };
      },
      async connect() {
        transactionCalls += 1;
        throw new Error('Transaction should not be reached');
      },
    },
  });

  try {
    const response = await request(loaded.app)
      .post('/cargas/previsualizar')
      .field('_csrf', 'test-csrf-token')
      .field('ual_id', '99')
      .field('tipo_inventario', 'equipo_arka')
      .attach(
        'archivo',
        createWorkbookBuffer([
          ['PLACA', 'DESCRIPCIÓN'],
          ['ARKA-001', 'Microscopio'],
        ]),
        'inventario.xlsx'
      );

    assert.equal(response.status, 403);
    assert.match(response.body.locals.message2, /laboratorio no está asignado/i);
    assert.equal(transactionCalls, 0);
  } finally {
    loaded.restore();
  }
});

test('inventory upload rejects missing CSRF tokens before database access', async () => {
  let queryCalls = 0;
  const loaded = loadInventoryRoute({
    pool: {
      async query() {
        queryCalls += 1;
        return { rows: [] };
      },
      async connect() {
        throw new Error('Database should not be reached');
      },
    },
  });

  try {
    const response = await request(loaded.app)
      .post('/cargas/previsualizar')
      .field('ual_id', '1')
      .field('tipo_inventario', 'equipo_arka')
      .attach(
        'archivo',
        createWorkbookBuffer([
          ['PLACA', 'DESCRIPCIÓN'],
          ['ARKA-001', 'Microscopio'],
        ]),
        'inventario.xlsx'
      );

    assert.equal(response.status, 403);
    assert.equal(response.body.locals.status, 403);
    assert.match(response.body.locals.message2, /token de seguridad expiró o es inválido/i);
    assert.equal(queryCalls, 0);
  } finally {
    loaded.restore();
  }
});

test('inventory upload is blocked while that inventory type has an active preview or approval', async () => {
  let transactionCalls = 0;
  let lockQuery = '';
  const loaded = loadInventoryRoute({
    pool: {
      async query(sql) {
        if (sql.includes('inventario_estado_laboratorio')) {
          lockQuery = sql;
          return { rows: [{ inventario_aprobado: false, carga_pendiente: true }] };
        }
        if (sql.includes('SELECT EXISTS')) return { rows: [{ permitido: true }] };
        return { rows: [] };
      },
      async connect() {
        transactionCalls += 1;
        throw new Error('A locked inventory must not start a transaction');
      },
    },
  });

  try {
    const response = await request(loaded.app)
      .post('/cargas/previsualizar')
      .field('_csrf', 'test-csrf-token')
      .field('ual_id', '1')
      .field('tipo_inventario', 'equipo_arka')
      .attach(
        'archivo',
        createWorkbookBuffer([
          ['PLACA', 'DESCRIPCIÓN'],
          ['ARKA-001', 'Microscopio'],
        ]),
        'inventario.xlsx'
      );

    assert.equal(response.status, 302);
    const redirectUrl = new URL(response.headers.location, 'http://localhost');
    assert.equal(redirectUrl.searchParams.get('panel'), 'equipo_arka');
    assert.match(redirectUrl.searchParams.get('error'), /no se permiten más cargas/i);
    assert.ok(lockQuery.includes("'previsualizada', 'pendiente_aprobacion'"));
    assert.equal(transactionCalls, 0);
  } finally {
    loaded.restore();
  }
});

test('inventory preview cancellation unlocks the type and preserves its audit trail', async () => {
  const clientHarness = createTransactionClient((sql) => {
    if (sql.includes('SELECT * FROM inventario_carga WHERE id = $1 FOR UPDATE')) {
      return {
        rows: [
          {
            id: 18,
            ual_id: 4,
            tipo_inventario: 'complementario',
            creada_por_documento: 'lab-1',
            estado: 'previsualizada',
          },
        ],
      };
    }
    if (sql.includes('SELECT EXISTS')) return { rows: [{ permitido: true }] };
    if (sql.includes('UPDATE inventario_carga') && sql.includes('SET estado = $2')) {
      return { rows: [{ id: 18 }] };
    }
    return { rows: [] };
  });
  const loaded = loadInventoryRoute({
    pool: {
      async query() {
        return { rows: [] };
      },
      async connect() {
        return clientHarness.client;
      },
    },
  });

  try {
    const response = await request(loaded.app)
      .post('/cargas/18/cancelar')
      .type('form')
      .send({ _csrf: 'test-csrf-token' });

    assert.equal(response.status, 302);
    const redirectUrl = new URL(response.headers.location, 'http://localhost');
    assert.equal(redirectUrl.searchParams.get('panel'), 'complementario');
    assert.match(redirectUrl.searchParams.get('success'), /previsualización fue cancelada/i);
    assert.ok(
      clientHarness.calls.some(({ sql, params }) => {
        return sql.includes('SET estado = $2') && params[0] === 18 && params[1] === 'cancelada';
      })
    );
    assert.ok(
      clientHarness.calls.some(
        ({ sql, params }) =>
          sql.includes('INSERT INTO inventario_auditoria') && params[5] === 'carga_cancelada'
      )
    );
  } finally {
    loaded.restore();
  }
});

test('inventory preview cancellation is unavailable after sending to approval', async () => {
  const clientHarness = createTransactionClient((sql) => {
    if (sql.includes('SELECT * FROM inventario_carga WHERE id = $1 FOR UPDATE')) {
      return {
        rows: [
          {
            id: 19,
            ual_id: 4,
            tipo_inventario: 'reactivo',
            creada_por_documento: 'lab-1',
            estado: 'pendiente_aprobacion',
          },
        ],
      };
    }
    if (sql.includes('SELECT EXISTS')) return { rows: [{ permitido: true }] };
    return { rows: [] };
  });
  const loaded = loadInventoryRoute({
    pool: {
      async query() {
        return { rows: [] };
      },
      async connect() {
        return clientHarness.client;
      },
    },
  });

  try {
    const response = await request(loaded.app)
      .post('/cargas/19/cancelar')
      .type('form')
      .send({ _csrf: 'test-csrf-token' });

    assert.equal(response.status, 409);
    assert.match(response.body.locals.message2, /aún no se ha enviado/i);
    assert.equal(
      clientHarness.calls.some(({ sql }) => sql.includes("SET estado = 'cancelada'")),
      false
    );
  } finally {
    loaded.restore();
  }
});

test('complementary declaration requires explicit checkbox confirmation', async () => {
  let queryCalls = 0;
  const loaded = loadInventoryRoute({
    pool: {
      async query() {
        queryCalls += 1;
        return { rows: [] };
      },
      async connect() {
        throw new Error('A missing declaration checkbox must not reach the database');
      },
    },
  });

  try {
    const response = await request(loaded.app)
      .post('/declarar-sin-complementarios')
      .type('form')
      .send({ ual_id: '1', coordinador_documento: 'coord-1' });

    assert.equal(response.status, 302);
    const redirectUrl = new URL(response.headers.location, 'http://localhost');
    assert.equal(redirectUrl.searchParams.get('panel'), 'complementario');
    assert.match(redirectUrl.searchParams.get('error'), /marca la casilla/i);
    assert.equal(queryCalls, 0);
  } finally {
    loaded.restore();
  }
});

test('batch confirmation redirects until the laboratorista acknowledges the report', async () => {
  let transactionCalls = 0;
  const loaded = loadInventoryRoute({
    pool: {
      async query() {
        throw new Error('An incomplete confirmation must not query the database');
      },
      async connect() {
        transactionCalls += 1;
        throw new Error('An incomplete confirmation must not start a transaction');
      },
    },
  });

  try {
    const response = await request(loaded.app)
      .post('/cargas/18/confirmar')
      .type('form')
      .send({ coordinador_documento: 'coord-1' });

    assert.equal(response.status, 302);
    const redirectUrl = new URL(response.headers.location, 'http://localhost');
    assert.match(redirectUrl.searchParams.get('error'), /revisaste el reporte/i);
    assert.equal(transactionCalls, 0);
  } finally {
    loaded.restore();
  }
});

test('complementary declaration is sent after the checkbox is confirmed', async () => {
  const clientHarness = createTransactionClient((sql) => {
    if (sql.includes('SELECT DISTINCT c.documento, c.nombre')) {
      return { rows: [{ documento: 'coord-1', nombre: 'Coordinador Uno' }] };
    }
    if (sql.includes('INSERT INTO inventario_carga (')) return { rows: [{ id: 77 }] };
    return { rows: [] };
  });
  const loaded = loadInventoryRoute({
    pool: {
      async query(sql) {
        if (sql.includes('SELECT EXISTS')) return { rows: [{ permitido: true }] };
        throw new Error(`Unexpected query: ${sql}`);
      },
      async connect() {
        return clientHarness.client;
      },
    },
  });

  try {
    const response = await request(loaded.app)
      .post('/declarar-sin-complementarios')
      .type('form')
      .send({
        ual_id: '1',
        coordinador_documento: 'coord-1',
        confirmacion_sin_inventario: 'confirmo',
      });

    assert.equal(response.status, 302);
    const redirectUrl = new URL(response.headers.location, 'http://localhost');
    assert.match(redirectUrl.searchParams.get('success'), /declaración fue enviada/i);
    assert.ok(clientHarness.calls.some(({ sql }) => sql.includes('declaracion_sin_inventario')));
  } finally {
    loaded.restore();
  }
});

test('invalid inventory spreadsheet structure redirects with a validation message', async () => {
  let transactionCalls = 0;
  const loaded = loadInventoryRoute({
    pool: {
      async query(sql) {
        if (sql.includes('SELECT EXISTS')) return { rows: [{ permitido: true }] };
        return { rows: [] };
      },
      async connect() {
        transactionCalls += 1;
        throw new Error('Invalid workbook should fail before transaction');
      },
    },
  });

  try {
    const response = await request(loaded.app)
      .post('/cargas/previsualizar')
      .field('_csrf', 'test-csrf-token')
      .field('ual_id', '1')
      .field('tipo_inventario', 'equipo_arka')
      .attach(
        'archivo',
        createWorkbookBuffer([['COLUMNA DESCONOCIDA'], ['Microscopio']]),
        'inventario.xlsx'
      );

    assert.equal(response.status, 302);
    const redirectUrl = new URL(response.headers.location, 'http://localhost');
    assert.equal(redirectUrl.pathname, '/milab/inventarios/gestion_inventario');
    assert.equal(redirectUrl.searchParams.get('ual_id'), '1');
    assert.equal(redirectUrl.searchParams.get('panel'), 'equipo_arka');
    assert.match(redirectUrl.searchParams.get('error'), /faltan columnas obligatorias: PLACA/i);
    assert.equal(transactionCalls, 0);
  } finally {
    loaded.restore();
  }
});

test('inventory upload view links downloadable examples and retains its visual modal', () => {
  const view = fs.readFileSync(
    resolveRepoPath('src/views/home/inventarios/gestion_inventario/index.ejs'),
    'utf8'
  );

  assert.match(view, /data-bs-target="#inventoryExcelExampleModal"/);
  assert.match(view, /href="\/milab\/inventarios\/plantillas\/<%= selectedType %>"/);
  assert.match(view, /const inventoryExample = inventoryExamples\[selectedType\]/);
  assert.match(view, /@keyframes inventoryExampleColumnIn/);
  assert.match(view, /otra nomenclatura asociada al equipo/);
  assert.match(view, /Columnas obligatorias y opcionales/);
  assert.match(view, /Otros encabezados opcionales aceptados/);
  assert.match(view, /column\.required \? 'Obligatoria' : 'Opcional'/);
  assert.match(view, /EQUIPO<\/strong> como encabezado de/);
});

test('ARKA preview offers an optional additional-nomenclature column without replacing its plate', () => {
  const view = fs.readFileSync(
    resolveRepoPath('src/views/home/inventarios/gestion_inventario/preview.ejs'),
    'utf8'
  );

  assert.match(view, /name="nomenclatura_adicional_columna"/);
  assert.match(view, /El valor de cada fila se guardará como un identificador separado/);
  assert.match(view, /Nunca sustituye la placa oficial ARKA/);
});

test('inventory preview exposes row filters, ordered fields, cancellation, and navigation controls', () => {
  const view = fs.readFileSync(
    resolveRepoPath('src/views/home/inventarios/gestion_inventario/preview.ejs'),
    'utf8'
  );
  const script = fs.readFileSync(resolveRepoPath('src/public/js/inventory-preview.js'), 'utf8');
  const sharedGridScript = fs.readFileSync(resolveRepoPath('src/public/js/scripts.js'), 'utf8');

  assert.match(view, /data-row-filter="all"/);
  assert.match(view, /data-row-filter="ready"/);
  assert.match(view, /data-row-filter="observations"/);
  assert.match(view, /class="[^"]*js-data-grid"/);
  assert.match(view, /data-grid-page-length="25"/);
  assert.match(view, /data-grid-column-filters="false"/);
  assert.match(view, /Campos obligatorios/);
  assert.match(view, /Opcionales y validación/);
  assert.match(view, /data-description-toggle/);
  assert.match(view, /\/cancelar/);
  assert.match(view, />Volver<\/a>/);
  assert.match(view, /id="inventoryPreviewScrollTop"/);
  assert.match(script, /applyRowFilter/);
  assert.match(script, /dataTable\.draw\(\)/);
  assert.match(script, /rows\(\{ search: 'applied' \}\)\.count\(\)/);
  assert.match(script, /scrollTo/);
  assert.match(sharedGridScript, /gridColumnFilters/);
});

test('recent inventory loads expose a protected confirmation form', () => {
  const view = fs.readFileSync(
    resolveRepoPath('src/views/home/inventarios/gestion_inventario/index.ejs'),
    'utf8'
  );

  assert.match(view, /load\.puedeConfirmar/);
  assert.match(view, /bi-file-earmark-text/);
  assert.match(view, /bi-send me-1/);
  assert.match(view, /bi-send-fill me-1/);
  assert.match(view, /data-bs-toggle="modal"/);
  assert.match(view, /recentLoadConfirmModal-<%= load\.id %>/);
  assert.doesNotMatch(view, /<details class="mt-2">/);
  assert.match(view, /name="coordinador_documento"/);
  assert.match(view, /name="confirmar_revision"/);
  assert.match(view, /name="nomenclatura_adicional_columna"/);
  assert.match(view, /Confirmo que revisé el reporte/);
});

test('inventory preview records successful and duplicate rows with a specialized audit', async () => {
  const insertedRows = [];
  const clientHarness = createTransactionClient((sql, params) => {
    if (sql.includes('SELECT EXISTS')) return { rows: [{ permitido: true }] };
    if (sql.includes('INSERT INTO inventario_carga (')) {
      return {
        rows: [
          {
            id: 15,
            ual_id: 1,
            tipo_inventario: 'equipo_arka',
            archivo_nombre: 'inventario.xlsx',
            estado: 'previsualizada',
            total_filas: params[4],
            filas_exitosas: params[5],
            filas_fallidas: params[6],
          },
        ],
      };
    }
    if (sql.includes('INSERT INTO inventario_carga_fila')) {
      insertedRows.push({
        numeroFila: params[1],
        estado: params[2],
        payload: JSON.parse(params[3]),
        errores: JSON.parse(params[5]),
      });
    }
    return { rows: [] };
  });
  const pool = {
    async query(sql) {
      if (sql.includes('inventario_estado_laboratorio')) {
        return { rows: [{ inventario_aprobado: false, carga_pendiente: false }] };
      }
      if (sql.includes('SELECT EXISTS')) return { rows: [{ permitido: true }] };
      if (sql.includes('SELECT normalized')) return { rows: [{ normalized: 'ARKA-OLD' }] };
      if (sql.includes('SELECT DISTINCT c.documento')) {
        return { rows: [{ documento: 'coord-1', nombre: 'Coordinador Uno' }] };
      }
      if (sql.includes('SELECT nombre FROM ual')) return { rows: [{ nombre: 'Laboratorio A' }] };
      if (sql.includes('FROM inventario_auditoria')) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
    async connect() {
      return clientHarness.client;
    },
  };
  const loaded = loadInventoryRoute({ pool });

  try {
    const response = await request(loaded.app)
      .post('/cargas/previsualizar')
      .field('_csrf', 'test-csrf-token')
      .field('ual_id', '1')
      .field('tipo_inventario', 'equipo_arka')
      .attach(
        'archivo',
        createWorkbookBuffer([
          ['PLACA', 'DESCRIPCIÓN', 'CÓDIGO CATÁLOGO'],
          ['ARKA-OLD', 'Microscopio antiguo', 'CAT-OLD'],
          ['ARKA-NEW', 'Microscopio nuevo', 'CAT-NEW'],
        ]),
        'inventario.xlsx'
      );

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/inventarios/gestion_inventario/preview');
    assert.equal(response.body.locals.batch.filas_exitosas, 1);
    assert.equal(response.body.locals.batch.filas_fallidas, 1);
    assert.deepEqual(response.body.locals.additionalIdentifierHeaders, ['codigo catalogo']);
    assert.deepEqual(
      insertedRows.map((row) => row.estado),
      ['fallida', 'exitosa']
    );
    assert.match(insertedRows[0].errores.join(' '), /ya están registrados/i);
    assert.ok(
      clientHarness.calls.some(({ sql }) => sql.includes('INSERT INTO inventario_auditoria'))
    );
    assert.ok(clientHarness.calls.some(({ sql }) => sql.includes('INSERT INTO log')));
  } finally {
    loaded.restore();
  }
});

test('confirmation saves selected nomenclature separately and rejects duplicate row values', async () => {
  const insertedInventories = [];
  const clientHarness = createTransactionClient((sql, params) => {
    if (sql.includes('SELECT * FROM inventario_carga WHERE id')) {
      return {
        rows: [
          {
            id: 18,
            ual_id: 1,
            tipo_inventario: 'equipo_arka',
            estado: 'previsualizada',
            creada_por_documento: 'lab-1',
            declaracion_sin_inventario: false,
          },
        ],
      };
    }
    if (sql.includes('SELECT EXISTS')) return { rows: [{ permitido: true }] };
    if (sql.includes('SELECT DISTINCT c.documento, c.nombre')) {
      return { rows: [{ documento: 'coord-1', nombre: 'Coordinador Uno' }] };
    }
    if (
      sql.includes('SELECT *') &&
      sql.includes('FROM inventario_carga_fila') &&
      sql.includes('FOR UPDATE')
    ) {
      return {
        rows: [
          {
            id: 28,
            numero_fila: 3,
            estado: 'exitosa',
            payload: {
              descripcion: 'Microscopio',
              placa: 'ARKA-001',
              serie: 'SER-001',
              identificadores: [{ tipo: 'qr', valor: 'QR-001' }],
              existencias: [],
              atributos: {},
              modoControl: 'individual',
            },
            datos_originales: { 'codigo catalogo': 'CAT-001' },
            errores: [],
          },
          {
            id: 30,
            numero_fila: 4,
            estado: 'exitosa',
            payload: {
              descripcion: 'Balanza',
              placa: 'ARKA-002',
              identificadores: [],
              existencias: [],
              atributos: {},
              modoControl: 'individual',
            },
            datos_originales: { 'codigo catalogo': 'CAT-001' },
            errores: [],
          },
        ],
      };
    }
    if (sql.includes('SELECT u.nombre AS laboratorio')) {
      return { rows: [{ laboratorio: 'Laboratorio A', dependencia: 'Facultad A' }] };
    }
    if (sql.includes('INSERT INTO inventario (')) {
      insertedInventories.push(params);
      return { rows: [{ id: 91 }] };
    }
    return { rows: [] };
  });
  const pool = {
    async query(sql) {
      if (sql.includes('SELECT EXISTS')) return { rows: [{ permitido: true }] };
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() {
      return clientHarness.client;
    },
  };
  const loaded = loadInventoryRoute({ pool });

  try {
    const response = await request(loaded.app).post('/cargas/18/confirmar').type('form').send({
      coordinador_documento: 'coord-1',
      confirmar_revision: 'confirmo',
      nomenclatura_adicional_columna: 'codigo catalogo',
    });

    assert.equal(response.status, 302);
    assert.equal(insertedInventories.length, 1);
    assert.equal(insertedInventories[0][2], 'Microscopio');
    const additionalIdentifierInsert = clientHarness.calls.find(
      ({ sql, params }) =>
        sql.includes('INSERT INTO inventario_identificador') &&
        params[2] === 'nomenclatura_adicional'
    );
    assert.deepEqual(additionalIdentifierInsert.params, [
      91,
      1,
      'nomenclatura_adicional',
      'CAT-001',
      'CAT-001',
      'codigo catalogo',
    ]);
    const duplicateRowUpdate = clientHarness.calls.find(
      ({ sql, params }) =>
        sql.includes('UPDATE inventario_carga_fila') &&
        sql.includes('SET estado = $2') &&
        params[0] === 30
    );
    assert.equal(duplicateRowUpdate.params[1], 'fallida');
    assert.match(JSON.parse(duplicateRowUpdate.params[3]).join(' '), /repetida en otra fila/i);
    assert.ok(clientHarness.calls.some(({ sql }) => sql.includes('UPDATE inventario_carga_fila')));
    assert.ok(
      clientHarness.calls.some(({ sql }) => sql.includes('INSERT INTO inventario_auditoria'))
    );
    assert.ok(clientHarness.calls.some(({ sql }) => sql.includes('INSERT INTO log')));
    assert.ok(clientHarness.calls.some(({ sql }) => sql.includes('COMMIT')));
  } finally {
    loaded.restore();
  }
});

test('a custom identifier that exceeds its database limit is shown as a row error', async () => {
  const clientHarness = createTransactionClient((sql) => {
    if (sql.includes('SELECT * FROM inventario_carga WHERE id')) {
      return {
        rows: [
          {
            id: 19,
            ual_id: 1,
            tipo_inventario: 'equipo_arka',
            estado: 'previsualizada',
            creada_por_documento: 'lab-1',
            total_filas: 2,
            declaracion_sin_inventario: false,
          },
        ],
      };
    }
    if (sql.includes('SELECT EXISTS')) return { rows: [{ permitido: true }] };
    if (sql.includes('SELECT DISTINCT c.documento, c.nombre')) {
      return { rows: [{ documento: 'coord-1', nombre: 'Coordinador Uno' }] };
    }
    if (
      sql.includes('SELECT *') &&
      sql.includes('FROM inventario_carga_fila') &&
      sql.includes('FOR UPDATE')
    ) {
      return {
        rows: [
          {
            id: 29,
            numero_fila: 4,
            estado: 'exitosa',
            payload: {
              descripcion: 'Microscopio',
              placa: 'ARKA-002',
              identificadores: [],
              existencias: [],
              atributos: {},
              modoControl: 'individual',
            },
            datos_originales: { 'codigo catalogo': 'C'.repeat(256) },
            errores: [],
          },
          {
            id: 31,
            numero_fila: 5,
            estado: 'exitosa',
            payload: {
              descripcion: 'Balanza',
              placa: 'ARKA-003',
              identificadores: [],
              existencias: [],
              atributos: {},
              modoControl: 'individual',
            },
            datos_originales: { 'codigo catalogo': 'ß'.repeat(128) },
            errores: [],
          },
        ],
      };
    }
    return { rows: [] };
  });
  const pool = {
    async query(sql) {
      if (sql.includes('SELECT EXISTS')) return { rows: [{ permitido: true }] };
      if (sql.includes('SELECT DISTINCT c.documento')) {
        return { rows: [{ documento: 'coord-1', nombre: 'Coordinador Uno' }] };
      }
      if (sql.includes('SELECT nombre FROM ual')) return { rows: [{ nombre: 'Laboratorio A' }] };
      if (sql.includes('FROM inventario_auditoria')) return { rows: [] };
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() {
      return clientHarness.client;
    },
  };
  const loaded = loadInventoryRoute({ pool });

  try {
    const response = await request(loaded.app).post('/cargas/19/confirmar').type('form').send({
      coordinador_documento: 'coord-1',
      confirmar_revision: 'confirmo',
      nomenclatura_adicional_columna: 'codigo catalogo',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.locals.rows[0].estado, 'fallida');
    assert.match(
      response.body.locals.rows[0].errores.join(' '),
      /nomenclatura adicional.*256 caracteres.*255/i
    );
    assert.equal(response.body.locals.rows[1].estado, 'fallida');
    assert.match(
      response.body.locals.rows[1].errores.join(' '),
      /256 caracteres al normalizarse.*255/i
    );
    assert.equal(
      clientHarness.calls.some(({ sql }) => sql.includes('INSERT INTO inventario (')),
      false
    );
  } finally {
    loaded.restore();
  }
});

test('coordinator can consult recent load reports but cannot confirm them as the laboratorista', async () => {
  const loaded = loadInventoryRoute({
    pool: {
      async query(sql) {
        if (sql.includes('SELECT c.*, u.nombre AS laboratorio_nombre')) {
          return {
            rows: [
              {
                id: 18,
                ual_id: 4,
                tipo_inventario: 'equipo_arka',
                archivo_nombre: 'inventario.xlsx',
                estado: 'pendiente_aprobacion',
                creada_por_documento: 'lab-1',
                total_filas: 1,
                filas_exitosas: 1,
                filas_fallidas: 0,
              },
            ],
          };
        }
        if (sql.includes('SELECT EXISTS')) return { rows: [{ permitido: true }] };
        if (sql.includes('SELECT numero_fila, estado, payload')) {
          return {
            rows: [
              {
                numero_fila: 2,
                estado: 'pendiente_aprobacion',
                payload: { tipo: 'equipo_arka', descripcion: 'Microscopio' },
                errores: [],
              },
            ],
          };
        }
        if (sql.includes('SELECT DISTINCT c.documento')) {
          return { rows: [{ documento: 'coord-1', nombre: 'Coordinador Uno' }] };
        }
        if (sql.includes('SELECT nombre FROM ual')) return { rows: [{ nombre: 'Laboratorio A' }] };
        if (sql.includes('FROM inventario_auditoria')) return { rows: [] };
        throw new Error(`Unexpected query: ${sql}`);
      },
    },
    user: {
      tipo: 'coordinador',
      roles: ['coordinador'],
      documento: 'coord-1',
    },
  });

  try {
    const response = await request(loaded.app).get('/cargas/18');

    assert.equal(response.status, 200);
    assert.equal(response.body.locals.batch.archivo_nombre, 'inventario.xlsx');
    assert.equal(response.body.locals.rows[0].payload.descripcion, 'Microscopio');
    assert.equal(response.body.locals.canConfirm, false);
  } finally {
    loaded.restore();
  }
});

test('approval resolution accepts both form-encoded decisions and rejects missing or invalid decisions', async () => {
  for (const decision of ['aprobar', 'rechazar', '', 'otra']) {
    const clientHarness = createTransactionClient((sql) => {
      if (sql.includes('SELECT DISTINCT c.documento, c.nombre')) {
        return { rows: [{ documento: 'coord-1', nombre: 'Coordinador Uno' }] };
      }
      if (sql.includes('FOR UPDATE OF c')) {
        return {
          rows: [
            {
              id: 8,
              ual_id: 4,
              tipo_inventario: 'complementario',
              coordinador_documento: 'coord-1',
              estado: 'pendiente_aprobacion',
              declaracion_sin_inventario: true,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const loaded = loadInventoryRoute({
      pool: { connect: async () => clientHarness.client },
      user: { tipo: 'admin', roles: ['admin'] },
    });
    try {
      const response = await request(loaded.app)
        .post('/aprobaciones/8/resolver')
        .type('form')
        .send({ _csrf: 'test-csrf-token', decision });
      if (['aprobar', 'rechazar'].includes(decision)) {
        assert.equal(response.status, 302);
        assert.match(response.headers.location, decision === 'aprobar' ? /aprobada/ : /rechazada/);
        assert.ok(clientHarness.calls.some(({ sql }) => sql === 'COMMIT'));
      } else {
        assert.equal(response.status, 400);
        assert.equal(response.body.locals.message, 'Decisión inválida');
        assert.equal(clientHarness.calls.length, 0);
      }
    } finally {
      loaded.restore();
    }
  }
});

test('coordinator return requires a comment and preserves the load rows for correction', async () => {
  let connectCalls = 0;
  const missingComment = loadInventoryRoute({
    pool: {
      async connect() {
        connectCalls += 1;
        throw new Error('A comment must be required before opening a transaction');
      },
    },
    user: { tipo: 'admin', roles: ['admin'] },
  });
  try {
    const response = await request(missingComment.app)
      .post('/aprobaciones/8/resolver')
      .send({ decision: 'devolver' });
    assert.equal(response.status, 400);
    assert.match(response.body.locals.message2, /indica qué debe corregir/i);
    assert.equal(connectCalls, 0);
  } finally {
    missingComment.restore();
  }

  const clientHarness = createTransactionClient((sql) => {
    if (sql.includes('FOR UPDATE OF c')) {
      return {
        rows: [
          {
            id: 8,
            ual_id: 4,
            tipo_inventario: 'equipo_arka',
            coordinador_documento: 'coord-1',
            estado: 'pendiente_aprobacion',
            declaracion_sin_inventario: false,
          },
        ],
      };
    }
    if (sql.includes('FROM inventario_carga_fila f')) {
      return {
        rows: [{ id: 31, numero_fila: 2, inventario_id: 41, tipo_inventario: 'equipo_arka' }],
      };
    }
    return { rows: [] };
  });
  const loaded = loadInventoryRoute({
    pool: { connect: async () => clientHarness.client },
    user: { tipo: 'admin', roles: ['admin'] },
  });
  try {
    const response = await request(loaded.app)
      .post('/aprobaciones/8/resolver')
      .send({ decision: 'devolver', comentario: 'Corrige la descripción del registro.' });

    assert.equal(response.status, 302);
    assert.match(
      new URL(response.headers.location, 'http://localhost').searchParams.get('success'),
      /devuelta al laboratorista/i
    );
    assert.ok(
      clientHarness.calls.some(
        ({ sql, params }) => sql.includes('UPDATE inventario_carga') && params.includes('devuelta')
      )
    );
    assert.ok(
      clientHarness.calls.some(
        ({ sql, params }) =>
          sql.includes('INSERT INTO inventario_estado_laboratorio') && params.includes('devuelta')
      )
    );
    assert.ok(
      clientHarness.calls.some(
        ({ sql, params }) =>
          sql.includes('INSERT INTO inventario_auditoria') &&
          params.includes('carga_devuelta') &&
          JSON.stringify(params).includes('Corrige la descripción')
      )
    );
    assert.equal(
      clientHarness.calls.some(
        ({ sql }) =>
          sql.includes('UPDATE inventario') && sql.includes("estado_aprobacion = 'rechazado'")
      ),
      false
    );
    assert.ok(clientHarness.calls.some(({ sql }) => sql === 'COMMIT'));
  } finally {
    loaded.restore();
  }
});

test('laboratorista replacement reuses the returned batch and replaces its stored rows', async () => {
  const correctedBatch = {
    id: 8,
    ual_id: 4,
    tipo_inventario: 'equipo_arka',
    creada_por_documento: 'lab-1',
    estado: 'previsualizada',
    total_filas: 1,
    filas_exitosas: 1,
    filas_fallidas: 0,
    archivo_nombre: 'corregido.xlsx',
  };
  const clientHarness = createTransactionClient((sql) => {
    if (sql.includes('SELECT * FROM inventario_carga WHERE id = $1 FOR UPDATE')) {
      return {
        rows: [
          {
            ...correctedBatch,
            estado: 'devuelta',
            archivo_nombre: 'devuelto.xlsx',
          },
        ],
      };
    }
    if (sql.includes('carga_pendiente')) {
      return { rows: [{ inventario_aprobado: false, carga_pendiente: false }] };
    }
    if (sql.includes('UPDATE inventario_carga') && sql.includes('RETURNING *')) {
      return { rows: [correctedBatch] };
    }
    if (sql.includes('SELECT EXISTS')) return { rows: [{ permitido: true }] };
    return { rows: [] };
  });
  const loaded = loadInventoryRoute({
    pool: {
      async query(sql) {
        if (sql.includes('SELECT EXISTS')) return { rows: [{ permitido: true }] };
        if (sql.includes('SELECT DISTINCT c.documento, c.nombre')) return { rows: [] };
        if (sql.includes('SELECT nombre FROM ual')) return { rows: [{ nombre: 'Laboratorio A' }] };
        return { rows: [] };
      },
      connect: async () => clientHarness.client,
    },
  });

  try {
    const response = await request(loaded.app)
      .post('/cargas/previsualizar')
      .field('_csrf', 'test-csrf-token')
      .field('ual_id', '4')
      .field('tipo_inventario', 'equipo_arka')
      .field('carga_devuelta_id', '8')
      .attach(
        'archivo',
        createWorkbookBuffer([
          ['PLACA', 'DESCRIPCIÓN'],
          ['ARKA-001', 'Microscopio corregido'],
        ]),
        'corregido.xlsx'
      );

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/inventarios/gestion_inventario/preview');
    assert.ok(
      clientHarness.calls.some(({ sql }) => sql.includes('DELETE FROM inventario_carga_fila'))
    );
    assert.ok(
      clientHarness.calls.some(
        ({ sql }) =>
          sql.includes("SET estado = 'previsualizada'") && sql.includes('UPDATE inventario_carga')
      )
    );
    const insertedRow = clientHarness.calls.find(({ sql }) =>
      sql.includes('INSERT INTO inventario_carga_fila')
    );
    assert.ok(insertedRow);
    assert.equal(insertedRow.params[0], 8);
    assert.ok(clientHarness.calls.some(({ sql }) => sql === 'COMMIT'));
  } finally {
    loaded.restore();
  }
});

test('approved inventory export returns an Excel workbook with the approved equipment records', async () => {
  const queries = [];
  const loaded = loadInventoryRoute({
    pool: {
      async query(sql) {
        queries.push(sql);
        if (sql.includes('SELECT EXISTS')) return { rows: [{ permitido: true }] };
        if (sql.includes('FROM inventario_estado_laboratorio')) {
          return { rows: [{ estado: 'aprobado', sin_inventario: false }] };
        }
        if (sql.includes('FROM inventario i')) {
          return {
            rows: [
              {
                id: 41,
                placa: 'ARKA-041',
                serie: 'SER-041',
                nombre_bien: 'Microscopio',
                espacio_fisico: 'Laboratorio A',
                activo: true,
                disponible_prestamo: true,
                atributos: { marca: 'Marca', modelo: 'M1', observaciones: 'Operativo' },
                equipo_estado: 'disponible',
                identificadores: [{ tipo: 'codigo_interno', valor: 'INT-41' }],
                existencias: [],
              },
            ],
          };
        }
        return { rows: [] };
      },
    },
    user: { tipo: 'admin', roles: ['admin'] },
  });

  try {
    const response = await request(loaded.app)
      .get('/exportar?ual_id=4&tipo_inventario=equipo_arka')
      .buffer(true)
      .parse((res, callback) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    assert.equal(response.status, 200);
    assert.match(
      response.headers['content-type'],
      /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/
    );
    assert.match(response.headers['content-disposition'], /inventario_equipo_arka_ual_4\.xlsx/);
    assert.ok(queries.some((sql) => sql.includes("i.estado_aprobacion = 'aprobado'")));
    const workbook = XLSX.read(response.body, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets['Inventario aprobado'], {
      header: 1,
    });
    assert.ok(rows[1], 'The workbook should contain the approved equipment record.');
    assert.equal(rows[1][0], 'ARKA-041');
    assert.equal(rows[1][1], 'Microscopio');
    assert.equal(rows[1][8], 'disponible');
    assert.equal(rows[1][10], 'codigo_interno: INT-41');
  } finally {
    loaded.restore();
  }
});

test('inventory deactivation blocks currently borrowed equipment', async () => {
  const clientHarness = createTransactionClient((sql) => {
    if (sql.includes('SELECT EXISTS')) return { rows: [{ permitido: true }] };
    if (sql.includes('SELECT id, estado FROM equipo')) {
      return { rows: [{ id: 55, estado: 'prestado' }] };
    }
    if (sql.includes('SELECT i.id, i.tipo_inventario, i.activo')) {
      return { rows: [{ id: 41, tipo_inventario: 'equipo_arka', activo: true }] };
    }
    return { rows: [] };
  });
  const loaded = loadInventoryRoute({
    pool: { connect: async () => clientHarness.client },
    user: { tipo: 'admin', roles: ['admin'] },
  });

  try {
    const response = await request(loaded.app).post('/registros/41/baja').send({ ual_id: '4' });

    assert.equal(response.status, 409);
    assert.match(response.body.locals.message2, /mientras está prestado/i);
    assert.equal(
      clientHarness.calls.some(({ sql }) => sql.includes('UPDATE inventario SET activo = FALSE')),
      false
    );
    assert.ok(clientHarness.calls.some(({ sql }) => sql === 'ROLLBACK'));
  } finally {
    loaded.restore();
  }
});

test('assigned laboratorista can edit a record from an approved inventory', async () => {
  const clientHarness = createTransactionClient((sql) => {
    if (sql.includes('SELECT EXISTS')) return { rows: [{ permitido: true }] };
    if (sql.includes('SELECT i.id, i.laboratorio_ual_id')) {
      return {
        rows: [
          {
            id: 41,
            laboratorio_ual_id: 4,
            tipo_inventario: 'equipo_arka',
            estado_aprobacion: 'aprobado',
            activo: true,
          },
        ],
      };
    }
    return { rows: [] };
  });
  const loaded = loadInventoryRoute({
    pool: { connect: async () => clientHarness.client },
    user: {
      tipo: 'laboratorista',
      roles: ['laboratorista'],
      documento: 'lab-1',
    },
  });

  try {
    const response = await request(loaded.app).post('/registros/41/editar').send({
      ual_id: '4',
      tipo_inventario: 'equipo_arka',
      descripcion: 'Microscopio actualizado',
      placa: 'ARKA-041',
      serie: 'SER-041',
      marca: 'Marca',
    });

    assert.equal(response.status, 302);
    assert.match(
      new URL(response.headers.location, 'http://localhost').searchParams.get('success'),
      /registro fue actualizado correctamente/
    );
    assert.ok(
      clientHarness.calls.some(
        ({ sql, params }) =>
          sql.includes('UPDATE inventario') &&
          sql.includes('nombre_bien = $4') &&
          params.includes('Microscopio actualizado')
      )
    );
    assert.ok(
      clientHarness.calls.some(({ sql }) =>
        sql.includes('UPDATE inventario_identificador SET activo = FALSE')
      )
    );
    assert.ok(clientHarness.calls.some(({ sql }) => sql === 'COMMIT'));
  } finally {
    loaded.restore();
  }
});

test('coordinator approval authorizes by laboratory scope and creates the legacy equipment extension', async () => {
  const clientHarness = createTransactionClient((sql) => {
    if (sql.includes('SELECT DISTINCT c.documento, c.nombre')) {
      return { rows: [{ documento: 'coord-1', nombre: 'Coordinador Uno' }] };
    }
    if (sql.includes('SELECT') && sql.includes('FOR UPDATE OF c')) {
      return {
        rows: [
          {
            id: 8,
            ual_id: 4,
            tipo_inventario: 'equipo_arka',
            estado: 'pendiente_aprobacion',
            coordinador_documento: 'coord-1',
            facultad_id: 12,
            laboratorio: 'Laboratorio A',
            facultad: 'Facultad A',
            declaracion_sin_inventario: false,
          },
        ],
      };
    }
    if (sql.includes('FROM coordinador_facultad_alcance')) return { rows: [{ ok: 1 }] };
    if (sql.includes('FROM inventario_carga_fila f')) {
      return {
        rows: [
          {
            id: 31,
            numero_fila: 2,
            inventario_id: 41,
            placa: 'ARKA-001',
            tipo_inventario: 'equipo_arka',
          },
        ],
      };
    }
    if (sql.includes('UPDATE inventario') && sql.includes('RETURNING')) {
      return {
        rows: [
          {
            id: 41,
            tipo_inventario: 'equipo_arka',
            placa: 'ARKA-001',
            nombre_bien: 'Microscopio',
            atributos: { marca: 'Marca', modelo: 'Modelo' },
            espacio_fisico: 'Laboratorio A',
          },
        ],
      };
    }
    if (sql.includes('SELECT id FROM equipo WHERE inventario_id')) return { rows: [] };
    if (sql.includes('INSERT INTO equipo')) return { rows: [{ id: 55 }] };
    return { rows: [] };
  });
  const pool = {
    async query(sql) {
      if (sql.includes('SELECT EXISTS')) return { rows: [{ permitido: true }] };
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() {
      return clientHarness.client;
    },
  };
  const loaded = loadInventoryRoute({
    pool,
    user: {
      tipo: 'coordinador',
      roles: ['coordinador'],
      documento: 'coord-1',
    },
  });

  try {
    const response = await request(loaded.app)
      .post('/aprobaciones/8/resolver')
      .send({ decision: 'aprobar', comentario: 'Validado' });

    assert.equal(response.status, 302);
    assert.match(response.headers.location, /\/milab\/inventarios\/aprobaciones/);
    assert.ok(clientHarness.calls.some(({ sql }) => sql.includes('INSERT INTO equipo')));
    const approvedInventoryUpdate = clientHarness.calls.find(
      ({ sql }) => sql.includes('UPDATE inventario') && sql.includes('RETURNING')
    );
    assert.ok(approvedInventoryUpdate);
    assert.match(approvedInventoryUpdate.sql, /disponible_prestamo\s*=\s*CASE/);
    assert.equal(approvedInventoryUpdate.params[1], 'equipo_arka');
    assert.ok(clientHarness.calls.some(({ sql }) => sql.includes('UPDATE inventario_carga_fila')));
    assert.ok(clientHarness.calls.some(({ sql }) => sql.includes('COMMIT')));
  } finally {
    loaded.restore();
  }
});

test('coordinator approval also activates complementary records without creating a loanable equipment row', async () => {
  const clientHarness = createTransactionClient((sql) => {
    if (sql.includes('SELECT DISTINCT c.documento, c.nombre')) {
      return { rows: [{ documento: 'coord-1', nombre: 'Coordinador Uno' }] };
    }
    if (sql.includes('FOR UPDATE OF c')) {
      return {
        rows: [
          {
            id: 9,
            ual_id: 4,
            tipo_inventario: 'complementario',
            estado: 'pendiente_aprobacion',
            coordinador_documento: 'coord-1',
            facultad_id: 12,
            laboratorio: 'Laboratorio A',
            facultad: 'Facultad A',
            declaracion_sin_inventario: false,
          },
        ],
      };
    }
    if (sql.includes('coordinador_facultad_alcance')) return { rows: [{ ok: 1 }] };
    if (sql.includes('FROM inventario_carga_fila f')) {
      return {
        rows: [{ id: 32, numero_fila: 3, inventario_id: 42, tipo_inventario: 'complementario' }],
      };
    }
    if (sql.includes('UPDATE inventario') && sql.includes('RETURNING')) {
      return {
        rows: [
          {
            id: 42,
            tipo_inventario: 'complementario',
            placa: null,
            nombre_bien: 'Flexómetro',
            atributos: {},
            espacio_fisico: 'Laboratorio A',
          },
        ],
      };
    }
    return { rows: [] };
  });
  const loaded = loadInventoryRoute({
    pool: {
      async query() {
        return { rows: [] };
      },
      async connect() {
        return clientHarness.client;
      },
    },
    user: {
      tipo: 'coordinador',
      roles: ['coordinador'],
      documento: 'coord-1',
    },
  });

  try {
    const response = await request(loaded.app)
      .post('/aprobaciones/9/resolver')
      .send({ decision: 'aprobar' });

    assert.equal(response.status, 302);
    assert.ok(
      clientHarness.calls.some(
        ({ sql }) => sql.includes('UPDATE inventario') && sql.includes('RETURNING')
      )
    );
    const approvedInventoryUpdate = clientHarness.calls.find(
      ({ sql }) => sql.includes('UPDATE inventario') && sql.includes('RETURNING')
    );
    assert.equal(approvedInventoryUpdate.params[1], 'equipo_arka');
    assert.equal(
      clientHarness.calls.some(
        ({ sql }) =>
          sql.includes('INSERT INTO equipo') || sql.includes('FROM equipo WHERE inventario_id')
      ),
      false
    );
  } finally {
    loaded.restore();
  }
});

test('coordinator cannot approve a batch assigned to another coordinator', async () => {
  const clientHarness = createTransactionClient((sql) => {
    if (sql.includes('FOR UPDATE OF c')) {
      return {
        rows: [
          {
            id: 8,
            ual_id: 4,
            tipo_inventario: 'equipo_arka',
            estado: 'pendiente_aprobacion',
            coordinador_documento: 'coord-assigned',
            facultad_id: 12,
          },
        ],
      };
    }
    return { rows: [] };
  });
  const loaded = loadInventoryRoute({
    pool: {
      async query() {
        return { rows: [] };
      },
      async connect() {
        return clientHarness.client;
      },
    },
    user: { tipo: 'coordinador', roles: ['coordinador'], documento: 'coord-other' },
  });

  try {
    const response = await request(loaded.app)
      .post('/aprobaciones/8/resolver')
      .send({ decision: 'aprobar' });

    assert.equal(response.status, 403);
    assert.match(response.body.locals.message2, /asignada a otro coordinador/i);
    assert.equal(
      clientHarness.calls.some(({ sql }) => sql.includes('INSERT INTO equipo')),
      false
    );
    assert.ok(clientHarness.calls.some(({ sql }) => sql === 'ROLLBACK'));
  } finally {
    loaded.restore();
  }
});

test('first approval fixes the laboratory coordinator atomically and later approvals preserve that owner', async () => {
  for (const scenario of [
    { actor: 'coordinador', decision: 'aprobar', owner: null, expectedOwner: 'coord-1' },
    { actor: 'admin', decision: 'aprobar', owner: null, expectedOwner: 'coord-1' },
    { actor: 'coordinador', decision: 'rechazar', owner: null, expectedOwner: null },
    { actor: 'coordinador', decision: 'aprobar', owner: 'coord-1', expectedOwner: 'coord-1' },
    { actor: 'admin', decision: 'aprobar', owner: 'coord-owner', expectedOwner: 'coord-owner' },
  ]) {
    const batch = {
      id: 8,
      ual_id: 4,
      facultad_id: 12,
      tipo_inventario: 'complementario',
      estado: 'pendiente_aprobacion',
      declaracion_sin_inventario: true,
      coordinador_documento: 'coord-1',
    };
    const clientHarness = createTransactionClient((sql) => {
      if (sql.includes('FOR UPDATE OF c')) return { rows: [{ ...batch }] };
      if (sql.startsWith('SELECT coordinador_documento FROM coordinador_ual_encargado')) {
        return { rows: scenario.owner ? [{ coordinador_documento: scenario.owner }] : [] };
      }
      if (sql.includes('SELECT DISTINCT c.documento, c.nombre')) {
        assert.match(sql, /NOT EXISTS \(\s+SELECT 1 FROM coordinador_ual_encargado/);
        return { rows: [{ documento: scenario.owner || batch.coordinador_documento }] };
      }
      if (sql.includes('FROM coordinador_facultad_alcance')) return { rows: [{ ok: 1 }] };
      return { rows: [] };
    });
    const loaded = loadInventoryRoute({
      pool: { connect: async () => clientHarness.client },
      user: { tipo: scenario.actor, roles: [scenario.actor], documento: 'coord-1' },
    });
    try {
      const response = await request(loaded.app)
        .post('/aprobaciones/8/resolver')
        .type('form')
        .send({ decision: scenario.decision });
      assert.equal(response.status, 302, JSON.stringify(scenario));
      const assignment = clientHarness.calls.find(({ sql }) =>
        sql.includes('INSERT INTO coordinador_ual_encargado')
      );
      if (!scenario.owner && scenario.decision === 'aprobar') {
        assert.deepEqual(assignment.params, [4, 'coord-1', 8]);
        const lockIndex = clientHarness.calls.findIndex(({ sql }) =>
          sql.includes('SELECT ual_id FROM ual WHERE ual_id = $1 FOR UPDATE')
        );
        const assignmentIndex = clientHarness.calls.indexOf(assignment);
        assert.ok(lockIndex > 0 && lockIndex < assignmentIndex);
        const ownerReadIndex = clientHarness.calls.findIndex(({ sql }) =>
          sql.startsWith('SELECT coordinador_documento FROM coordinador_ual_encargado')
        );
        assert.ok(lockIndex < ownerReadIndex && ownerReadIndex < assignmentIndex);
        const audit = clientHarness.calls.find(({ params }) =>
          params?.includes('coordinador_encargado_asignado')
        );
        assert.ok(audit);
        assert.equal(JSON.parse(audit.params[6]).coordinadorDocumento, 'coord-1');
      } else {
        assert.equal(assignment, undefined);
      }
      const resolved = clientHarness.calls.find(
        ({ sql }) => sql.includes('SET estado = $1,') && sql.includes('coordinador_documento = $3')
      );
      assert.equal(resolved.params[2], scenario.expectedOwner || 'coord-1');
      assert.equal(clientHarness.calls.at(-1).sql, 'COMMIT');
    } finally {
      loaded.restore();
    }
  }
});

test('a stale approval by another coordinator cannot replace the owner fixed by a concurrent approval', async () => {
  const clientHarness = createTransactionClient((sql) => {
    if (sql.includes('FOR UPDATE OF c')) {
      return {
        rows: [
          {
            id: 8,
            ual_id: 4,
            facultad_id: 12,
            coordinador_documento: 'coord-1',
            estado: 'pendiente_aprobacion',
            tipo_inventario: 'complementario',
          },
        ],
      };
    }
    if (sql.startsWith('SELECT coordinador_documento FROM coordinador_ual_encargado')) {
      return { rows: [{ coordinador_documento: 'coord-owner' }] };
    }
    return { rows: [] };
  });
  const loaded = loadInventoryRoute({
    pool: { connect: async () => clientHarness.client },
    user: { tipo: 'coordinador', roles: ['coordinador'], documento: 'coord-1' },
  });
  try {
    const response = await request(loaded.app)
      .post('/aprobaciones/8/resolver')
      .send({ decision: 'aprobar' });
    assert.equal(response.status, 403);
    assert.match(response.body.locals.message2, /asignada a otro coordinador/);
    assert.equal(clientHarness.calls.at(-1).sql, 'ROLLBACK');
    assert.equal(
      clientHarness.calls.some(({ sql }) => sql.includes('INSERT INTO coordinador_ual_encargado')),
      false
    );
  } finally {
    loaded.restore();
  }
});

test('an inactive or out-of-scope coordinator cannot become the owner even when admin approves', async () => {
  const clientHarness = createTransactionClient((sql) => {
    if (sql.includes('FOR UPDATE OF c')) {
      return {
        rows: [
          {
            id: 8,
            ual_id: 4,
            coordinador_documento: 'inactive',
            estado: 'pendiente_aprobacion',
            tipo_inventario: 'complementario',
          },
        ],
      };
    }
    return { rows: [] };
  });
  const loaded = loadInventoryRoute({
    pool: { connect: async () => clientHarness.client },
    user: { tipo: 'admin', roles: ['admin'] },
  });
  try {
    const response = await request(loaded.app)
      .post('/aprobaciones/8/resolver')
      .send({ decision: 'aprobar' });
    assert.equal(response.status, 409);
    assert.match(response.body.locals.message2, /no está activo/);
    assert.equal(clientHarness.calls.at(-1).sql, 'ROLLBACK');
    assert.equal(
      clientHarness.calls.some(({ sql }) => sql.includes('INSERT INTO coordinador_ual_encargado')),
      false
    );
  } finally {
    loaded.restore();
  }
});

test('approval failure rolls back both inventory changes and the first coordinator assignment', async () => {
  const clientHarness = createTransactionClient((sql) => {
    if (sql.includes('FOR UPDATE OF c')) {
      return {
        rows: [
          {
            id: 8,
            ual_id: 4,
            coordinador_documento: 'coord-1',
            estado: 'pendiente_aprobacion',
            tipo_inventario: 'equipo_arka',
          },
        ],
      };
    }
    if (sql.includes('SELECT DISTINCT c.documento, c.nombre'))
      return { rows: [{ documento: 'coord-1' }] };
    if (sql.includes('FROM inventario_carga_fila f')) return { rows: [{ inventario_id: 50 }] };
    return { rows: [] };
  });
  const loaded = loadInventoryRoute({
    pool: { connect: async () => clientHarness.client },
    user: { tipo: 'admin', roles: ['admin'] },
  });
  try {
    const response = await request(loaded.app)
      .post('/aprobaciones/8/resolver')
      .send({ decision: 'aprobar' });
    assert.equal(response.status, 409);
    assert.ok(
      clientHarness.calls.some(({ sql }) => sql.includes('INSERT INTO coordinador_ual_encargado'))
    );
    assert.equal(clientHarness.calls.at(-1).sql, 'ROLLBACK');
    assert.equal(
      clientHarness.calls.some(({ sql }) => sql === 'COMMIT'),
      false
    );
  } finally {
    loaded.restore();
  }
});

test('subsequent inventory confirmations and declarations reject a forged non-owner coordinator', async () => {
  for (const endpoint of ['/cargas/8/confirmar', '/declarar-sin-complementarios']) {
    const clientHarness = createTransactionClient((sql, params) => {
      if (sql.includes('SELECT * FROM inventario_carga WHERE id')) {
        return {
          rows: [
            {
              id: 8,
              ual_id: 4,
              creada_por_documento: 'lab-1',
              tipo_inventario: 'complementario',
              estado: 'previsualizada',
            },
          ],
        };
      }
      if (sql.includes('SELECT EXISTS')) return { rows: [{ permitido: true }] };
      if (sql.includes('SELECT DISTINCT c.documento, c.nombre')) {
        assert.match(sql, /ON ca\.facultad_id = u\.facultad_id\s+AND ca\.activo = TRUE/);
        assert.match(sql, /WHERE u\.ual_id = \$1\s+AND u\.activo = TRUE/);
        assert.match(sql, /NOT EXISTS \(\s+SELECT 1 FROM coordinador_ual_encargado/);
        assert.match(sql, /encargado\.coordinador_documento <> c\.documento/);
        assert.deepEqual(params, [4]);
        return { rows: [] };
      }
      return { rows: [] };
    });
    const loaded = loadInventoryRoute({
      pool: { query: clientHarness.client.query, connect: async () => clientHarness.client },
    });
    try {
      const response = await request(loaded.app).post(endpoint).type('form').send({
        ual_id: '4',
        coordinador_documento: 'coord-other',
        confirmar_revision: 'confirmo',
        confirmacion_sin_inventario: 'confirmo',
      });
      assert.equal(response.status, 400, endpoint);
      assert.match(response.body.locals.message2, /no es el encargado/);
      assert.equal(clientHarness.calls.at(-1).sql, 'ROLLBACK');
      assert.equal(
        clientHarness.calls.some(({ sql }) => sql.includes('INSERT INTO inventario_carga (')),
        false
      );
    } finally {
      loaded.restore();
    }
  }
});

test('coordinator ownership migration is unique, preserves existing owners and backfills the first approval', () => {
  const sql = fs.readFileSync(resolveRepoPath('sql-scripts/db_structure_inventarios.sql'), 'utf8');
  assert.match(
    sql,
    /CREATE TABLE IF NOT EXISTS coordinador_ual_encargado \(\s+ual_id INT PRIMARY KEY REFERENCES ual/
  );
  assert.match(sql, /coordinador_documento VARCHAR\(50\) NOT NULL REFERENCES coordinador/);
  assert.match(sql, /carga_id BIGINT NOT NULL REFERENCES inventario_carga/);
  assert.match(sql, /SELECT DISTINCT ON \(ual_id\)[\s\S]*WHERE estado = 'aprobada'/);
  assert.match(
    sql,
    /ORDER BY ual_id, COALESCE\(fecha_resolucion, fecha_confirmacion, fecha_creacion\), id\s+ON CONFLICT \(ual_id\) DO NOTHING/
  );
});

test('pending approval lists and details route to the owner while resolved details retain the historical coordinator', async () => {
  const queries = [];
  const loaded = loadInventoryRoute({
    user: { tipo: 'coordinador', roles: ['coordinador'], documento: 'coord-owner' },
    pool: {
      query: async (sql, params) => {
        queries.push({ sql, params });
        if (sql.includes('FROM inventario_carga c')) {
          assert.match(
            sql,
            /LEFT JOIN coordinador_ual_encargado encargado ON encargado.ual_id = c.ual_id/
          );
          assert.equal(params.at(-1), 'coord-owner');
          return {
            rows: [
              {
                id: 8,
                ual_id: 4,
                estado: 'pendiente_aprobacion',
                coordinador_documento: 'coord-owner',
                coordinador_nombre: 'Encargado Actual',
              },
            ],
          };
        }
        return { rows: [] };
      },
    },
  });
  try {
    const list = await request(loaded.app).get('/aprobaciones');
    assert.equal(list.status, 200);
    assert.equal(list.body.locals.batches[0].coordinador_documento, 'coord-owner');
    assert.match(
      queries[0].sql,
      /COALESCE\(encargado.coordinador_documento, c.coordinador_documento\) = \$2/
    );
    const detail = await request(loaded.app).get('/aprobaciones/8');
    assert.equal(detail.status, 200);
    assert.equal(detail.body.locals.batch.coordinador_nombre, 'Encargado Actual');
    const detailQuery = queries.find(({ sql }) => sql.includes('WHERE c.id = $1'));
    assert.match(
      detailQuery.sql,
      /CASE WHEN c.estado = 'pendiente_aprobacion' THEN encargado.coordinador_documento END/
    );
  } finally {
    loaded.restore();
  }
});

test('coordinator can create individual records for every approved inventory type', async () => {
  const cases = [
    {
      inventoryType: 'equipo_arka',
      body: {
        descripcion: 'Microscopio',
        placa: 'ARKA-IND-001',
        serie: 'SER-IND-001',
        marca: 'Acme',
      },
    },
    {
      inventoryType: 'complementario',
      body: {
        descripcion: 'Flexómetro',
        cantidad: '2',
        unidad: 'unidad',
      },
    },
    {
      inventoryType: 'reactivo',
      body: {
        descripcion: 'Acetamida',
        referencia: 'REA-001',
        marca: 'Marca de reactivo',
        modelo: 'R-1',
        proveedor: 'Proveedor de reactivos',
      },
    },
  ];

  for (const inventoryCase of cases) {
    const clientHarness = createTransactionClient((sql) => {
      if (sql.includes('SELECT EXISTS')) return { rows: [{ permitido: true }] };
      if (sql.includes('SELECT estado, sin_inventario')) {
        return { rows: [{ estado: 'aprobado', sin_inventario: false }] };
      }
      if (sql.includes('SELECT normalized')) return { rows: [] };
      if (sql.includes('SELECT u.nombre AS laboratorio')) {
        return {
          rows: [
            { laboratorio: 'Laboratorio A', dependencia: 'Facultad A', facultad: 'Facultad A' },
          ],
        };
      }
      if (sql.includes('INSERT INTO inventario (')) return { rows: [{ id: 91 }] };
      if (sql.includes('INSERT INTO equipo')) return { rows: [{ id: 55 }] };
      return { rows: [] };
    });
    const loaded = loadInventoryRoute({
      pool: {
        async query(sql) {
          if (sql.includes('SELECT EXISTS')) return { rows: [{ permitido: true }] };
          throw new Error(`Unexpected pool query: ${sql}`);
        },
        async connect() {
          return clientHarness.client;
        },
      },
      user: {
        tipo: 'coordinador',
        roles: ['coordinador'],
        documento: 'coord-1',
        nombre: 'Coordinador Uno',
      },
    });

    try {
      const response = await request(loaded.app)
        .post('/individual')
        .type('form')
        .send({
          ual_id: '4',
          tipo_inventario: inventoryCase.inventoryType,
          ...inventoryCase.body,
        });

      assert.equal(response.status, 302);
      assert.match(response.headers.location, /panel=/);
      assert.ok(clientHarness.calls.some(({ sql }) => sql.includes('INSERT INTO inventario (')));
      assert.ok(
        clientHarness.calls.some(({ sql }) => sql.includes('UPDATE inventario_estado_laboratorio'))
      );
      if (inventoryCase.inventoryType === 'equipo_arka') {
        assert.ok(clientHarness.calls.some(({ sql }) => sql.includes('INSERT INTO equipo')));
      }
      if (inventoryCase.inventoryType === 'complementario') {
        assert.ok(
          clientHarness.calls.some(({ sql }) => sql.includes('INSERT INTO inventario_existencia'))
        );
      }
      if (inventoryCase.inventoryType === 'reactivo') {
        const inventoryInsert = clientHarness.calls.find(({ sql }) =>
          sql.includes('INSERT INTO inventario (')
        );
        assert.deepEqual(JSON.parse(inventoryInsert.params[11]), {
          marca: 'Marca de reactivo',
          modelo: 'R-1',
          proveedor: 'Proveedor de reactivos',
          observaciones: '',
          referencia: 'REA-001',
          codigoInterno: '',
        });
      }
    } finally {
      loaded.restore();
    }
  }
});

test('inventory module views compile as EJS templates', () => {
  const views = [
    'src/views/home/inventarios/gestion_inventario/index.ejs',
    'src/views/home/inventarios/gestion_inventario/individual.ejs',
    'src/views/home/inventarios/gestion_inventario/preview.ejs',
    'src/views/home/inventarios/aprobaciones/index.ejs',
    'src/views/home/inventarios/aprobaciones/detalle.ejs',
  ];

  views.forEach((viewPath) => {
    assert.doesNotThrow(() => {
      ejs.compile(fs.readFileSync(resolveRepoPath(viewPath), 'utf8'));
    }, viewPath);
  });
});

test('main inventory management view defers ARKA reconciliation records', () => {
  const view = fs.readFileSync(
    resolveRepoPath('src/views/home/inventarios/gestion_inventario/index.ejs'),
    'utf8'
  );

  assert.doesNotMatch(view, /Registros históricos por reconciliar/);
  assert.doesNotMatch(view, /Inventario histórico/);
  assert.doesNotMatch(view, /Equipos técnicos sin vínculo con inventario/);
});

test('inventory migration drops the compatibility view before altering its source column', () => {
  const migration = fs.readFileSync(
    resolveRepoPath('sql-scripts/db_structure_inventarios.sql'),
    'utf8'
  );
  const baseStructure = fs.readFileSync(
    resolveRepoPath('sql-scripts/db_structure_prestamos.sql'),
    'utf8'
  );
  const dropViewIndex = migration.indexOf('DROP VIEW IF EXISTS equipo_catalogo');
  const alterColumnIndex = migration.indexOf('ALTER COLUMN nombre_bien TYPE VARCHAR(1000)');
  const recreateViewIndex = migration.indexOf('CREATE OR REPLACE VIEW equipo_catalogo');

  assert.notEqual(dropViewIndex, -1);
  assert.ok(dropViewIndex < alterColumnIndex);
  assert.ok(alterColumnIndex < recreateViewIndex);
  assert.match(baseStructure, /nombre_bien VARCHAR\(1000\) NOT NULL/);
  assert.match(migration, /ALTER COLUMN espacio_fisico TYPE VARCHAR\(255\)/);
});
