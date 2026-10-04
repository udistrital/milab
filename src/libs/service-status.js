const { logger, sanitizeValue } = require('./logger');
const { getAcademicServicePath, requestOati } = require('./oati-client');
const {
  healthCheck: edxHealthCheck,
  BASE_URL: edxBaseUrl,
  USE_MOCK: edxUseMock,
} = require('./edx-cert-client');
const { NON_PRODUCTION_ENVIRONMENTS } = require('../config/sga-services');

const serviceStatusLogger = logger.child({ component: 'service-status' });

// En producción edX no se valida: no tiene servicio desplegado y marcaría el portal como interrumpido.
function shouldCheckEdx(environmentName = process.env.NODE_ENV) {
  const normalizedEnvironment = String(environmentName || '')
    .trim()
    .toLowerCase();
  return NON_PRODUCTION_ENVIRONMENTS.includes(normalizedEnvironment);
}

async function checkServiceStatus(log = serviceStatusLogger, { checkEdx = shouldCheckEdx() } = {}) {
  const services = [
    {
      name: 'datos_basicos_activos_cedula',
      path: getAcademicServicePath('datos_basicos_activos_cedula/1023968369'),
    },
    {
      name: 'consultar_estado_docente',
      path: getAcademicServicePath('consultar_estado_docente/1023968369'),
    },
  ];

  if (checkEdx) {
    services.push({
      name: `edx_certificacion_${edxUseMock ? 'MOCK' : 'REAL'}`,
      _edxCheck: true,
      path: `${edxBaseUrl}/health`,
    });
  }

  try {
    const promises = services.map(async (service) => {
      try {
        if (service._edxCheck) {
          const ok = await edxHealthCheck();
          return {
            service: service.name,
            status: ok ? 200 : 'UNREACHABLE',
            available: ok,
            endpoint: service.path,
          };
        }
        await requestOati(service.path);
        return { service: service.name, status: 200, available: true };
      } catch (error) {
        if (error.response && (error.response.status === 404 || error.response.status === 405)) {
          return {
            service: service.name,
            status: error.response.status,
            available: true,
            note: 'Service responds but endpoint may not exist',
          };
        }
        return {
          service: service.name,
          status: error.response?.status || 'ERROR',
          available: false,
          error: error.message,
        };
      }
    });

    const results = await Promise.all(promises);
    const allAvailable = results.every((result) => result.available);

    if (!allAvailable) {
      log.warn(
        {
          event: 'external_services_degraded',
          services: results,
        },
        'Service availability check reported degraded status'
      );
    }

    return {
      servicesAreUp: allAvailable,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    log.error(
      {
        event: 'external_services_check_error',
        err: sanitizeValue(error),
      },
      'Service availability check failed unexpectedly'
    );
    return {
      servicesAreUp: false,
      timestamp: new Date().toISOString(),
    };
  }
}

module.exports = {
  checkServiceStatus,
  shouldCheckEdx,
};
