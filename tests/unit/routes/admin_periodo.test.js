const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const path = require('node:path');

const routePath = path.resolve(__dirname, '../../../src/routes/api/admin/periodo.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const oatiPath = path.resolve(__dirname, '../../../src/libs/oati-client.js');

function setup({ user = { tipo: 'admin', documento: '123' }, oatiResponse } = {}) {
  const previousDb = require.cache[dbPath];
  const previousOati = require.cache[oatiPath];
  const calls = [];
  const history = [];
  let oatiPathRequested = null;
  const applyQuery = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes('SELECT id, codigo_periodo') && sql.includes('FOR UPDATE')) {
      return { rows: history.filter((period) => period.activo).map((period) => ({ ...period })) };
    }
    if (sql.includes('UPDATE periodo_academico_historial')) {
      const period = history.find((item) => item.id === params[0]);
      period.activo = false;
      period.fecha_desactivacion = '2026-01-02 00:00';
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO periodo_academico_historial')) {
      const [codigoPeriodo, periodoAnterior, documento] = params;
      history.push({
        id: history.length + 1,
        codigo_periodo: codigoPeriodo,
        periodo_anterior: periodoAnterior,
        activo: true,
        fecha_activacion: '2026-01-02 00:00',
        fecha_desactivacion: null,
        consultado_por_documento: documento,
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('FROM periodo_academico_historial')) {
      const rows = history.map((period) => ({ ...period }));
      return {
        rows: sql.includes('WHERE activo = TRUE') ? rows.filter((item) => item.activo) : rows,
      };
    }
    return { rows: [], rowCount: 0 };
  };
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      query: applyQuery,
      connect: async () => ({
        query: applyQuery,
        release: () => calls.push({ sql: 'RELEASE' }),
      }),
    },
  };
  require.cache[oatiPath] = {
    id: oatiPath,
    filename: oatiPath,
    loaded: true,
    exports: {
      getAcademicServicePath: (servicePath) => {
        oatiPathRequested = servicePath;
        return `wso2eiserver/services/academica_pruebas/${servicePath}`;
      },
      requestOati: async () => oatiResponse,
    },
  };
  delete require.cache[routePath];
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    req.session = user ? { user } : {};
    res.render = (view, locals) => res.json({ view, locals });
    next();
  });
  app.use('/', require(routePath));
  return {
    app,
    calls,
    history,
    getOatiPathRequested: () => oatiPathRequested,
    restore() {
      if (previousDb) require.cache[dbPath] = previousDb;
      else delete require.cache[dbPath];
      if (previousOati) require.cache[oatiPath] = previousOati;
      else delete require.cache[oatiPath];
      delete require.cache[routePath];
    },
  };
}

test('only administrators can access period configuration, including coordinator-general reads', async () => {
  for (const user of [null, { tipo: 'laboratorista' }, { tipo: 'coordinador_general' }]) {
    const fixture = setup({ user });
    try {
      const response = await request(fixture.app).get('/');
      assert.equal(response.body.view, 'home/message_error');
      assert.equal(fixture.calls.length, 0);
    } finally {
      fixture.restore();
    }
  }
});

test('administrator can view the active period and complete history', async () => {
  const fixture = setup();
  fixture.history.push({
    id: 1,
    codigo_periodo: '2026-1',
    periodo_anterior: null,
    activo: true,
    fecha_activacion: '2026-01-02 00:00',
    fecha_desactivacion: null,
    consultado_por_documento: '123',
  });
  try {
    const response = await request(fixture.app).get('/');
    assert.equal(response.body.view, 'home/admin_periodo');
    assert.equal(response.body.locals.activePeriod.codigo_periodo, '2026-1');
    assert.equal(response.body.locals.periodHistory.length, 1);
  } finally {
    fixture.restore();
  }
});

test('initial OATI synchronization assigns the active period without generating a change alert', async () => {
  const fixture = setup({
    oatiResponse: {
      periodoAcademicoCollection: {
        periodoAcademico: { codigo: '2026-1' },
      },
    },
  });
  try {
    const response = await request(fixture.app).post('/sincronizar');
    assert.equal(response.status, 303);
    assert.match(decodeURIComponent(response.headers.location), /2026-1 quedó asignado/);
    assert.equal(fixture.getOatiPathRequested(), 'periodo_academico/A');
    assert.equal(fixture.history.length, 1);
    assert.equal(fixture.history[0].codigo_periodo, '2026-1');
    assert.equal(fixture.history[0].periodo_anterior, null);
    assert.equal(fixture.history[0].activo, true);
    assert.ok(fixture.calls.some((call) => call.sql === 'COMMIT'));
  } finally {
    fixture.restore();
  }
});

test('synchronizing an unchanged OATI period does not create another history row', async () => {
  const fixture = setup({ oatiResponse: { periodo_actual: '2025-3' } });
  fixture.history.push({
    id: 1,
    codigo_periodo: '2025-3',
    periodo_anterior: null,
    activo: true,
    fecha_activacion: '2025-08-01 00:00',
    fecha_desactivacion: null,
  });
  try {
    const response = await request(fixture.app).post('/sincronizar');
    assert.equal(response.status, 303);
    assert.match(decodeURIComponent(response.headers.location), /ya estaba activo/);
    assert.equal(fixture.history.length, 1);
    assert.ok(fixture.calls.some((call) => call.sql === 'COMMIT'));
    assert.ok(
      !fixture.calls.some((call) => call.sql.includes('INSERT INTO periodo_academico_historial'))
    );
  } finally {
    fixture.restore();
  }
});

test('OATI period changes are recorded once and keep the previous period for the lab alert', async () => {
  const fixture = setup({
    oatiResponse: '<periodoAcademico><codigoPeriodo>2026-1</codigoPeriodo></periodoAcademico>',
  });
  fixture.history.push({
    id: 1,
    codigo_periodo: '2025-3',
    periodo_anterior: null,
    activo: true,
    fecha_activacion: '2025-08-01 00:00',
    fecha_desactivacion: null,
  });
  try {
    const response = await request(fixture.app).post('/sincronizar');
    assert.equal(response.status, 303);
    assert.match(
      decodeURIComponent(response.headers.location),
      /generó una alerta para los laboratoristas/
    );
    assert.equal(fixture.history.length, 2);
    assert.equal(fixture.history[0].activo, false);
    assert.equal(fixture.history[1].periodo_anterior, '2025-3');
    assert.equal(fixture.history[1].codigo_periodo, '2026-1');
    assert.equal(fixture.history[1].activo, true);
  } finally {
    fixture.restore();
  }
});

test('invalid OATI period responses are surfaced without changing history', async () => {
  const fixture = setup({ oatiResponse: { resultado: 'sin período' } });
  try {
    const response = await request(fixture.app).post('/sincronizar');
    assert.equal(response.status, 303);
    assert.match(
      decodeURIComponent(response.headers.location),
      /No fue posible consultar o actualizar/
    );
    assert.equal(fixture.history.length, 0);
    assert.ok(!fixture.calls.some((call) => call.sql === 'BEGIN'));
  } finally {
    fixture.restore();
  }
});
