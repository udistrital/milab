'use strict';

/**
 * Ruta de autenticación de desarrollo.
 * SOLO activa cuando NODE_ENV es dev | development | local.
 * Nunca se registra en producción ni en test.
 */

const { Router } = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { fetchUserByEmail, buildSessionUser } = require('../../libs/user-identity');

const DEV_ENVS = new Set(['dev', 'development', 'local']);
const isDevEnvironment = DEV_ENVS.has((process.env.NODE_ENV || '').toLowerCase());
const isDevLoginEnabled = ['1', 'true', 'yes'].includes(
  (process.env.ENABLE_DEV_LOGIN || '').toLowerCase()
);
const defaultAllowedDevLoginIps = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
const allowedDevLoginIps = (process.env.DEV_LOGIN_ALLOWED_IPS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const effectiveAllowedDevLoginIps =
  allowedDevLoginIps.length > 0 ? allowedDevLoginIps : defaultAllowedDevLoginIps;

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

  function normalizeIp(ip) {
    if (!ip) return '';
    if (ip.startsWith('::ffff:')) return ip.slice(7);
    return ip;
  }

  function isIpAllowedForDevLogin(ip) {
    const normalizedIp = normalizeIp(String(ip || '').trim());
    if (!normalizedIp) return false;

    return effectiveAllowedDevLoginIps.some((allowedIp) => {
      const normalizedAllowedIp = normalizeIp(allowedIp);
      return normalizedIp === normalizedAllowedIp;
    });
  }

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
    const adminPasswordHash = process.env.ADMINDEV_HASH;
    const headerSecret = process.env.DEV_LOGIN_HEADER_SECRET;

    if (!adminPasswordHash) {
      return res.status(503).send('[DEV] ADMINDEV_HASH no está configurado en .env');
    }

    if (!headerSecret) {
      return res.status(503).send('[DEV] DEV_LOGIN_HEADER_SECRET no está configurado en .env');
    }

    if (!isIpAllowedForDevLogin(req.ip)) {
      return res.status(403).render('home/login_2', {
        error: '[DEV] Acceso denegado para esta IP',
        confirmacion: null,
      });
    }

    const correo = (req.body.correo || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const submittedHeaderSecret = String(req.headers?.['x-dev-login-secret'] || '');

    if (!correo || !password) {
      return renderLoginError(res, '[DEV] Correo y contraseña son requeridos');
    }

    if (!timingSafeStringEqual(submittedHeaderSecret, headerSecret)) {
      return renderLoginError(res, '[DEV] Secreto técnico de cabecera inválido');
    }

    const passwordMatches = await bcrypt.compare(password, adminPasswordHash);
    if (!passwordMatches) {
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

    // Regenerar sesión para evitar session fixation
    await new Promise((resolve, reject) =>
      req.session.regenerate((err) => (err ? reject(err) : resolve()))
    );

    req.session.user = buildSessionUser(usuario);

    return res.redirect('/milab/inicio');
  });

  module.exports = router;
}
