function normalizeErrorStatus(error) {
  const candidate = error?.status || error?.statusCode;

  if (Number.isInteger(candidate) && candidate >= 400 && candidate < 600) {
    return candidate;
  }

  return 500;
}

function getUserRoles(user) {
  if (!user) {
    return [];
  }

  if (Array.isArray(user.roles) && user.roles.length > 0) {
    return user.roles.map((role) => String(role).toLowerCase());
  }

  if (user.tipo) {
    return [String(user.tipo).toLowerCase()];
  }

  return [];
}

function isAdminUser(user) {
  const roles = getUserRoles(user);
  return roles.includes('admin');
}

function buildAdminErrorDetail(error, req, status) {
  if (!error) {
    return null;
  }

  const lines = [];
  lines.push(`Tipo: ${error.name || 'Error'}`);
  lines.push(`Mensaje: ${error.message || 'Sin detalle disponible.'}`);

  if (error.code) {
    lines.push(`Codigo: ${error.code}`);
  }

  if (Number.isInteger(status)) {
    lines.push(`Estado HTTP: ${status}`);
  }

  if (req?.method && req?.originalUrl) {
    lines.push(`Solicitud: ${req.method} ${req.originalUrl}`);
  }

  const stack = typeof error.stack === 'string' ? error.stack.split('\n').slice(0, 8) : [];

  if (stack.length > 0) {
    lines.push('Stack (resumen):');
    lines.push(stack.join('\n'));
  }

  return lines.join('\n');
}

function wantsJson(req) {
  if (req.xhr) {
    return true;
  }

  const acceptedType = req.accepts?.(['html', 'json']);
  return acceptedType === 'json';
}

function renderApplicationError(res, overrides = {}, req = null, error = null) {
  const payload = {
    message: '¡Algo ha salido mal!',
    message2: 'No fue posible procesar la solicitud. Inténtalo nuevamente en unos minutos.',
    limit: null,
    ...overrides,
  };

  const errorToRender = error || payload.error || null;
  delete payload.error;

  const statusCode = Number.isInteger(payload.status) ? payload.status : 500;
  delete payload.status;

  if (!payload.adminErrorDetail && req && isAdminUser(req.session?.user) && errorToRender) {
    payload.adminErrorDetail = buildAdminErrorDetail(errorToRender, req, statusCode);
  }

  return res.status(statusCode).render('home/message_error', payload);
}

function createApplicationErrorHandler(logger = console) {
  return function applicationErrorHandler(error, req, res, next) {
    const status = normalizeErrorStatus(error);

    logger.error(
      {
        err: error,
        status,
        method: req.method,
        path: req.originalUrl,
      },
      'Unhandled request error'
    );

    if (res.headersSent) {
      return next(error);
    }

    if (wantsJson(req)) {
      return res.status(status).json({
        ok: false,
        message: '¡Algo ha salido mal!',
        message2: 'No fue posible procesar la solicitud. Inténtalo nuevamente en unos minutos.',
      });
    }

    return renderApplicationError(res, { status }, req, error);
  };
}

module.exports = {
  createApplicationErrorHandler,
  normalizeErrorStatus,
  renderApplicationError,
  wantsJson,
};
