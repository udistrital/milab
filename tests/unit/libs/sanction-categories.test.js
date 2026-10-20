const test = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');
const path = require('node:path');
const fs = require('node:fs');
const {
  fetchSanctionCategories,
  isActiveSanctionCategory,
} = require('../../../src/libs/sanction-categories');

test('fresh-install seed and upgrade migration preserve the same 13 categories without resetting edited entries', () => {
  const migration = fs.readFileSync(
    path.resolve(__dirname, '../../../sql/20261008_hotfix_sanciones_dependencias.sql'),
    'utf8'
  );
  const seed = fs.readFileSync(
    path.resolve(__dirname, '../../../sql-scripts/db_seed_system.sql'),
    'utf8'
  );
  const extractSeed = (sql) =>
    sql.match(/INSERT INTO categoria_sancion[\s\S]*?ON CONFLICT DO NOTHING;/)[0];
  assert.equal(extractSeed(migration), extractSeed(seed));
  const entries = [...extractSeed(migration).matchAll(/\('([^']*)', '([^']*)'\)/g)];
  assert.equal(entries.length, 13);
  entries.forEach(([, nombre, descripcion]) => {
    assert.ok(nombre.length <= 150);
    assert.ok(descripcion.length <= 500);
  });
  assert.match(extractSeed(migration), /WHERE NOT EXISTS \(SELECT 1 FROM categoria_sancion\)/);
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/);
  assert.doesNotMatch(migration, /UPDATE multa|DELETE FROM categoria_sancion/);
});

test('category queries filter active options and allow the admin to list inactive categories', async () => {
  const calls = [];
  const categories = [{ id: 1, nombre: 'Equipos', descripcion: 'Daño de equipos', activo: true }];
  const client = {
    query: async (sql) => {
      calls.push(sql);
      return { rows: categories };
    },
  };
  assert.deepEqual(await fetchSanctionCategories({ client }), categories);
  assert.match(calls[0], /WHERE activo = TRUE/);
  await fetchSanctionCategories({ activeOnly: false, client });
  assert.doesNotMatch(calls[1], /WHERE activo/);
});

test('category validation rejects empty, malformed, inactive and unknown values', async () => {
  let calls = 0;
  const client = {
    query: async (sql, values) => {
      calls++;
      assert.match(sql, /descripcion = \$1 AND activo = TRUE/);
      return { rows: values[0] === 'Daño de equipos' ? [{ id: 1 }] : [] };
    },
  };
  for (const value of ['', ' ', undefined, {}, ['Daño de equipos'], 'x'.repeat(501)]) {
    assert.equal(await isActiveSanctionCategory(value, client), false);
  }
  assert.equal(calls, 0);
  assert.equal(await isActiveSanctionCategory(' Daño de equipos ', client), true);
  assert.equal(await isActiveSanctionCategory('Inactiva', client), false);
});

test('missing catalog migration is not silently replaced by static options', async () => {
  const client = {
    query: async () => {
      throw new Error('relation categoria_sancion does not exist');
    },
  };
  await assert.rejects(fetchSanctionCategories({ client }), /does not exist/);
  await assert.rejects(isActiveSanctionCategory('Daño de equipos', client), /does not exist/);
});

test('dropdown renders escaped database descriptions and short names', async () => {
  const html = await ejs.renderFile(
    path.resolve(__dirname, '../../../src/views/partials/multa-options.ejs'),
    {
      sanctionCategories: [{ nombre: 'Equipo <uno>', descripcion: 'Daño "equipo" <script>' }],
    }
  );
  assert.match(html, /Equipo &lt;uno&gt;/);
  assert.match(html, /value="Daño &#34;equipo&#34; &lt;script&gt;"/);
  assert.doesNotMatch(html, /<script>/);
});
