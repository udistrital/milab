const express = require('express');
const { logger, sanitizeValue } = require('../../libs/logger');
const { checkServiceStatus } = require('../../libs/service-status');

const router = express.Router();
const serviceStatusLogger = logger.child({ component: 'service-status' });

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
router.use('/register_monitor', require('./register_monitor'));
router.use('/estudiantes_registrados', require('./estudiantes_registrados'));
router.use('/laboratoristas_registrados', require('./laboratoristas_registrados'));
router.use('/monitores_registrados', require('./monitores_registrados'));
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
router.use('/admin/roles', require('./admin/roles'));

// Módulo Capacitación y Certificación EDX
router.use('/certificacion-edx', require('./certificacion-edx'));
router.use('/capacitacion-cursos', require('./capacitacion-cursos'));
router.use('/capacitacion-equipos', require('./capacitacion-equipos'));
router.use('/capacitacion-gestion', require('./capacitacion-gestion'));

router.get('/check-services', async (req, res) => {
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
