const express = require('express');
const { requireRoles } = require('../middlewares/auth');
const { buildGeneratePath } = require('../../libs/generate-path');
const { renderApplicationError, wantsJson } = require('../middlewares/error-handler');

var router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: false }));

const requireTeacherPdfDownloadAccess = requireRoles(
  ['admin', 'docente', 'laboratorista', 'coordinador'],
  {
    message: '¡Algo ha salido mal!',
    message2: 'Inténtalo nuevamente',
    limit: 'noSession',
  }
);

router.post('/', requireTeacherPdfDownloadAccess, (req, res) => {
  const requestBody = req.body || {};
  const documentoId = requestBody.con_documento;
  if (!/^\d{1,20}$/.test(String(documentoId || ''))) {
    if (wantsJson(req)) {
      return res.status(400).json({
        ok: false,
        message: 'Documento inválido.',
      });
    }

    return renderApplicationError(res, {
      status: 400,
      message: 'Documento inválido.',
      message2: 'Revisa el documento e inténtalo nuevamente.',
      limit: null,
    });
  }

  if (
    req.session.user.tipo === 'docente' &&
    String(req.session.user.documento) !== String(documentoId)
  ) {
    if (wantsJson(req)) {
      return res.status(403).json({
        ok: false,
        message: 'No tienes permisos para descargar este certificado.',
      });
    }

    return renderApplicationError(res, {
      status: 403,
      message: 'No tienes permisos para descargar este certificado.',
      message2: 'Si crees que es un error, contacta a soporte.',
      limit: null,
    });
  }

  const pdfFileName = `certificado_${documentoId}.pdf`;

  const pdfPath = buildGeneratePath(pdfFileName);

  console.log(`Attempting to download file from path: ${pdfPath}`);
  res.download(pdfPath, 'Certificado_PazySalvo.pdf', (err) => {
    if (err) {
      console.log('Error al descargar el archivo:', err);
      if (res.headersSent) {
        return;
      }

      if (wantsJson(req)) {
        return res.status(500).json({
          ok: false,
          message: 'No fue posible descargar el archivo.',
          message2: 'Inténtalo de nuevo más tarde.',
        });
      }

      return renderApplicationError(res, {
        status: 500,
        message: 'No fue posible descargar el archivo.',
        message2: 'Inténtalo de nuevo más tarde.',
        limit: null,
      });
    }
  });
});

module.exports = router;
