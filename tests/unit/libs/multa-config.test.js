const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const multaConfigPath = path.resolve(__dirname, '../../../src/libs/multa-config.js');

function loadMultaConfig(queryImpl) {
  const queries = [];
  const fakePool = {
    query: async (sql, params = []) => {
      queries.push({ sql, params });
      return queryImpl(sql, params);
    },
  };
  const previousDb = require.cache[dbPath];
  const previousConfig = require.cache[multaConfigPath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakePool };
  delete require.cache[multaConfigPath];
  const lib = require(multaConfigPath);
  const restore = () => {
    if (previousDb) require.cache[dbPath] = previousDb;
    else delete require.cache[dbPath];
    if (previousConfig) require.cache[multaConfigPath] = previousConfig;
    else delete require.cache[multaConfigPath];
  };
  return { lib, queries, restore };
}

test('fetchMultaConfigsForFacultyIds resolves unit ids to their parent faculty config', async () => {
  const { lib, queries, restore } = loadMultaConfig(() => ({
    rows: [
      {
        requested_id: 12,
        facultad_id: 5,
        permite_crear_multas_activas_directas: true,
        permite_saldar_multas_directas: false,
      },
    ],
  }));
  try {
    const map = await lib.fetchMultaConfigsForFacultyIds([12, 40]);

    assert.match(queries[0].sql, /COALESCE\(unidad\.padre_id, unidad\.dependencia_facultad_id\)/);
    assert.deepEqual(queries[0].params, [12, 40]);
    assert.equal(map.get(12).permite_crear_multas_activas_directas, true);
    assert.equal(map.get(12).facultad_id, 5);
    assert.equal(map.get(40).permite_crear_multas_activas_directas, false);
  } finally {
    restore();
  }
});

test('resolveMultaConfigForUalId joins the config through the parent faculty', async () => {
  const { lib, queries, restore } = loadMultaConfig(() => ({
    rows: [{ facultad_id: 5, permite_saldar_multas_directas: true }],
  }));
  try {
    const cfg = await lib.resolveMultaConfigForUalId(7);

    assert.match(queries[0].sql, /COALESCE\(unidad\.padre_id, unidad\.dependencia_facultad_id\)/);
    assert.deepEqual(queries[0].params, [7]);
    assert.equal(cfg.permite_saldar_multas_directas, true);
  } finally {
    restore();
  }
});

test('upsertConfigForFacultyId writes the config keyed by faculty id', async () => {
  const { lib, queries, restore } = loadMultaConfig(() => ({
    rows: [{ facultad_id: 5, permite_crear_multas_activas_directas: true }],
  }));
  try {
    const cfg = await lib.upsertConfigForFacultyId(
      5,
      { permite_crear_multas_activas_directas: true },
      '123',
      'ACTIVAR'
    );

    assert.match(queries[0].sql, /ON CONFLICT \(facultad_id\)/);
    assert.equal(queries[0].params[0], 5);
    assert.equal(cfg.permite_crear_multas_activas_directas, true);
  } finally {
    restore();
  }
});
