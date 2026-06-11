const express = require('express');
// Variables de entorno
require('dotenv').config();

const router = express.Router();

router.get('/logout', (req, res) => {
  // Destruir la sesión
  req.session.destroy((err) => {
    if (err) {
      console.error('Error al destruir la sesión:', err);
      res.status(500).send('Error al cerrar sesión');
    } else {
      res.clearCookie('connect.sid');
      res.redirect('/milab/');
    }
  });
});
module.exports = router;
