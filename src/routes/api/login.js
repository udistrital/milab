const express = require('express');

const { body } = require('express-validator');
const limiter = require('../middlewares/limiter');

// Variables de entorno
require('dotenv').config();

const router = express.Router();

//const limiter = require('../middlewares/limiter'); // Ajusta la ruta según tu estructura de carpetas

router.post(
  '/login',
  limiter,
  [
    body('documento')
      .isString()
      .notEmpty()
      .escape()
      .withMessage('Por favor ingresa un documento válido'),
    body('password').isString().notEmpty().escape(),
  ],
  async (req, res) => {
    return res.redirect('/auth/microsoft');
    /*
    const documento = typeof req.body.documento === 'string' ? req.body.documento.trim() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (req.session.user) {
      return res.render('home/message_error', {
        message: '¡Algo ha salido mal!',
        message2: 'Inténtalo nuevamente',
        limit: 'noSession',
      });
    }

    const recaptchaToken = req.body['g-recaptcha-response'];
    const recaptchaData = await verifyRecaptchaToken({
      secretKey,
      token: recaptchaToken,
    });
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      return res.render('home/login_2', {
        error: 'Datos de entrada no válidos',
        confirmacion: null,
      });
    }

    if (!recaptchaData.success) {
      return res.render('home/login_2', {
        error: 'Error en el reCAPTCHA. Por favor, inténtalo de nuevo.',
        confirmacion: null,
      });
    }

    try {
      const items = await login(documento);
      const auth = items.rows[0];

      if (!auth) {
        return res.render('home/login_2', {
          error: 'El usuario y/o la contraseña son incorrectos',
          confirmacion: null,
        });
      }

      const passwordMatches = await bcrypt.compare(password, auth.password);

      if (documento === auth.documento && passwordMatches) {
        req.session.user = auth;

        return res.redirect(getPostLoginRedirect(auth));
      }

      req.session.destroy((err) => {
        if (err) {
          console.error('Error al destruir la sesión:', err);
          res.status(500).send('Error al cerrar sesión');
        }
      });

      return res.render('home/login_2', {
        error: 'El usuario y/o la contraseña son incorrectos',
        confirmacion: null,
      });
    } catch (err) {
      req.session.destroy((destroyError) => {
        if (destroyError) {
          console.error('Error al destruir la sesión:', destroyError);
          res.status(500).send('Error al cerrar sesión');
        }
      });

      console.error('Error en la consulta SQL:', err);

      return res.render('home/login_2', {
        error: 'El usuario y/o la contraseña son incorrectos',
        confirmacion: null,
      });
    }
    */
  }
);

module.exports = router;
