const { normalizeRoles } = require('./roles');

const APP_PERMISSIONS = Object.freeze({
  PRESTAMOS_VIEW_MANAGEMENT: 'prestamos.view.management',
  PRESTAMOS_REQUEST_APPROVE: 'prestamos.request.approve',
  PRESTAMOS_REQUEST_REJECT: 'prestamos.request.reject',
  PRESTAMOS_REQUEST_ASSIGN_LAST_MINUTE: 'prestamos.request.assign_last_minute',
  PRESTAMOS_DELIVER: 'prestamos.deliver',
  PRESTAMOS_RECEIVE: 'prestamos.receive',
  PRESTAMOS_INCIDENT_VIEW: 'prestamos.incident.view',
  PRESTAMOS_INCIDENT_CREATE: 'prestamos.incident.create',
  PRESTAMOS_INCIDENT_APPROVE: 'prestamos.incident.approve',
  PRESTAMOS_INCIDENT_REQUEST_CLOSE: 'prestamos.incident.request_close',
  PRESTAMOS_INCIDENT_FINALIZE_CLOSE: 'prestamos.incident.finalize_close',
  PRESTAMOS_REPORTS_VIEW: 'prestamos.reports.view',
  PRESTAMOS_AUDIT_VIEW: 'prestamos.audit.view',
  PRESTAMOS_INVENTORY_ADMIN: 'prestamos.inventory.admin',
  PRESTAMOS_EQUIPMENT_ADMIN: 'prestamos.equipment.admin',
  PRESTAMOS_PRACTICES_MANAGE: 'prestamos.practices.manage',
  PRESTAMOS_ROOMS_MANAGE: 'prestamos.rooms.manage',
  PRESTAMOS_PRACTICES_CONFIG: 'prestamos.practices.config',
  PRESTAMOS_PARAMETERS_ADMIN: 'prestamos.parameters.admin',
  PRESTAMOS_COORDINATOR_SIGNATURE: 'prestamos.coordinator.signature',
  USERS_MONITOR_MANAGE: 'users.monitor.manage',
  USERS_MONITOR_VIEW: 'users.monitor.view',
});

const ALL_PERMISSIONS = Object.freeze(Object.values(APP_PERMISSIONS));

const ROLE_PERMISSION_MAP = Object.freeze({
  admin: ALL_PERMISSIONS,
  coordinador: [
    APP_PERMISSIONS.PRESTAMOS_VIEW_MANAGEMENT,
    APP_PERMISSIONS.PRESTAMOS_REQUEST_APPROVE,
    APP_PERMISSIONS.PRESTAMOS_REQUEST_REJECT,
    APP_PERMISSIONS.PRESTAMOS_REQUEST_ASSIGN_LAST_MINUTE,
    APP_PERMISSIONS.PRESTAMOS_DELIVER,
    APP_PERMISSIONS.PRESTAMOS_RECEIVE,
    APP_PERMISSIONS.PRESTAMOS_INCIDENT_VIEW,
    APP_PERMISSIONS.PRESTAMOS_INCIDENT_CREATE,
    APP_PERMISSIONS.PRESTAMOS_INCIDENT_APPROVE,
    APP_PERMISSIONS.PRESTAMOS_INCIDENT_FINALIZE_CLOSE,
    APP_PERMISSIONS.PRESTAMOS_REPORTS_VIEW,
    APP_PERMISSIONS.PRESTAMOS_AUDIT_VIEW,
    APP_PERMISSIONS.PRESTAMOS_INVENTORY_ADMIN,
    APP_PERMISSIONS.PRESTAMOS_EQUIPMENT_ADMIN,
    APP_PERMISSIONS.PRESTAMOS_PRACTICES_MANAGE,
    APP_PERMISSIONS.PRESTAMOS_ROOMS_MANAGE,
    APP_PERMISSIONS.PRESTAMOS_PRACTICES_CONFIG,
    APP_PERMISSIONS.PRESTAMOS_COORDINATOR_SIGNATURE,
    APP_PERMISSIONS.USERS_MONITOR_MANAGE,
    APP_PERMISSIONS.USERS_MONITOR_VIEW,
  ],
  laboratorista: [
    APP_PERMISSIONS.PRESTAMOS_VIEW_MANAGEMENT,
    APP_PERMISSIONS.PRESTAMOS_REQUEST_APPROVE,
    APP_PERMISSIONS.PRESTAMOS_REQUEST_REJECT,
    APP_PERMISSIONS.PRESTAMOS_REQUEST_ASSIGN_LAST_MINUTE,
    APP_PERMISSIONS.PRESTAMOS_DELIVER,
    APP_PERMISSIONS.PRESTAMOS_RECEIVE,
    APP_PERMISSIONS.PRESTAMOS_INCIDENT_VIEW,
    APP_PERMISSIONS.PRESTAMOS_INCIDENT_CREATE,
    APP_PERMISSIONS.PRESTAMOS_INCIDENT_REQUEST_CLOSE,
    APP_PERMISSIONS.PRESTAMOS_REPORTS_VIEW,
    APP_PERMISSIONS.PRESTAMOS_AUDIT_VIEW,
    APP_PERMISSIONS.PRESTAMOS_INVENTORY_ADMIN,
    APP_PERMISSIONS.PRESTAMOS_EQUIPMENT_ADMIN,
    APP_PERMISSIONS.PRESTAMOS_PRACTICES_MANAGE,
    APP_PERMISSIONS.PRESTAMOS_ROOMS_MANAGE,
    APP_PERMISSIONS.PRESTAMOS_PRACTICES_CONFIG,
  ],
  monitor: [
    APP_PERMISSIONS.PRESTAMOS_VIEW_MANAGEMENT,
    APP_PERMISSIONS.PRESTAMOS_DELIVER,
    APP_PERMISSIONS.PRESTAMOS_RECEIVE,
    APP_PERMISSIONS.PRESTAMOS_INCIDENT_VIEW,
    APP_PERMISSIONS.PRESTAMOS_INCIDENT_CREATE,
    APP_PERMISSIONS.PRESTAMOS_REPORTS_VIEW,
  ],
});

function getPermissionsForRoles(roles) {
  const normalizedRoles = normalizeRoles(roles);
  const permissions = new Set();

  normalizedRoles.forEach((role) => {
    (ROLE_PERMISSION_MAP[role] || []).forEach((permission) => permissions.add(permission));
  });

  return Array.from(permissions).sort();
}

function hasPermission(roles, permission) {
  if (!permission) return false;
  return getPermissionsForRoles(roles).includes(permission);
}

function hasAnyPermission(roles, permissions) {
  const required = Array.isArray(permissions) ? permissions : [permissions];
  return required.some((permission) => hasPermission(roles, permission));
}

function hasAllPermissions(roles, permissions) {
  const required = Array.isArray(permissions) ? permissions : [permissions];
  return required.every((permission) => hasPermission(roles, permission));
}

module.exports = {
  ALL_PERMISSIONS,
  APP_PERMISSIONS,
  getPermissionsForRoles,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
};
