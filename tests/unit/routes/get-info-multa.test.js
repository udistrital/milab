const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const routePath = path.resolve(__dirname, '../../../src/routes/api/get-info-multa.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const oatiClientPath = path.resolve(__dirname, '../../../src/libs/oati-client.js');
const userIdentityPath = path.resolve(__dirname, '../../../src/libs/user-identity.js');
const authPath = path.resolve(__dirname, '../../../src/routes/middlewares/auth.js');

function loadRoute({ queryImpl } = {}) {
  const originals = new Map();
  const queries = [];
  const stubs = [
    [
      dbPath,
      {
        query: async (sql, params) => {
          queries.push({ sql, params });
          if (typeof queryImpl === 'function') {
            return queryImpl(sql, params);
          }

          return { rows: [] };
        },
      },
    ],
    [
      oatiClientPath,
      {
        getAcademicServicePath: (value) => value,
        requestOati: async () => ({}),
      },
    ],
    [
      userIdentityPath,
      {
        ensurePerfilEstudiante: async () => 1,
      },
    ],
    [
      authPath,
      {
        requireRoles: () => (req, res, next) => next(),
      },
    ],
  ];

  delete require.cache[routePath];

  for (const [modulePath, stub] of stubs) {
    originals.set(modulePath, require.cache[modulePath]);
    require.cache[modulePath] = {
      id: modulePath,
      filename: modulePath,
      loaded: true,
      exports: stub,
    };
  }

  return {
    route: require(routePath),
    getQueries: () => queries,
    restore() {
      for (const [modulePath, original] of originals.entries()) {
        if (original) {
          require.cache[modulePath] = original;
        } else {
          delete require.cache[modulePath];
        }
      }

      delete require.cache[routePath];
    },
  };
}

test('get-info-multa exports an Express router with handlers', () => {
  delete require.cache[routePath];
  const router = require(routePath);

  assert.equal(typeof router, 'function');
  assert.equal(typeof router.use, 'function');
  assert.equal(Array.isArray(router.stack), true);
  assert.equal(router.stack.length > 0, true);
});

test('get-info-multa carga las UAL asignadas al laboratorista antes del fallback legado', async () => {
  const loaded = loadRoute({
    queryImpl: async (sql) => {
      if (sql.includes('FROM laboratorista_ual lu')) {
        return {
          rows: [
            { ual_id: 10, nombre: 'Lab de Quimica' },
            { ual_id: 12, nombre: 'Lab de Fisica' },
          ],
        };
      }

      if (sql.includes('AND facultad_id = $1')) {
        return {
          rows: [{ ual_id: 99, nombre: 'Fallback legado' }],
        };
      }

      return { rows: [] };
    },
  });

  try {
    const uals = await loaded.route.__private.resolveLaboratoristaUals({
      documento: '12345',
      facultad_id: 8,
    });

    assert.deepEqual(uals, [
      { ual_id: 10, nombre: 'Lab de Quimica' },
      { ual_id: 12, nombre: 'Lab de Fisica' },
    ]);
    assert.equal(loaded.getQueries().length, 1);
    assert.equal(loaded.getQueries()[0].sql.includes('FROM laboratorista_ual lu'), true);
  } finally {
    loaded.restore();
  }
});

test('get-info-multa usa el fallback por facultad cuando no hay asignaciones directas', async () => {
  const loaded = loadRoute({
    queryImpl: async (sql) => {
      if (sql.includes('FROM laboratorista_ual lu')) {
        return { rows: [] };
      }

      if (sql.includes('AND facultad_id = $1')) {
        return {
          rows: [{ ual_id: 21, nombre: 'Lab legado' }],
        };
      }

      return { rows: [] };
    },
  });

  try {
    const uals = await loaded.route.__private.resolveLaboratoristaUals({
      documento: '12345',
      facultad_id: 5,
    });

    assert.deepEqual(uals, [{ ual_id: 21, nombre: 'Lab legado' }]);
    assert.equal(loaded.getQueries().length, 2);
    assert.equal(loaded.getQueries()[1].params[0], 5);
  } finally {
    loaded.restore();
  }
});
