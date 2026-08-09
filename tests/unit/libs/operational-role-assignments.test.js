const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ensureOperationalRoleAssignmentsSchema,
  fetchOperationalRoleAssignmentsByUserId,
  fetchOperationalRoleScopeByUser,
  replaceOperationalRoleAssignments,
} = require('../../../src/libs/operational-role-assignments');

function createExecutor(results = []) {
  const calls = [];

  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return results.shift() || { rows: [] };
    },
  };
}

test('ensureOperationalRoleAssignmentsSchema creates table and indexes once per process', async () => {
  const executor = createExecutor();

  await ensureOperationalRoleAssignmentsSchema(executor);
  const callCountAfterFirstRun = executor.calls.length;
  await ensureOperationalRoleAssignmentsSchema(executor);

  assert.equal(callCountAfterFirstRun, 4);
  assert.equal(executor.calls.length, 4);
});

test('fetchOperationalRoleAssignmentsByUserId returns empty for invalid inputs', async () => {
  const executor = createExecutor();

  const result = await fetchOperationalRoleAssignmentsByUserId('bad', '', executor);

  assert.deepEqual(result, []);
  assert.equal(executor.calls.some((call) => call.sql.includes('FROM usuario_ual_rol_operativo a')), false);
});

test('fetchOperationalRoleScopeByUser returns normalized unique faculty ids, uals and lab names', async () => {
  const executor = createExecutor([
    { rows: [
      { id: 1, usuario_id: 10, ual_id: 4, ual_nombre: 'Lab Redes', facultad_id: 7 },
      { id: 2, usuario_id: 10, ual_id: 4, ual_nombre: 'lab redes', facultad_id: 7 },
      { id: 3, usuario_id: 10, ual_id: 8, ual_nombre: 'Electronica', facultad_id: 9 },
    ] },
  ]);

  const scope = await fetchOperationalRoleScopeByUser(
    { id: 10, roles: ['monitor', 'docente'] },
    'monitor',
    executor
  );

  assert.deepEqual(scope, {
    role: 'monitor',
    facultyIds: [7, 9],
    laboratoryNames: ['LAB REDES', 'ELECTRONICA'],
    ualIds: [4, 8],
  });
});

test('fetchOperationalRoleScopeByUser returns empty scope when user lacks the requested role', async () => {
  const executor = createExecutor();

  const scope = await fetchOperationalRoleScopeByUser(
    { id: 10, roles: ['docente'] },
    'monitor',
    executor
  );

  assert.deepEqual(scope, {
    role: 'monitor',
    facultyIds: [],
    laboratoryNames: [],
    ualIds: [],
  });
  assert.equal(executor.calls.length, 0);
});

test('replaceOperationalRoleAssignments deactivates scoped assignments and upserts unique ual ids', async () => {
  const executor = createExecutor();

  await replaceOperationalRoleAssignments({
    userId: 42,
    roleName: 'monitor',
    ualIds: [8, '8', 12, 0, null],
    facultyId: 5,
    createdByUserId: 9,
    client: executor,
  });

  const updateCall = executor.calls.find((call) => call.sql.includes('UPDATE usuario_ual_rol_operativo'));
  const insertCall = executor.calls.find((call) => call.sql.includes('INSERT INTO usuario_ual_rol_operativo'));

  assert.deepEqual(updateCall.params, [42, 'monitor', 5]);
  assert.deepEqual(insertCall.params, [42, 'monitor', [8, 12], 9]);
});