const express = require('express');
const { requireRoles } = require('../middlewares/auth');
const { buildGeneratePath } = require('../../libs/generate-path');

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
    return res.status(400).send('Documento inválido.');
  }

  if (
    req.session.user.tipo === 'docente' &&
    String(req.session.user.documento) !== String(documentoId)
  ) {
    return res.status(403).send('No tienes permisos para descargar este certificado.');
  }

  const pdfFileName = `certificado_${documentoId}.pdf`;

  const pdfPath = buildGeneratePath(pdfFileName);

  console.log(`Attempting to download file from path: ${pdfPath}`);
  res.download(pdfPath, 'Certificado_PazySalvo.pdf', (err) => {
    if (err) {
      console.log('Error al descargar el archivo:', err);
      res
        .status(500)
        .send('Error al descargar el archivo. Por favor, inténtalo de nuevo más tarde.');
    }
  });
});

module.exports = router;
