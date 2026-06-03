const test = require('node:test');
const assert = require('node:assert/strict');

const {
  formatRoleLabel,
  getPrimaryRole,
  hasAnyRole,
  normalizeRoles,
} = require('../../../src/libs/roles');

test('normalizeRoles normalizes casing, deduplicates and applies role priority', () => {
  const normalized = normalizeRoles([
    'Docente',
    'ADMIN',
    'coordinador',
    'docente',
    'laboratorista',
  ]);

  assert.deepEqual(normalized, ['admin', 'coordinador', 'laboratorista', 'docente']);
});

test('normalizeRoles sorts unknown roles alphabetically after known roles', () => {
  const normalized = normalizeRoles(['zeta', 'admin', 'beta']);

  assert.deepEqual(normalized, ['admin', 'beta', 'zeta']);
});

test('getPrimaryRole returns highest-priority role', () => {
  const primaryRole = getPrimaryRole(['docente', 'coordinador', 'estudiante']);

  assert.equal(primaryRole, 'coordinador');
});

test('formatRoleLabel returns Invitado for empty roles and formatted labels for known roles', () => {
  assert.equal(formatRoleLabel([]), 'Invitado');
  assert.equal(formatRoleLabel(['coordinador', 'docente']), 'Coordinador · Docente');
});

test('hasAnyRole detects intersections between user and required roles', () => {
  assert.equal(hasAnyRole(['docente', 'estudiante'], ['admin', 'docente']), true);
  assert.equal(hasAnyRole(['estudiante'], ['admin', 'coordinador']), false);
});
