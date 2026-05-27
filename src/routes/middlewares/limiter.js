const rateLimit = require('express-rate-limit');
const ipBlockList = new Set();

const ipBlockMiddleware = (req, res, next) => {
  if (ipBlockList.has(req.ip)) {
    res.set('X-IP-BLOCKED', 'true');
    return res.status(429).render('home/message_error', {
      message: 'Demasiadas solicitudes',
      message2: 'Por favor, espera un momento antes de intentarlo de nuevo.',
      limit: null,
    });
  }
  next();
};

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 4,
  handler: (req, res, next) => {
    const ip = req.ip;

    console.log(`Remaining Requests: ${req.rateLimit.remaining}`);
    console.log(`IP Block List: ${[...ipBlockList]}`);

    if (req.rateLimit.remaining === 0) {
      ipBlockList.add(ip);
      console.log(`Blocking IP: ${ip}`);

      res.set('X-IP-BLOCKED', 'true');
      let errorTemplate = 'partials/error';
      const templateData = {
        error: 'Demasiadas solicitudes. Por favor, espera un momento antes de intentarlo de nuevo.',
        confirmacion: null,
        message: 'Demasiadas solicitudes',
        message2: 'Por favor, espera un momento antes de intentarlo de nuevo.',
        limit: null,
      };

      if (req.originalUrl.includes('/auth/recaptcha-login')) {
        errorTemplate = 'home/index_2';
        templateData.recaptchaError = templateData.error;
      } else if (req.originalUrl.includes('/auth/login')) {
        errorTemplate = 'home/login_2';
      } else if (req.originalUrl.includes('/api/get-data1')) {
        errorTemplate = 'home/register_2';
        templateData.selectedType = 'estudiante';
      }
      return res.render(errorTemplate, templateData);
    } else {
      console.log(`Allowing Request from IP: ${ip}`);
      next();
    }
  },
});

module.exports = limiter;
module.exports.ipBlockMiddleware = ipBlockMiddleware;
