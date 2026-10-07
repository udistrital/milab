const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../../src/libs/oati-student-record.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');

function loadModule(queryImpl) {
  const originalDb = require.cache[dbPath];
  const queries = [];

  delete require.cache[modulePath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      async query(sql, params) {
        queries.push({ sql, params });
        return queryImpl(sql, params);
      },
    },
  };

  return {
    mod: require(modulePath),
    queries,
    restore() {
      delete require.cache[modulePath];
      if (originalDb) require.cache[dbPath] = originalDb;
      else delete require.cache[dbPath];
    },
  };
}

const EGRESADO = { codigo: '20151234', estado: 'E', carrera: '578' };
const ACTIVO = { codigo: 20242583011, estado: 'A', carrera: '383' };

test('uses the record whose code is associated to the user in MILab', async () => {
  const { mod, queries, restore } = loadModule(() => ({ rows: [{ codigo: '20242583011' }] }));
  try {
    const result = await mod.selectStudentRecordForDocumento([ACTIVO, EGRESADO], '1001219870');
    assert.equal(result.record, ACTIVO);
    assert.equal(result.matchedAssociation, true);
    assert.deepEqual(queries[0].params, ['1001219870']);
  } finally {
    restore();
  }
});

test('uses the associated record even when it is EGRESADO', async () => {
  const { mod, restore } = loadModule(() => ({ rows: [{ codigo: '20151234' }] }));
  try {
    const result = await mod.selectStudentRecordForDocumento([EGRESADO, ACTIVO], '1001219870');
    assert.equal(result.record, EGRESADO);
  } finally {
    restore();
  }
});

test('falls back to the last record without a user or associated code', async () => {
  for (const rows of [[], [{ codigo: null }], [{ codigo: '99999999' }]]) {
    const { mod, restore } = loadModule(() => ({ rows }));
    try {
      const result = await mod.selectStudentRecordForDocumento([ACTIVO, EGRESADO], '1001219870');
      assert.equal(result.record, EGRESADO);
      assert.equal(result.matchedAssociation, false);
    } finally {
      restore();
    }
  }
});

test('accepts a single OATI record object and empty collections', async () => {
  const { mod, queries, restore } = loadModule(() => ({ rows: [] }));
  try {
    assert.equal((await mod.selectStudentRecordForDocumento(EGRESADO, '1001')).record, EGRESADO);
    assert.equal((await mod.selectStudentRecordForDocumento([], '1001')).record, undefined);
    assert.equal((await mod.selectStudentRecordForDocumento([ACTIVO], 'abc')).record, ACTIVO);
    assert.equal(queries.length, 1);
  } finally {
    restore();
  }
});

test('collects unique numeric codes of the same person', () => {
  const { mod, restore } = loadModule(() => ({ rows: [] }));
  try {
    assert.deepEqual(
      mod.collectStudentCodigos([ACTIVO, EGRESADO, { codigo: 'x' }], '20151234', '777'),
      ['20242583011', '20151234', '777']
    );
  } finally {
    restore();
  }
});

test('checks SGA debts for every code and fails if any lookup fails', async () => {
  const { mod, restore } = loadModule(() => ({ rows: [] }));
  try {
    const calls = [];
    const debts = await mod.getActiveSgaDebtsForStudent(
      {
        async getActiveDebts(student) {
          calls.push(student);
          return student.codigo === '20151234' ? [{ codigo: '20151234' }] : [];
        },
      },
      { codigos: ['20242583011', '20151234'], documento: '1001' }
    );
    assert.deepEqual(debts, [{ codigo: '20151234' }]);
    assert.deepEqual(calls, [
      { codigo: '20242583011', documento: '1001' },
      { codigo: '20151234', documento: '1001' },
    ]);

    await assert.rejects(
      mod.getActiveSgaDebtsForStudent(
        {
          async getActiveDebts(student) {
            if (student.codigo === '20151234') throw new Error('SGA down');
            return [];
          },
        },
        { codigos: ['20242583011', '20151234'], documento: '1001' }
      ),
      /SGA down/
    );
  } finally {
    restore();
  }
});
