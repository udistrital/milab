const ROLE_PRIORITY = ['admin', 'coordinador', 'laboratorista', 'docente', 'estudiante'];

const ROLE_LABELS = {
  admin: 'Admin',
  coordinador: 'Coordinador',
  laboratorista: 'Laboratorista',
  estudiante: 'Estudiante',
  docente: 'Docente',
};

function normalizeRoles(roles) {
  const list = Array.isArray(roles) ? roles : roles ? [roles] : [];
  const normalized = list
    .map((role) => (role || '').toString().trim().toLowerCase())
    .filter(Boolean);

  const unique = Array.from(new Set(normalized));
  return unique.sort((a, b) => {
    const indexA = ROLE_PRIORITY.indexOf(a);
    const indexB = ROLE_PRIORITY.indexOf(b);

    if (indexA === -1 && indexB === -1) return a.localeCompare(b);
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });
}

function getPrimaryRole(roles) {
  const normalized = normalizeRoles(roles);
  return normalized[0] || '';
}

function formatRoleLabel(roles) {
  const normalized = normalizeRoles(roles);
  if (!normalized.length) return 'Invitado';

  return normalized.map((role) => ROLE_LABELS[role] || role).join(' · ');
}

function hasAnyRole(userRoles, requiredRoles) {
  const normalizedUser = normalizeRoles(userRoles);
  const normalizedRequired = normalizeRoles(requiredRoles);

  return normalizedRequired.some((role) => normalizedUser.includes(role));
}

module.exports = {
  ROLE_LABELS,
  ROLE_PRIORITY,
  formatRoleLabel,
  getPrimaryRole,
  hasAnyRole,
  normalizeRoles,
};
