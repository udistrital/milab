function normalizeErrorStatus(error) {
  const candidate = error?.status || error?.statusCode;

  if (Number.isInteger(candidate) && candidate >= 400 && candidate < 600) {
    return candidate;
  }

  return 500;
}

function wantsJson(req) {
  if (req.xhr) {
    return true;
  }

  const acceptedType = req.accepts?.(['html', 'json']);
  return acceptedType === 'json';
}

function renderApplicationError(res, overrides = {}) {
  const payload = {
    message: '¡Algo ha salido mal!',
    message2: 'No fue posible procesar la solicitud. Inténtalo nuevamente en unos minutos.',
    limit: null,
    ...overrides,
  };

  const statusCode = Number.isInteger(payload.status) ? payload.status : 500;
  delete payload.status;

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

    return renderApplicationError(res, { status });
  };
}

module.exports = {
  createApplicationErrorHandler,
  normalizeErrorStatus,
  renderApplicationError,
  wantsJson,
};
