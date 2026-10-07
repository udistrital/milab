function normalizeErrorStatus(error) {
  const candidate = error?.status || error?.statusCode;

  if (Number.isInteger(candidate) && candidate >= 400 && candidate < 600) {
    return candidate;
  }

  return 500;
}

const SUPPORT_EMAIL = 'milab@udistrital.edu.co';

function buildDefaultUserError() {
  return {
    message: 'No pudimos completar tu solicitud',
    message2: `Por favor inténtalo de nuevo. Si el problema persiste, contáctanos en ${SUPPORT_EMAIL}.`,
  };
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

  const lines = [
    `Tipo: ${error.name || 'Error'}`,
    `Mensaje: ${error.message || 'Sin detalle disponible.'}`,
  ];

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
    lines.splice(lines.length, 0, 'Stack (resumen):', stack.join('\n'));
  }

  return lines.join('\n');
}

function buildFallbackAdminErrorDetail(req, payload = {}, status = 500) {
  const lines = [
    'Tipo: Error de aplicación (sin objeto Error adjunto)',
    `Mensaje UI: ${payload.message || 'No definido'}`,
    `Detalle UI: ${payload.message2 || 'No definido'}`,
  ];

  if (Number.isInteger(status)) {
    lines.push(`Estado HTTP: ${status}`);
  }

  if (req?.method && req?.originalUrl) {
    lines.push(`Solicitud: ${req.method} ${req.originalUrl}`);
  }

  lines.push(
    'Sugerencia: captura la excepción en el catch y envíala en payload.error o usa renderApplicationError(..., error).'
  );

  return lines.join('\n');
}

function enrichErrorPayloadForAdmin(req, payload = {}, explicitError = null) {
  const safePayload = payload && typeof payload === 'object' ? { ...payload } : {};
  const statusCode = Number.isInteger(safePayload.status) ? safePayload.status : 500;

  if (safePayload.adminErrorDetail || !req || !isAdminUser(req.session?.user)) {
    delete safePayload.error;
    return safePayload;
  }

  const errorToRender = explicitError || safePayload.error || null;
  safePayload.adminErrorDetail = errorToRender
    ? buildAdminErrorDetail(errorToRender, req, statusCode)
    : buildFallbackAdminErrorDetail(req, safePayload, statusCode);

  delete safePayload.error;
  return safePayload;
}

function wantsJson(req) {
  if (req.xhr) {
    return true;
  }

  const acceptedType = req.accepts?.(['html', 'json']);
  return acceptedType === 'json';
}

function renderApplicationError(res, overrides = {}, req = null, error = null) {
  const defaultUserError = buildDefaultUserError();
  const payload = {
    message: defaultUserError.message,
    message2: defaultUserError.message2,
    limit: null,
    ...overrides,
  };

  const errorToRender = error || payload.error || null;

  const statusCode = Number.isInteger(payload.status) ? payload.status : 500;
  const normalizedPayload = enrichErrorPayloadForAdmin(req, payload, errorToRender);
  delete normalizedPayload.status;

  return res.status(statusCode).render('home/message_error', normalizedPayload);
}

function renderModuleError(req, res, overrides = {}, error = null) {
  const payload = enrichErrorPayloadForAdmin(req, {
    limit: null,
    ...overrides,
    error: error || overrides.error || null,
  });

  const statusCode = Number.isInteger(payload.status) ? payload.status : null;
  delete payload.status;

  if (statusCode) {
    return res.status(statusCode).render('home/message_error', payload);
  }

  return res.render('home/message_error', payload);
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
      const defaultUserError = buildDefaultUserError();
      return res.status(status).json({
        ok: false,
        message: defaultUserError.message,
        message2: defaultUserError.message2,
      });
    }

    return renderApplicationError(res, { status }, req, error);
  };
}

module.exports = {
  createApplicationErrorHandler,
  enrichErrorPayloadForAdmin,
  normalizeErrorStatus,
  renderApplicationError,
  renderModuleError,
  wantsJson,
};
