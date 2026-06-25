const express = require('express');
const pool = require('../../libs/db');
const { requireRoles } = require('../middlewares/auth');
const { buildGeneratePath } = require('../../libs/generate-path');

const router = express.Router();

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

router.post('/', requireStudentPdfDownloadAccess, async (req, res) => {
  const requestBody = req.body || {};

  const certificadoId = requestBody.con_codigo; // Este valor debería ser dinámico según tus necesidades
  if (!/^\d{1,20}$/.test(String(certificadoId || ''))) {
    return res.status(400).send('Código de certificado inválido.');
  }

  if (req.session.user.tipo === 'estudiante') {
    const result = await pool.query('SELECT codigo FROM usuario WHERE documento = $1', [
      req.session.user.documento,
    ]);
    const expectedCode = result.rows[0]?.codigo ? String(result.rows[0].codigo) : null;
    if (!expectedCode || expectedCode !== String(certificadoId)) {
      return res.status(403).send('No tienes permisos para descargar este certificado.');
    }
  }

  const pdfFileName = `certificado_${certificadoId}.pdf`;

  const pdfPath = buildGeneratePath(pdfFileName);

  console.log(pdfPath);
  res.download(pdfPath, 'Certificado_PazySalvo.pdf', (err) => {
    if (err) {
      // Manejo del error en caso de que ocurra durante la descarga
      console.log('Error al descargar el archivo:', err);
      res
        .status(500)
        .send('Error al descargar el archivo. Por favor, inténtalo de nuevo más tarde.');
    }
  });
});

module.exports = router;
