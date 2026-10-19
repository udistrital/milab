const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const scopePath = path.resolve(__dirname, '../../../src/libs/capacitacion-scope.js');

function loadScope(queryImpl = async () => ({ rows: [] })) {
  const originalDb = require.cache[dbPath];
  const originalScope = require.cache[scopePath];
  delete require.cache[scopePath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { query: queryImpl },
  };

  return {
    scope: require(scopePath),
    restore() {
      delete require.cache[scopePath];
      if (originalDb) {
        require.cache[dbPath] = originalDb;
      } else {
        delete require.cache[dbPath];
      }
      if (originalScope) {
        require.cache[scopePath] = originalScope;
      }
    },
  };
}

test('scope recognizes administrator, laboratorista and localized role aliases', () => {
  const loaded = loadScope();

  try {
    assert.equal(loaded.scope.isAdminRole({ tipo: 'COORDINACIÓN GENERAL' }), true);
    assert.equal(loaded.scope.isAdminRole({ roles: ['administradora'] }), true);
    assert.equal(loaded.scope.isLaboratoristaRole({ role: 'Técnico laboratorista' }), true);
    assert.equal(loaded.scope.isLaboratoristaRole({ tipo: 'estudiante' }), false);
  } finally {
    loaded.restore();
  }
});

test('admin scope does not query assignments and allows global course filtering', async () => {
  let queryCount = 0;
  const loaded = loadScope(async () => {
    queryCount += 1;
    return { rows: [] };
  });

  try {
    const scope = await loaded.scope.resolveLaboratoristaScope({
      session: { user: { tipo: 'admin', documento: 'admin-1' } },
    });

    assert.equal(scope.isAdmin, true);
    assert.equal(scope.documento, 'admin-1');
    assert.equal(scope.cursoFilterRequired, false);
    assert.deepEqual(scope.ualIds, []);
    assert.equal(queryCount, 0);
  } finally {
    loaded.restore();
  }
});

test('laboratorista scope resolves distinct active faculties and UALs', async () => {
  const loaded = loadScope(async (sql) => {
    if (sql.includes('SELECT documento FROM laboratorista')) {
      return { rows: [{ documento: 'lab-1' }] };
    }
    return {
      rows: [
        {
          ual_id: 10,
          nombre_laboratorio: 'Lab A',
          codigo_abreviacion: 'A',
          facultad_id: 2,
          nombre_facultad: 'Facultad X',
        },
        {
          ual_id: 10,
          nombre_laboratorio: 'Lab A',
          codigo_abreviacion: 'A',
          facultad_id: 2,
          nombre_facultad: 'Facultad X',
        },
        {
          ual_id: 11,
          nombre_laboratorio: 'Lab B',
          codigo_abreviacion: null,
          facultad_id: 3,
          nombre_facultad: 'Dependencia Y',
        },
      ],
    };
  });

  try {
    const scope = await loaded.scope.resolveLaboratoristaScope({
      session: { user: { tipo: 'laboratorista_ud', documento_real: 'lab-login' } },
    });

    assert.equal(scope.isLaboratorista, true);
    assert.equal(scope.authDocumento, 'lab-login');
    assert.equal(scope.documento, 'lab-1');
    assert.deepEqual(scope.facultyIds, [2, 3]);
    assert.deepEqual(scope.ualIds, [10, 11]);
    assert.deepEqual(scope.laboratorios[1], {
      ual_id: 11,
      nombre: 'Lab B',
      codigo: null,
      codigo_abreviacion: null,
      facultad_id: 3,
    });
  } finally {
    loaded.restore();
  }
});

test('scope-query errors leave a laboratorista with no management assignments', async () => {
  const loaded = loadScope(async (sql) => {
    if (sql.includes('SELECT documento FROM laboratorista')) {
      return { rows: [{ documento: 'lab-1' }] };
    }
    throw new Error('assignment query unavailable');
  });

  try {
    const scope = await loaded.scope.resolveLaboratoristaScope({
      session: { user: { tipo: 'laboratorista', documento: 'lab-1' } },
    });

    assert.equal(scope.isAdmin, false);
    assert.deepEqual(scope.facultyIds, []);
    assert.deepEqual(scope.ualIds, []);
    assert.match(scope.resolvedFrom, /query_error/);
  } finally {
    loaded.restore();
  }
});
