const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('dashboard exports an Express router with handlers', () => {
  const modulePath = path.resolve(__dirname, '../../../src/routes/api/dashboard.js');
  delete require.cache[modulePath];
  const router = require(modulePath);

  assert.equal(typeof router, 'function');
  assert.equal(typeof router.use, 'function');
  assert.equal(Array.isArray(router.stack), true);
  assert.equal(router.stack.length > 0, true);
});

test('dashboard uses legacy coordinador_facultad document column when present', async () => {
  const modulePath = path.resolve(__dirname, '../../../src/routes/api/dashboard.js');
  delete require.cache[modulePath];
  const router = require(modulePath);

  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      return { rows: [] };
    },
  };

  await router.__private.fetchCoordinatorRows(client, {
    coordinadorFacultadIdColumn: 'id_facultad',
    coordinadorFacultadDocumentColumn: 'documento',
  });

  await router.__private.fetchUsuarioRows(client, {
    ualIdColumn: 'id_ual',
    facultadIdColumn: 'id_facultad',
    laboratoristaUalIdColumn: 'id_ual',
    laboratoristaUalDocumentColumn: 'documento_laboratorista',
    coordinadorFacultadIdColumn: 'id_facultad',
    coordinadorFacultadDocumentColumn: 'documento',
  });

  assert.equal(queries[0].includes('cf.documento = c.documento'), true);
  assert.equal(queries[1].includes('cf.documento = c.documento'), true);
});
