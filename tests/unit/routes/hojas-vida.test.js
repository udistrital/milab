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

test('hojas-vida dashboard aggregates indicators and applies the alert rules', async () => {
  const mantenimientos = [
    {
      id: 1,
      equipo_id: 7,
      tipo_mantenimiento: 'PREVENTIVO',
      estado: 'PENDIENTE',
      fecha_realizacion: '2020-01-01',
      costo: 100,
      equipo_codigo: 'EQ-1',
      equipo_nombre: 'Equipo 1',
      laboratorio: 'Lab A',
      facultad: 'Facultad X',
    },
    {
      id: 2,
      equipo_id: 8,
      tipo_mantenimiento: 'CORRECTIVO',
      estado: 'CUMPLIDO',
      fecha_realizacion: '2024-06-15',
      costo: 300,
      equipo_codigo: 'EQ-2',
      equipo_nombre: 'Equipo 2',
      laboratorio: 'Lab B',
      facultad: 'Facultad Y',
    },
  ];

  const handleQuery = async (sql) => {
    if (sql.includes('FROM mantenimiento m') && sql.includes('JOIN equipo_catalogo ec')) {
      return { rows: mantenimientos };
    }
    if (sql.includes('COUNT(DISTINCT hv.id)')) {
      return { rows: [{ total_hojas: 3, hojas_activas: 2, hojas_pendientes: 1 }] };
    }
    if (sql.includes('FROM hoja_vida_baja b')) {
      return { rows: [{ total: 1 }] };
    }
    return { rows: [] };
  };

  const loaded = loadRoute({ query: handleQuery });

  try {
    const response = await request(loaded.app).get('/dashboard');

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    const data = response.body.data;
    assert.equal(data.alcance, 'global');
    assert.equal(data.resumen.mantenimientos_total, 2);
    assert.equal(data.resumen.costo_total, 400);
    assert.equal(data.resumen.costo_promedio, 200);
    assert.equal(data.resumen.equipos_con_hoja_vida, 3);
    assert.equal(data.resumen.hojas_activas, 2);
    assert.equal(data.resumen.bajas_aplicadas, 1);
    assert.equal(data.resumen.alertas_total, 1);

    const cumplido = data.por_estado.find((item) => item.estado === 'CUMPLIDO');
    assert.equal(cumplido.total, 1);
    assert.equal(data.por_tipo.length, 2);
    assert.equal(data.por_laboratorio.length, 2);
    assert.equal(data.top_equipos_costo[0].equipo_id, 8);
    assert.equal(data.alertas_por_situacion.length, 1);
    assert.equal(data.alertas_por_situacion[0].situacion, 'VENCIDO');
  } finally {
    loaded.restore();
  }
});

function fechaISO(desplazoDias) {
  const base = new Date();
  base.setDate(base.getDate() + desplazoDias);
  const mes = String(base.getMonth() + 1).padStart(2, '0');
  const dia = String(base.getDate()).padStart(2, '0');
  return `${base.getFullYear()}-${mes}-${dia}`;
}

