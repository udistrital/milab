const { hasAllPermissions, hasAnyPermission } = require('../../libs/permissions');

function renderAuthError(res, overrides = {}) {
  const payload = {
    message: '¡Algo ha salido mal!',
    message2: 'Inténtalo nuevamente',
    limit: 'noSession',
    ...overrides,
  };

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
  if (Array.isArray(user.roles) && user.roles.length) {
    return user.roles;
  }

  if (user.tipo) {
    return [user.tipo];
  }

  return [];
}

function requireRoles(roles, overrides = {}) {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];

  return function requireAuthorizedRole(req, res, next) {
    const user = req.session?.user;

    const userRoles = getUserRoles(user);

    if (!user || !allowedRoles.some((role) => userRoles.includes(role))) {
      return renderAuthError(res, overrides);
    }

    return next();
  };
}

function requireJsonRoles(roles, overrides = {}) {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];
  const message = overrides.message || 'No tienes permisos para esta acción';

  return function requireAuthorizedJsonRole(req, res, next) {
    const user = req.session?.user;

    if (!user) {
      return res.status(401).json({
        ok: false,
        message,
      });
    }

    const userRoles = getUserRoles(user);

    if (!allowedRoles.some((role) => userRoles.includes(role))) {
      return res.status(403).json({
        ok: false,
        message,
      });
    }

    return next();
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
