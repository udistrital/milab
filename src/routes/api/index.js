const express = require('express');
const { logger, sanitizeValue } = require('../../libs/logger');
const { getAcademicServicePath, requestOati } = require('../../libs/oati-client');
const { requireJsonRoles } = require('../middlewares/auth');

var router = express.Router();
const serviceStatusLogger = logger.child({ component: 'service-status' });
const allowPublicServiceStatusEndpoint = ['1', 'true', 'yes'].includes(
  (process.env.ALLOW_PUBLIC_SERVICE_STATUS || '').toLowerCase()
);

if ((process.env.NODE_ENV || '').toLowerCase().trim() !== 'production' && allowPublicServiceStatusEndpoint) {
  throw new Error(
    '[SECURITY] ALLOW_PUBLIC_SERVICE_STATUS no puede estar activo fuera de producción. ' +
      'Deshabilítalo para iniciar la aplicación.'
  );
}

// check-services es público para que el login pueda verificar estado sin autenticación
const requireServiceStatusAccess = (req, res, next) => next();

// Rutas existentes
router.use('/generate', require('./generateqr'));
router.use('/generatepdf', require('./generatepdf'));
router.use('/submit', require('./submit'));
router.use('/submit_docente', require('./submit_docente'));
router.use('/get-data', require('./get-data'));
router.use('/get-data-docente', require('./get-data-docente'));
router.use('/get-data1', require('./get-data1'));
router.use('/get-data2', require('./get-data2'));
router.use('/download-pdf', require('./download-pdf'));
router.use('/download-pdf-docente', require('./download-pdf-docente'));
router.use('/get_list_multas', require('./get_list_multas'));
router.use('/get_list_estudiantes', require('./get_list_estudiantes'));
router.use('/validateqr', require('./validateqr'));
router.use('/validateqr-docente', require('./validateqr-docente'));
router.use('/get-info-multa', require('./get-info-multa'));
router.use('/get-info-erase-multa', require('./get-info-erase-multa'));
router.use('/get-info-erase-multa-docente', require('./get-info-erase-multa-docente'));
router.use('/verifica_multa_docente', require('./verifica_multa_docente'));
router.use('/quitar-multa', require('./quitar-multa'));
router.use('/register', require('./register'));
router.use('/register_labs', require('./register_labs'));
router.use('/estudiantes_registrados', require('./estudiantes_registrados'));
router.use('/laboratoristas_registrados', require('./laboratoristas_registrados'));
router.use('/coordinadores_registrados', require('./coordinadores_registrados'));
router.use('/registro_coordinador', require('./registro_coordinador'));
router.use('/admins', require('./admins'));
router.use('/get-info-multa-docente', require('./get-info-multa-docente'));
router.use('/logs', require('./logs'));
router.use('/dashboard', require('./dashboard'));
router.use('/get-estado-multa', require('./get-estado-multa'));
router.use('/aprobacion_multa', require('./aprobacion_multa'));
router.use('/consulta-invit', require('./consulta-invit'));
router.use('/facultad', require('./facultad'));
router.use('/verificar_estudiante', require('./verificar_estudiante'));
router.use('/verificar_docente', require('./verificar_docente'));
router.use('/generate_cert_docente_lab', require('./generate_cert_docente_lab'));
router.use('/generate_cert_estudiante_lab', require('./generate_cert_estudiante_lab'));
router.use('/profile', require('./profile'));
router.use('/admin/menus', require('./admin/menus'));

async function checkServiceStatus(log = serviceStatusLogger) {
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

  try {
    const promises = services.map(async (service) => {
      try {
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

router.get('/check-services', requireServiceStatusAccess, async (req, res) => {
  const log = (req.log || serviceStatusLogger).child({ route: '/api/check-services' });
  try {
    const serviceStatus = await checkServiceStatus(log);
    res.json(serviceStatus);
  } catch (error) {
    log.error(
      {
        event: 'external_services_endpoint_error',
        err: sanitizeValue(error),
      },
      'check-services endpoint failed'
    );
    res.status(500).json({
      servicesAreUp: false,
      timestamp: new Date().toISOString(),
    });
  }
});

module.exports = router;
