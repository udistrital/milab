const express = require('express');
const pool = require('../../libs/db');
const { requireRoles } = require('../middlewares/auth');
const { buildGeneratePath } = require('../../libs/generate-path');
const { renderApplicationError, wantsJson } = require('../middlewares/error-handler');

var router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: false }));

const requireStudentPdfDownloadAccess = requireRoles(
  ['admin', 'estudiante', 'laboratorista', 'coordinador'],
  {
    message: '¡Algo ha salido mal!',
    message2: 'Inténtalo nuevamente',
    limit: 'noSession',
  }
);

//const con_codigo_print = require("./get-data");

router.post('/', requireStudentPdfDownloadAccess, async (req, res) => {
  const requestBody = req.body || {};
  //const pdfPath = path.join('src/public/generate', 'certificado_20171700006-bef6340f-f419-49c2-91e3-c7e863492396.pdf'); // Ruta completa del archivo PDF en el servidor

  const certificadoId = requestBody.con_codigo; // Este valor debería ser dinámico según tus necesidades
  if (!/^\d{1,20}$/.test(String(certificadoId || ''))) {
    if (wantsJson(req)) {
      return res.status(400).json({
        ok: false,
        message: 'Código de certificado inválido.',
      });
    }

    return renderApplicationError(res, {
      status: 400,
      message: 'Código de certificado inválido.',
      message2: 'Revisa el código e inténtalo nuevamente.',
      limit: null,
    });
  }

  if (req.session.user.tipo === 'estudiante') {
    const result = await pool.query('SELECT codigo FROM usuario WHERE documento = $1', [
      req.session.user.documento,
    ]);
    const expectedCode = result.rows[0]?.codigo ? String(result.rows[0].codigo) : null;
    if (!expectedCode || expectedCode !== String(certificadoId)) {
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
  }

  const pdfFileName = `certificado_${certificadoId}.pdf`;

  const pdfPath = buildGeneratePath(pdfFileName);

  console.log(pdfPath);
  res.download(pdfPath, 'Certificado_PazySalvo.pdf', (err) => {
    if (err) {
      // Manejo del error en caso de que ocurra durante la descarga
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
