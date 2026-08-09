const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ALL_PERMISSIONS,
  APP_PERMISSIONS,
  getPermissionsForRoles,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
} = require('../../../src/libs/permissions');

test('getPermissionsForRoles grants all permissions to admin', () => {
  assert.deepEqual(getPermissionsForRoles(['admin']), ALL_PERMISSIONS.slice().sort());
});

test('getPermissionsForRoles merges roles without duplicates and keeps monitor restrictions', () => {
  const permissions = getPermissionsForRoles(['monitor', 'laboratorista', 'monitor']);

  assert.equal(permissions.includes(APP_PERMISSIONS.PRESTAMOS_DELIVER), true);
  assert.equal(permissions.includes(APP_PERMISSIONS.PRESTAMOS_INCIDENT_REQUEST_CLOSE), true);
  assert.equal(permissions.includes(APP_PERMISSIONS.USERS_MONITOR_MANAGE), false);
  assert.equal(permissions.length, new Set(permissions).size);
});

test('hasPermission and hasAnyPermission reject missing permission values', () => {
  assert.equal(hasPermission(['admin'], ''), false);
  assert.equal(hasAnyPermission(['monitor'], []), false);
});

test('hasAnyPermission and hasAllPermissions respect combined role permissions', () => {
  const roles = ['coordinador', 'monitor'];

  assert.equal(
    hasAnyPermission(roles, [APP_PERMISSIONS.USERS_MONITOR_VIEW, 'missing.permission']),
    true
  );
  assert.equal(
    hasAllPermissions(roles, [
      APP_PERMISSIONS.PRESTAMOS_REQUEST_APPROVE,
      APP_PERMISSIONS.PRESTAMOS_COORDINATOR_SIGNATURE,
    ]),
    true
  );
  assert.equal(
    hasAllPermissions(roles, [
      APP_PERMISSIONS.PRESTAMOS_REQUEST_APPROVE,
      APP_PERMISSIONS.PRESTAMOS_PARAMETERS_ADMIN,
    ]),
    false
  );
});