test('hojas-vida programacion lists scheduled maintenance and derives alerts by situacion', async () => {
  const filas = [
    {
      mantenimiento_id: 1,
      equipo_id: 7,
      item: 'Cambio de aceite',
      tipo_mantenimiento: 'PREVENTIVO',
      fecha_realizacion: fechaISO(-5),
      estado: 'PENDIENTE',
      responsable: 'Ana',
      formato_registro: null,
      codigo_interno: 'EQ-1',
      nombre_equipo: 'Equipo 1',
      laboratorio: 'Lab A',
      facultad: 'Facultad X',
      codigo_inventario: 'P-1',
    },
    {
      mantenimiento_id: 2,
      equipo_id: 8,
      item: 'Calibracion',
      tipo_mantenimiento: 'CALIBRACION',
      fecha_realizacion: fechaISO(10),
      estado: 'PENDIENTE',
      responsable: null,
      formato_registro: null,
      codigo_interno: 'EQ-2',
      nombre_equipo: 'Equipo 2',
      laboratorio: 'Lab B',
      facultad: 'Facultad Y',
      codigo_inventario: 'P-2',
    },
    {
      mantenimiento_id: 3,
      equipo_id: 9,
      item: 'Limpieza',
      tipo_mantenimiento: 'LIMPIEZA',
      fecha_realizacion: fechaISO(200),
      estado: 'PENDIENTE',
      responsable: null,
      formato_registro: null,
      codigo_interno: 'EQ-3',
      nombre_equipo: 'Equipo 3',
      laboratorio: 'Lab C',
      facultad: 'Facultad Z',
      codigo_inventario: 'P-3',
    },
  ];

  const handleQuery = async (sql) => {
    if (sql.includes('FROM mantenimiento_config')) {
      return { rows: [{ dias_alerta_vencimiento: 30 }] };
    }
    if (sql.includes('FROM mantenimiento m') && sql.includes('JOIN equipo_catalogo ec')) {
      return { rows: filas };
    }
    return { rows: [] };
  };

  const loaded = loadRoute({ query: handleQuery });

  try {
    const response = await request(loaded.app).get('/programacion');

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.resumen.total, 3);
    assert.equal(response.body.resumen.programados, 3);
    assert.equal(response.body.resumen.proximos, 1);
    assert.equal(response.body.resumen.vencidos, 1);
    assert.equal(response.body.alertas.length, 2);
    assert.equal(response.body.data.length, 3);
    assert.equal(response.body.dias_alerta_vencimiento, 30);
    assert.equal(response.body.data[0].estado_etiqueta, 'Programado');
    assert.equal(response.body.data[0].situacion.codigo, 'VENCIDO');
  } finally {
    loaded.restore();
  }
});

test('hojas-vida programacion schedules the next maintenance and records the history event', async () => {
  const clientCalls = [];
  const client = {
    query: async (sql, params) => {
      clientCalls.push({ sql, params });
      if (sql.includes('INSERT INTO mantenimiento')) {
        return { rows: [{ id: 99, estado: 'PENDIENTE' }] };
      }
      return { rows: [] };
    },
    release() {},
  };

  const handleQuery = async (sql) => {
    if (sql.includes('FROM equipo_catalogo ec')) {
      return {
        rows: [
          {
            equipo_id: 7,
            codigo_interno: 'EQ-1',
            nombre_equipo: 'Equipo 1',
            laboratorio: 'Lab A',
            facultad: 'Facultad X',
            codigo_inventario: 'P-1',
            ual_id: 4,
          },
        ],
      };
    }
    if (sql.includes('FROM hoja_vida') && sql.includes('equipo_id = $1')) {
      return { rows: [{ id: 42, equipo_id: 7, estado: 'ACTIVA' }] };
    }
    if (sql.includes('FROM hoja_vida_baja')) return { rows: [] };
    return { rows: [] };
  };

  const loaded = loadRoute({ query: handleQuery, connect: async () => client });

  try {
    const response = await request(loaded.app)
      .post('/programacion')
      .send({
        equipo_id: 7,
        item: 'Cambio de aceite',
        tipo_mantenimiento: 'PREVENTIVO',
        fecha_realizacion: fechaISO(15),
      });

    assert.equal(response.status, 201);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.data.mantenimiento_id, 99);
    assert.equal(response.body.data.estado, 'PENDIENTE');
    assert.ok(clientCalls.some(({ sql }) => sql.includes('INSERT INTO mantenimiento')));
    assert.ok(clientCalls.some(({ sql }) => sql.includes('INSERT INTO hoja_vida_historial')));
  } finally {
    loaded.restore();
  }
});

test('hojas-vida programacion rejects a missing or past schedule date', async () => {
  const loaded = loadRoute({});

  try {
    const sinFecha = await request(loaded.app).post('/programacion').send({
      equipo_id: 7,
      item: 'Cambio de aceite',
      tipo_mantenimiento: 'PREVENTIVO',
    });
    assert.equal(sinFecha.status, 400);
    assert.deepEqual(sinFecha.body.details.campos_faltantes, ['fecha_realizacion']);

    const fechaPasada = await request(loaded.app)
      .post('/programacion')
      .send({
        equipo_id: 7,
        item: 'Cambio de aceite',
        tipo_mantenimiento: 'PREVENTIVO',
        fecha_realizacion: fechaISO(-3),
      });
    assert.equal(fechaPasada.status, 400);
  } finally {
    loaded.restore();
  }
});
