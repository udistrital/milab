const express = require('express');
var router = express.Router();

const QRCode = require('qrcode');
const { requireUser } = require('../middlewares/auth');
const { buildGeneratePath } = require('../../libs/generate-path');

const requireQrGenerationSession = requireUser({
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

router.post('/', requireQrGenerationSession, function (req, res) {
  const uniqueId = generateUniqueId(); // Esta función genera un ID único

  QRCode.toFile(
    buildGeneratePath(`con_name${uniqueId}.png`),
    uniqueId,
    {
      errorCorrectionLevel: 'H',
    },
    function (err) {
      if (err) throw err;
      console.log('QR unico generado!');
    }
  );

  return res.render('home/message_success', {
    message: 'QR generado correctamente',
    message2: 'El codigo se almaceno en el servidor.',
  });
});

function generateUniqueId() {
  // Esta función debe generar un ID único para cada código QR
  const { v4: uuidv4 } = require('uuid');
  return uuidv4();
}

module.exports = router;
