const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const path = require('node:path');

const routePath = path.resolve(__dirname, '../../../src/routes/api/admin/festivos.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');

function setup({ user = { tipo: 'admin', documento: '123' }, fetchImpl } = {}) {
  const previousDb = require.cache[dbPath];
  const previousFetch = global.fetch;
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('INSERT INTO festivo_colombia')) return { rows: [], rowCount: 1 };
    if (sql.includes('DELETE FROM festivo_colombia')) {
      return { rows: [{ fecha: '2026-01-01', nombre: 'Año Nuevo' }], rowCount: 1 };
    }
    if (sql.includes('SELECT TO_CHAR(fecha')) {
      return { rows: [{ fecha: '2026-01-01', nombre: 'Año Nuevo', fuente: 'Nager.Date' }] };
    }
    return { rows: [], rowCount: 0 };
  };
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      query,
      connect: async () => ({
        query,
        release: () => calls.push({ sql: 'RELEASE' }),
      }),
    },
  };
  if (fetchImpl) global.fetch = fetchImpl;
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
    restore: () => {
      if (previousDb) require.cache[dbPath] = previousDb;
      else delete require.cache[dbPath];
      if (previousFetch) global.fetch = previousFetch;
      else delete global.fetch;
      delete require.cache[routePath];
    },
  };
}

test('only the admin role can view and modify Colombian holidays', async () => {
  for (const user of [null, { tipo: 'estudiante' }, { tipo: 'coordinador' }]) {
    const fixture = setup({ user });
    try {
      const responses = [
        await request(fixture.app).get('/'),
        await request(fixture.app).post('/crear').send({ fecha: '2026-01-01', nombre: 'Festivo' }),
      ];
      responses.forEach((response) => assert.equal(response.body.view, 'home/message_error'));
      assert.equal(fixture.calls.length, 0);
    } finally {
      fixture.restore();
    }
  }
});

test('admin year selection rejects years outside the supported range', async () => {
  const fixture = setup();
  try {
    const response = await request(fixture.app).get('/?year=2101');
    assert.equal(response.body.view, 'home/admin_festivos');
    assert.equal(response.body.locals.year, new Date().getFullYear());
    assert.match(response.body.locals.error, /entre 2000 y 2100/);
  } finally {
    fixture.restore();
  }
});

test('holiday import accepts only national dates and preserves manual entries on conflict', async () => {
  const fixture = setup({
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://date.nager.at/api/v3/PublicHolidays/2026/CO');
      assert.equal(options.headers.Accept, 'application/json');
      return {
        ok: true,
        status: 200,
        json: async () => [
          { date: '2026-01-01', localName: 'Año Nuevo', global: true },
          { date: '2026-06-15', localName: 'Festivo regional', global: false },
          { date: '2026-02-30', localName: 'Fecha no válida', global: true },
          { date: '2027-01-01', localName: 'Otro año', global: true },
        ],
      };
    },
  });

  try {
    const response = await request(fixture.app).post('/importar').send({ year: '2026' });
    assert.equal(response.status, 303);
    assert.match(response.headers.location, /year=2026&success=/);
    const insert = fixture.calls.find((call) => call.sql.includes('INSERT INTO festivo_colombia'));
    assert.deepEqual(insert.params, ['2026-01-01', 'Año Nuevo']);
    assert.match(insert.sql, /WHERE festivo_colombia\.fuente <> 'manual'/);
    assert.ok(!fixture.calls.some((call) => call.params?.[0] === '2026-06-15'));
    assert.ok(fixture.calls.some((call) => call.sql === 'COMMIT'));
  } finally {
    fixture.restore();
  }
});

test('manual festivo dates must be real calendar dates', async () => {
  const fixture = setup();
  try {
    const response = await request(fixture.app)
      .post('/crear')
      .send({ fecha: '2026-02-30', nombre: 'Fecha no válida' });
    assert.equal(response.status, 303);
    assert.match(response.headers.location, /error=/);
    assert.ok(!fixture.calls.some((call) => call.sql.includes('INSERT INTO festivo_colombia')));
  } finally {
    fixture.restore();
  }
});
