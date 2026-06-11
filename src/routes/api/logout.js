const express = require('express');
// Variables de entorno
require('dotenv').config();
const { renderApplicationError, wantsJson } = require('../middlewares/error-handler');

const router = express.Router();

router.get('/logout', (req, res) => {
  // Destruir la sesión
  req.session.destroy((err) => {
    if (err) {
      console.error('Error al destruir la sesión:', err);

      if (wantsJson(req)) {
        return res.status(500).json({
          ok: false,
          message: 'No fue posible cerrar la sesión.',
          message2: 'Intenta nuevamente en unos minutos.',
        });
      }

      return renderApplicationError(res, {
        status: 500,
        message: 'No fue posible cerrar la sesión.',
        message2: 'Intenta nuevamente en unos minutos.',
        limit: null,
      });
    } else {
      res.clearCookie('connect.sid');
      res.redirect('/milab/');
    }
  });
});
module.exports = router;
