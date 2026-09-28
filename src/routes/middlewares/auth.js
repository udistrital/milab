const { hasAllPermissions, hasAnyPermission } = require('../../libs/permissions');

const SUPPORT_EMAIL = 'milab@udistrital.edu.co';

function normalizeGenericAuthErrorPayload(payload) {
  const normalized = { ...payload };

  if (
    normalized.message === '¡Algo ha salido mal!' ||
    normalized.message === 'Algo ha salido mal'
  ) {
    normalized.message = 'No pudimos completar tu solicitud';
  }

  if (
    normalized.message2 === 'Inténtalo nuevamente' ||
    normalized.message2 === 'Intentalo nuevamente'
  ) {
    normalized.message2 = `Por favor inténtalo de nuevo. Si el problema persiste, contáctanos en ${SUPPORT_EMAIL}.`;
  }

  return normalized;
}

function renderAuthError(res, overrides = {}) {
  const payload = normalizeGenericAuthErrorPayload({
    message: '¡Algo ha salido mal!',
    message2: 'Inténtalo nuevamente',
    limit: 'noSession',
    ...overrides,
  });

  return res.render('home/message_error', payload);
}

function requireUser(overrides = {}) {
  return function requireAuthenticatedUser(req, res, next) {
    if (!req.session?.user) {
      return renderAuthError(res, overrides);
    }

    return next();
  };
}

function getUserRoles(user) {
  if (!user) return [];
  try {
    if (Array.isArray(user.roles) && user.roles.length) {
      return user.roles.filter((r) => r !== null && r !== undefined);
    }
    if (user.roles && typeof user.roles === 'string') {
      return user.roles
        .split(',')
        .map((r) => String(r || '').trim())
        .filter(Boolean);
    }
  } catch (err) {
    console.warn('[getUserRoles] roles corruptos, usando fallback:', err && err.message);
  }

  if (user.tipo) {
    return [String(user.tipo)];
  }
  if (user.role) {
    return [String(user.role)];
  }

  return [];
}

function normalizeRoleListForMatch(roles) {
  try {
    let list = [];
    if (Array.isArray(roles)) {
      list = roles;
    } else if (typeof roles === 'string') {
      list = roles
        .split(',')
        .map((r) => String(r || '').trim())
        .filter(Boolean);
    } else if (roles != null) {
      list = [String(roles)];
    }
    const normalized = new Set();
    for (const raw of list) {
      const r = String(raw || '').trim();
      if (!r) continue;
      const lower = r.toLowerCase();
      normalized.add(lower);
      if (lower === 'coordinador_general') normalized.add('coordinador general');
      if (lower === 'coordinador general') normalized.add('coordinador_general');
      if (lower === 'coordinador') {
        normalized.add('coordinador_facultad');
        normalized.add('coordinador de facultad');
      }
      if (lower === 'coordinador_facultad' || lower === 'coordinador de facultad')
        normalized.add('coordinador');
      if (lower === 'administrador' || lower === 'administradora') normalized.add('admin');
      if (lower === 'admin') {
        normalized.add('administrador');
        normalized.add('administradora');
      }
      if (
        lower === 'laboratorista_ud' ||
        lower === 'laboratorista ud' ||
        lower === 'laboratoristaud' ||
        lower === 'laboratorista_ual'
      ) {
        normalized.add('laboratorista');
      }
      if (lower === 'laboratorista') normalized.add('laboratorista_ud');
      if (lower === 'estudiante') normalized.add('alumno');
      if (lower === 'alumno') normalized.add('estudiante');
      if (lower === 'docente') normalized.add('profesor');
      if (lower === 'profesor') normalized.add('docente');
    }
    return Array.from(normalized);
  } catch (err) {
    console.warn('[normalizeRoleListForMatch] error normalizando roles:', err && err.message);
    return [];
  }
}

function isAdminOnlyRoleSet(roles) {
  try {
    const rawList = Array.isArray(roles) ? roles : [roles];
    const normalized = normalizeRoleListForMatch(roles);
    return rawList.length === 1 && normalized.includes('admin');
  } catch (err) {
    console.warn('[isAdminOnlyRoleSet] error:', err && err.message);
    return false;
  }
}

function hasCoordinadorGeneralRole(userRoles) {
  try {
    const normalized = normalizeRoleListForMatch(userRoles);
    return normalized.includes('coordinador_general');
  } catch (err) {
    console.warn('[hasCoordinadorGeneralRole] error:', err && err.message);
    return false;
  }
}

function hasAllowedRole(userRoles, allowedRoles) {
  try {
    const userNorm = normalizeRoleListForMatch(userRoles);
    const allowedNorm = normalizeRoleListForMatch(allowedRoles);
    return allowedNorm.some((role) => userNorm.includes(role));
  } catch (err) {
    console.warn('[hasAllowedRole] error:', err && err.message);
    return false;
  }
}

