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

test('inventory upload is blocked while that inventory type awaits approval', async () => {
  let transactionCalls = 0;
  const loaded = loadInventoryRoute({
    pool: {
      async query(sql) {
        if (sql.includes('inventario_estado_laboratorio')) {
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
    assert.equal(transactionCalls, 0);
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
    if (sql.includes('coordinador_facultad_alcance')) return { rows: [{ ok: 1 }] };
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

test('inventory upload view includes animated examples for all inventory types', () => {
  const view = fs.readFileSync(
    resolveRepoPath('src/views/home/inventarios/gestion_inventario/index.ejs'),
    'utf8'
  );

  assert.match(view, /data-bs-target="#inventoryExcelExampleModal"/);
  assert.match(view, /@keyframes inventoryExampleColumnIn/);
  assert.match(view, /PLACA/);
  assert.match(view, /NOMBRE DEL MATERIAL/);
  assert.match(view, /STOCK G\.T/);
  assert.match(view, /CIRCULACIÓN R\.A/);
});

test('inventory preview records successful and duplicate rows with a specialized audit', async () => {
  const insertedRows = [];
  const clientHarness = createTransactionClient((sql, params) => {
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
          ['PLACA', 'DESCRIPCIÓN'],
          ['ARKA-OLD', 'Microscopio antiguo'],
          ['ARKA-NEW', 'Microscopio nuevo'],
        ]),
        'inventario.xlsx'
      );

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/inventarios/gestion_inventario/preview');
    assert.equal(response.body.locals.batch.filas_exitosas, 1);
    assert.equal(response.body.locals.batch.filas_fallidas, 1);
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

test('confirmation creates only the successful preview rows and records both audits', async () => {
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
    if (sql.includes('coordinador_facultad_alcance ca')) return { rows: [{ ok: 1 }] };
    if (sql.includes("AND estado = 'exitosa'")) {
      return {
        rows: [
          {
            id: 28,
            numero_fila: 3,
            payload: {
              descripcion: 'Microscopio',
              placa: 'ARKA-001',
              serie: 'SER-001',
              identificadores: [{ tipo: 'qr', valor: 'QR-001' }],
              existencias: [],
              atributos: {},
              modoControl: 'individual',
            },
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
    const response = await request(loaded.app)
      .post('/cargas/18/confirmar')
      .type('form')
      .send({ coordinador_documento: 'coord-1', confirmar_revision: 'confirmo' });

    assert.equal(response.status, 302);
    assert.equal(insertedInventories.length, 1);
    assert.equal(insertedInventories[0][2], 'Microscopio');
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

test('coordinator approval authorizes by laboratory scope and creates the legacy equipment extension', async () => {
  const clientHarness = createTransactionClient((sql) => {
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
    if (sql.includes('SELECT id, inventario_id FROM equipo')) return { rows: [] };
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
        ({ sql }) => sql.includes('INSERT INTO equipo') || sql.includes('FROM equipo WHERE codigo')
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
