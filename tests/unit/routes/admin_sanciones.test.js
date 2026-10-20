const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const path = require('node:path');

const routePath = path.resolve(__dirname, '../../../src/routes/api/admin/sanciones.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const category = { id: 2, nombre: 'Equipos', descripcion: 'Daño de equipos', activo: true };

function setup({
  user = { tipo: 'admin', documento: '123' },
  missing = false,
  duplicate = false,
  auditFailure = false,
} = {}) {
  const previous = require.cache[dbPath];
  const calls = [];
  let releases = 0;
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('INSERT INTO log') && auditFailure) throw new Error('Audit unavailable');
    if (sql.includes('INSERT INTO categoria') && duplicate)
      throw Object.assign(new Error('duplicate'), { code: '23505' });
    if (/^(INSERT INTO categoria|UPDATE categoria)/.test(sql))
      return { rows: missing ? [] : [category] };
    if (sql.includes('FROM categoria_sancion')) return { rows: [category] };
    return { rows: [] };
  };
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      query,
      connect: async () => ({
        query,
        release: () => {
          releases++;
        },
      }),
    },
  };
  delete require.cache[routePath];
  const app = express();
  app.use((req, res, next) => {
    req.session = { user };
    res.render = (view, locals) => res.json({ view, locals });
    next();
  });
  app.use('/', require(routePath));
  return {
    app,
    calls,
    getReleases: () => releases,
    restore: () => {
      if (previous) require.cache[dbPath] = previous;
      else delete require.cache[dbPath];
      delete require.cache[routePath];
    },
  };
}

test('catalog and every mutation reject non-admin roles without database writes', async () => {
  for (const user of [
    null,
    { tipo: 'estudiante' },
    { tipo: 'coordinador' },
    { tipo: 'coordinador_general' },
    { tipo: 'laboratorista' },
  ]) {
    const fixture = setup({ user });
    try {
      const responses = [
        await request(fixture.app).get('/'),
        await request(fixture.app)
          .post('/crear')
          .send({ nombre: 'Equipos', descripcion: 'Daño de equipos' }),
        await request(fixture.app)
          .post('/2/editar')
          .send({ nombre: 'Equipos', descripcion: 'Daño de equipos' }),
        await request(fixture.app).post('/2/estado').send({ activo: 'false' }),
      ];
      responses.forEach((response) => assert.equal(response.body.view, 'home/message_error'));
      assert.equal(fixture.calls.length, 0);
    } finally {
      fixture.restore();
    }
  }
});

test('admin listing includes inactive categories and disables caching', async () => {
  const fixture = setup();
  try {
    const response = await request(fixture.app).get('/');
    assert.equal(response.body.view, 'home/admin_sanciones');
    assert.deepEqual(response.body.locals.categories, [category]);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.doesNotMatch(fixture.calls[0].sql, /WHERE activo/);
  } finally {
    fixture.restore();
  }
});

test('create, edit, deactivate and reactivate commit with audit and preserve historical sanctions', async () => {
  for (const [url, body] of [
    ['/crear', { nombre: ' Equipos ', descripcion: ' Daño de equipos ' }],
    ['/2/editar', { nombre: 'Equipos', descripcion: 'Daño de equipos' }],
    ['/2/estado', { activo: 'false' }],
    ['/2/estado', { activo: 'true' }],
  ]) {
    const fixture = setup();
    try {
      const response = await request(fixture.app).post(url).type('form').send(body);
      assert.equal(response.status, 303);
      assert.match(response.headers.location, /admin\/sanciones\?success=/);
      assert.equal(fixture.calls[0].sql, 'BEGIN');
      assert.equal(fixture.calls.at(-1).sql, 'COMMIT');
      assert.ok(fixture.calls.some((call) => call.sql.includes('INSERT INTO log')));
      assert.ok(!fixture.calls.some((call) => /UPDATE multa|DELETE FROM/.test(call.sql)));
      if (url.endsWith('estado')) assert.equal(fixture.calls[1].params[0], body.activo === 'true');
      else assert.deepEqual(fixture.calls[1].params.slice(0, 2), ['Equipos', 'Daño de equipos']);
      assert.equal(fixture.getReleases(), 1);
    } finally {
      fixture.restore();
    }
  }
});

test('invalid fields and invalid state do not write; missing category rolls back', async () => {
  for (const [url, body] of [
    ['/crear', { nombre: 'x', descripcion: 'Daño' }],
    ['/crear', { nombre: 'Equipo', descripcion: 'x'.repeat(501) }],
    ['/0/editar', { nombre: 'Equipo', descripcion: 'Daño' }],
    ['/2/estado', { activo: 'invalid' }],
  ]) {
    const fixture = setup();
    try {
      assert.equal((await request(fixture.app).post(url).send(body)).status, 400);
      assert.ok(!fixture.calls.some((call) => /INSERT|UPDATE|BEGIN/.test(call.sql)));
    } finally {
      fixture.restore();
    }
  }
  const fixture = setup({ missing: true });
  try {
    assert.equal(
      (await request(fixture.app).post('/2/estado').send({ activo: 'false' })).status,
      404
    );
    assert.ok(fixture.calls.some((call) => call.sql === 'ROLLBACK'));
    assert.ok(!fixture.calls.some((call) => call.sql === 'COMMIT'));
  } finally {
    fixture.restore();
  }
});

test('duplicates render an explicit conflict; audit failures roll back category changes', async () => {
  for (const scenario of [{ duplicate: true }, { auditFailure: true }]) {
    const fixture = setup(scenario);
    try {
      const response = await request(fixture.app)
        .post('/crear')
        .send({ nombre: 'Equipo', descripcion: 'Daño' });
      assert.equal(response.status, scenario.duplicate ? 409 : 500);
      assert.ok(fixture.calls.some((call) => call.sql === 'ROLLBACK'));
      assert.ok(!fixture.calls.some((call) => call.sql === 'COMMIT'));
      assert.equal(fixture.getReleases(), 1);
    } finally {
      fixture.restore();
    }
  }
});
