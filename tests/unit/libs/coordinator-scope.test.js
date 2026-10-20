const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildMultaScopeFilter,
  hasCoordinatorScope,
  resolveCoordinatorScopeByRecord,
} = require('../../../src/libs/faculty-scope');

function buildClient({ facultyRows = [], ualRows = [], usuarioRows = [] } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes('to_regclass')) {
        return { rows: [{ tabla: 'milab.usuario_ual_rol_operativo' }] };
      }
      if (sql.includes('coordinador_facultad_alcance')) {
        return { rows: facultyRows };
      }
      if (sql.includes('FROM usuario_ual_rol_operativo')) {
        return { rows: ualRows };
      }
      if (sql.includes('FROM usuario')) {
        return { rows: usuarioRows };
      }
      return { rows: [] };
    },
  };
}

const coordinador = {
  documento: '1001',
  nombre_u: 'coord',
  correo: 'c@udistrital.edu.co',
  usuario_id: 7,
};

test('resolveCoordinatorScopeByRecord returns faculties and UALs separately', async () => {
  const client = buildClient({
    facultyRows: [{ facultad_id: 3 }, { facultad_id: 3 }, { facultad_id: 5 }],
    ualRows: [{ ual_id: 11 }, { ual_id: 12 }],
  });

  const scope = await resolveCoordinatorScopeByRecord(client, coordinador);

  assert.deepEqual(scope.facultyIds, [3, 5]);
  assert.deepEqual(scope.ualIds, [11, 12]);
  assert.equal(scope.coordinatorDocument, '1001');
});

test('resolveCoordinatorScopeByRecord skips the UAL lookup when no usuario is linked', async () => {
  const client = buildClient({ facultyRows: [{ facultad_id: 3 }] });

  const scope = await resolveCoordinatorScopeByRecord(client, {
    documento: '1002',
    nombre_u: 'otro',
    correo: null,
    usuario_id: null,
  });

  assert.deepEqual(scope.ualIds, []);
  assert.deepEqual(scope.facultyIds, [3]);
});

test('hasCoordinatorScope is true with UALs or faculties only', () => {
  assert.equal(hasCoordinatorScope({ ualIds: [1], facultyIds: [] }), true);
  assert.equal(hasCoordinatorScope({ ualIds: [], facultyIds: [2] }), true);
  assert.equal(hasCoordinatorScope({ ualIds: [], facultyIds: [] }), false);
  assert.equal(hasCoordinatorScope(null), false);
});

test('buildMultaScopeFilter uses UALs when present, even if faculties are also present', () => {
  const filter = buildMultaScopeFilter({ ualIds: [11], facultyIds: [3, 5] }, 2);

  assert.equal(filter.sql, 'u.ual_id = ANY($2::int[])');
  assert.deepEqual(filter.value, [11]);
});

test('buildMultaScopeFilter falls back to faculty scope when there are no UALs', () => {
  const filter = buildMultaScopeFilter({ ualIds: [], facultyIds: [3, 5] }, 1);

  assert.equal(filter.sql, 'u.facultad_id = ANY($1::int[])');
  assert.deepEqual(filter.value, [3, 5]);
});
