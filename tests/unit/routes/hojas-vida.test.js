const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

const {
  loadModuleWithStubs,
  resolveRepoPath,
} = require('../../integration/helpers/build-test-app');
const { createSessionHarness, createUser } = require('../../integration/helpers/session-fixtures');

const routePath = resolveRepoPath('src/routes/api/hojas-vida.js');
const dbPath = resolveRepoPath('src/libs/db.js');
const authPath = resolveRepoPath('src/routes/middlewares/auth.js');

const allowJsonRoles = () => (req, res, next) => next();

function loadRoute({
  query,
  connect,
  user = {},
  authModule = { requireJsonRoles: allowJsonRoles },
}) {
  const sessionHarness = createSessionHarness({
    user: createUser({
      tipo: 'admin',
      roles: ['admin'],
      documento: 'admin-1',
      ...user,
    }),
  });

  const loaded = loadModuleWithStubs({
    entryPath: routePath,
    stubs: [
      [dbPath, { query: query || (async () => ({ rows: [] })), connect }],
      [authPath, authModule],
    ],
    purgePaths: [routePath],
  });

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    sessionHarness.attach(req);
    next();
  });
  app.use('/', loaded.loaded);
  app.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    return res.status(error?.status || 500).json({
      error: error?.message || 'Unexpected test error',
    });
  });

  return {
    app,
    restore: loaded.restore,
  };
}

test('hojas-vida baja applies operational restrictions and records the history event', async () => {
  const calls = [];
  const hojaVidaContexto = {
    id: 42,
    equipo_id: 7,
    estado: 'ACTIVA',
    equipo_estado: 'disponible',
    equipo_activo: true,
    inventario_id: 41,
    inventario_activo: true,
    inventario_disponible_prestamo: true,
    ual_id: 4,
  };

  const handleQuery = async (sql, params) => {
    calls.push({ sql, params });
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('FROM hoja_vida hv') && sql.includes('LEFT JOIN inventario inv')) {
      return { rows: [hojaVidaContexto] };
    }
    if (sql.includes('FROM hoja_vida_baja')) return { rows: [] };
    if (sql.includes('INSERT INTO hoja_vida_baja')) {
      return { rows: [{ id: 9, estado: 'APLICADA' }] };
    }
    if (sql.includes('UPDATE equipo') && sql.includes("estado = 'fuera_servicio'")) {
      return { rows: [] };
    }
    if (sql.includes('UPDATE inventario') && sql.includes('disponible_prestamo = FALSE')) {
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO hoja_vida_historial')) return { rows: [] };
    return { rows: [] };
  };

  const client = {
    query: handleQuery,
    release() {},
  };

  const loaded = loadRoute({
    query: handleQuery,
    connect: async () => client,
  });

  try {
    const response = await request(loaded.app).post('/42/baja').send({
      motivo: 'Obsolescencia tecnológica',
      fecha_baja: '2026-11-05',
      responsable: 'Ana Responsable',
      estado: 'APLICADA',
      observaciones: 'Se reemplaza por un equipo nuevo.',
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.data.estado, 'APLICADA');
    assert.equal(response.body.data.bloquea_prestamo, true);
    assert.equal(response.body.data.equipo_estado, 'fuera_servicio');
    assert.equal(response.body.data.inventario_disponible_prestamo, false);
    assert.ok(
      calls.some(
        ({ sql, params }) => sql.includes('INSERT INTO hoja_vida_baja') && params[5] === 'APLICADA'
      )
    );
    assert.ok(
      calls.some(
        ({ sql }) => sql.includes('UPDATE equipo') && sql.includes("estado = 'fuera_servicio'")
      )
    );
    assert.ok(
      calls.some(
        ({ sql }) =>
          sql.includes('UPDATE inventario') && sql.includes('disponible_prestamo = FALSE')
      )
    );
    assert.ok(
      calls.some(
        ({ sql }) => sql.includes('INSERT INTO hoja_vida_historial') && sql.includes("'BAJA'")
      )
    );
    assert.ok(calls.some(({ sql }) => sql === 'COMMIT'));
  } finally {
    loaded.restore();
  }
});

test('hojas-vida baja rejects applying the decommission while the equipment is prestado', async () => {
  const calls = [];
  const hojaVidaContexto = {
    id: 42,
    equipo_id: 7,
    estado: 'ACTIVA',
    equipo_estado: 'prestado',
    equipo_activo: true,
    inventario_id: 41,
    inventario_activo: true,
    inventario_disponible_prestamo: true,
    ual_id: 4,
  };

  const handleQuery = async (sql, params) => {
    calls.push({ sql, params });
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('FROM hoja_vida hv') && sql.includes('LEFT JOIN inventario inv')) {
      return { rows: [hojaVidaContexto] };
    }
    if (sql.includes('FROM hoja_vida_baja')) return { rows: [] };
    if (sql.includes('INSERT INTO hoja_vida_baja')) {
      return { rows: [{ id: 9, estado: 'APLICADA' }] };
    }
    return { rows: [] };
  };

  const client = {
    query: handleQuery,
    release() {},
  };

  const loaded = loadRoute({
    query: handleQuery,
    connect: async () => client,
  });

  try {
    const response = await request(loaded.app).post('/42/baja').send({
      motivo: 'Fin de vida útil',
      fecha_baja: '2026-11-05',
      responsable: 'Ana Responsable',
      estado: 'APLICADA',
      observaciones: '',
    });

    assert.equal(response.status, 409);
    assert.equal(response.body.ok, false);
    assert.match(response.body.message, /mientras el equipo está prestado/i);
    assert.ok(calls.some(({ sql }) => sql === 'ROLLBACK'));
    assert.equal(
      calls.some(({ sql }) => sql === 'COMMIT'),
      false
    );
    assert.equal(
      calls.some(({ sql }) => sql.includes('UPDATE inventario') || sql.includes('UPDATE equipo')),
      false
    );
    assert.equal(
      calls.some(({ sql }) => sql.includes('INSERT INTO hoja_vida_historial')),
      false
    );
  } finally {
    loaded.restore();
  }
});
