'use strict';

/**
 * Ruta de autenticación de desarrollo.
 * SOLO activa cuando NODE_ENV es dev | development | local.
 * Nunca se registra en producción ni en test.
 */

const { Router } = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { fetchUserByEmail, buildSessionUser } = require('../../libs/user-identity');

const isDevEnvironment = (process.env.NODE_ENV || '').toLowerCase() === 'dev';
const isDevLoginEnabled = ['1', 'true', 'yes'].includes(
  (process.env.ENABLE_DEV_LOGIN || '').toLowerCase()
);

const router = Router();

if (!isDevEnvironment || !isDevLoginEnabled) {
  // En cualquier ambiente que no sea desarrollo, el router queda vacío.
  module.exports = router;
} else {
  const devLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) =>
      res.status(429).render('home/login_2', {
        error: '[DEV] Demasiados intentos de autenticación. Inténtalo más tarde.',
        confirmacion: null,
      }),
  });

  /**
   * Comparación en tiempo constante para evitar timing attacks.
   * Si las longitudes difieren retorna false SIN revelar cuál es más larga.
   */
  function timingSafeStringEqual(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    // Ejecutar siempre una comparación para no filtrar info por tiempo
    const len = Math.max(bufA.length, bufB.length);
    const paddedA = Buffer.concat([bufA, Buffer.alloc(Math.max(0, len - bufA.length))]);
    const paddedB = Buffer.concat([bufB, Buffer.alloc(Math.max(0, len - bufB.length))]);
    const equal = crypto.timingSafeEqual(paddedA, paddedB);
    return equal && bufA.length === bufB.length;
  }

  function renderLoginError(res, error) {
    return res.render('home/login_2', { error, confirmacion: null });
  }

  router.post('/dev-login', devLoginLimiter, async (req, res) => {
    const legacyAdminPassword = String(process.env.ADMINDEV || '');

    if (!legacyAdminPassword.trim()) {
      return res.status(503).render('home/login_2', {
        error: '[DEV] ADMINDEV no está configurado en .env',
        confirmacion: null,
      });
    }

    const correo = (req.body.correo || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!correo || !password) {
      return renderLoginError(res, '[DEV] Correo y contraseña son requeridos');
    }

    if (!timingSafeStringEqual(password, legacyAdminPassword)) {
      return renderLoginError(res, '[DEV] Contraseña de desarrollo incorrecta');
    }

    let usuario;
    try {
      usuario = await fetchUserByEmail(correo);
    } catch {
      return renderLoginError(res, '[DEV] Error al consultar la base de datos');
    }

    if (!usuario) {
      return renderLoginError(
        res,
        '[DEV] No existe un usuario con ese correo en la base de datos local'
      );
    }

    const roles = Array.isArray(usuario.roles)
      ? usuario.roles
          .map((role) =>
            String(role || '')
              .trim()
              .toLowerCase()
          )
          .filter(Boolean)
      : [];
    if (!roles.includes('admin')) {
      return renderLoginError(
        res,
        '[DEV] El correo indicado no corresponde a un usuario admin en la base de datos'
      );
    }

    // Regenerar sesión para evitar session fixation
    await new Promise((resolve, reject) =>
      req.session.regenerate((err) => (err ? reject(err) : resolve()))
    );

    req.session.user = buildSessionUser(usuario);

    return res.redirect('/milab/inicio');
  });

  module.exports = router;
}