function isReadOnlyRequestMethod(method) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  return (
    normalizedMethod === 'GET' || normalizedMethod === 'HEAD' || normalizedMethod === 'OPTIONS'
  );
}

function buildReadOnlyRoleErrorPayload(overrides = {}) {
  return {
    message: 'Acceso denegado',
    message2: 'El rol coordinador general tiene acceso de solo lectura.',
    limit: overrides.limit || 'loginOnly',
  };
}

function requireRoles(roles, overrides = {}) {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];

  return function requireAuthorizedRole(req, res, next) {
    try {
      const user = req.session?.user;

      const userRoles = getUserRoles(user);

      if (hasCoordinadorGeneralRole(userRoles) && !isReadOnlyRequestMethod(req.method)) {
        return renderAuthError(res, buildReadOnlyRoleErrorPayload(overrides));
      }

      if (user?.__impersonating && isAdminOnlyRoleSet(allowedRoles)) {
        return renderAuthError(res, {
          message: 'Acceso denegado',
          message2: 'No se permiten acciones administrativas durante una impersonación activa.',
          limit: overrides.limit || 'loginOnly',
        });
      }

      if (hasCoordinadorGeneralRole(userRoles) && isReadOnlyRequestMethod(req.method)) {
        return next();
      }

      if (!user || !hasAllowedRole(userRoles, allowedRoles)) {
        return renderAuthError(res, overrides);
      }

      return next();
    } catch (err) {
      console.error('[requireRoles] error interno autorización:', err);
      return renderAuthError(res, {
        ...overrides,
        message: overrides.message || 'Acceso denegado',
        message2: overrides.message2 || 'Ocurrió un error verificando tus permisos.',
        limit: overrides.limit || 'loginOnly',
      });
    }
  };
}

function requireJsonRoles(roles, overrides = {}) {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];
  const message = overrides.message || 'No tienes permisos para esta acción';

  return function requireAuthorizedJsonRole(req, res, next) {
    try {
      const user = req.session?.user;

      if (!user) {
        return res.status(401).json({
          ok: false,
          message,
        });
      }

      const userRoles = getUserRoles(user);

      if (hasCoordinadorGeneralRole(userRoles) && !isReadOnlyRequestMethod(req.method)) {
        return res.status(403).json({
          ok: false,
          message: 'El rol coordinador general tiene acceso de solo lectura.',
        });
      }

      if (user?.__impersonating && isAdminOnlyRoleSet(allowedRoles)) {
        return res.status(403).json({
          ok: false,
          message: 'No se permiten acciones administrativas durante una impersonación activa.',
        });
      }

      if (hasCoordinadorGeneralRole(userRoles) && isReadOnlyRequestMethod(req.method)) {
        return next();
      }

      if (!hasAllowedRole(userRoles, allowedRoles)) {
        return res.status(403).json({
          ok: false,
          message,
        });
      }

      return next();
    } catch (err) {
      console.error('[requireJsonRoles] error interno autorización JSON:', err);
      return res.status(500).json({
        ok: false,
        message: 'Ocurrió un error verificando tus permisos.',
        details: process.env.NODE_ENV === 'production' ? undefined : String(err && err.message),
      });
    }
  };
}

function requirePermissions(permissions, overrides = {}) {
  const mode = overrides.mode === 'all' ? 'all' : 'any';
  const requiredPermissions = Array.isArray(permissions) ? permissions : [permissions];

  return function requireAuthorizedPermission(req, res, next) {
    const user = req.session?.user;
    const userRoles = getUserRoles(user);

    if (!user) {
      return renderAuthError(res, {
        message: 'Acceso denegado',
        message2: overrides.message2 || 'Debe iniciar sesion para continuar.',
        limit: overrides.limit || 'loginOnly',
      });
    }

    if (hasCoordinadorGeneralRole(userRoles) && !isReadOnlyRequestMethod(req.method)) {
      return renderAuthError(res, buildReadOnlyRoleErrorPayload(overrides));
    }

    const allowed =
      mode === 'all'
        ? hasAllPermissions(userRoles, requiredPermissions)
        : hasAnyPermission(userRoles, requiredPermissions);

    if (!allowed) {
      return renderAuthError(res, {
        message: overrides.message || 'Acceso denegado',
        message2: overrides.message2 || 'No tienes permisos para esta accion.',
        limit: overrides.limit || 'loginOnly',
      });
    }

    return next();
  };
}

module.exports = {
  renderAuthError,
  requirePermissions,
  requireJsonRoles,
  requireUser,
  requireRoles,
  getUserRoles,
};
