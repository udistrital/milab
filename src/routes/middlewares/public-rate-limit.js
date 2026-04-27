const rateLimit = require('express-rate-limit');

const publicApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Demasiadas solicitudes. Inténtalo nuevamente en un momento.',
    });
  },
});

const publicPageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).render('home/message_error', {
      message: 'Demasiadas solicitudes',
      message2: 'Inténtalo nuevamente en un momento.',
      limit: 'noSession',
    });
  },
});

module.exports = {
  publicApiLimiter,
  publicPageLimiter,
};
