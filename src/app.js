var express = require('express');
var passport = require('passport');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const session = require('express-session');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const rootEnvPath = path.join(process.cwd(), '.env');
const dockerEnvPath = path.join(__dirname, '../Docker/.env');
const resolvedEnvPath = fs.existsSync(rootEnvPath)
  ? rootEnvPath
  : fs.existsSync(dockerEnvPath)
    ? dockerEnvPath
    : null;

if (resolvedEnvPath) {
  dotenv.config({ path: resolvedEnvPath });
}

require('./routes/middlewares/microsoft');

const { installConsoleBridge, installProcessHandlers, logger } = require('./libs/logger');
const { requestLogger } = require('./routes/middlewares/request-logger');
const { navigationMiddleware } = require('./routes/middlewares/navigation');

installConsoleBridge();
installProcessHandlers();

var app = express();
const legacyBasePath = '/pazysalvos';
const canonicalBasePath = '/milab';

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Función para generar un secreto aleatorio
const generateRandomSecret = () => {
  return crypto.randomBytes(64).toString('hex');
};
const sessionSecret = process.env.SESSION_SECRET || generateRandomSecret();
let sessionCookieSecure = process.env.SESSION_SECURE
  ? process.env.SESSION_SECURE === 'true'
  : process.env.NODE_ENV === 'production';
let sessionSameSite = (process.env.SESSION_SAMESITE || 'lax').toLowerCase();

if (!['lax', 'strict', 'none'].includes(sessionSameSite)) {
  sessionSameSite = 'lax';
}

if (sessionSameSite === 'none') {
  sessionCookieSecure = true;
}
//Middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          'code.jquery.com',
          'cdn.jsdelivr.net',
          'stackpath.bootstrapcdn.com',
          'maxcdn.bootstrapcdn.com',
          'cdnjs.cloudflare.com',
          'www.google.com',
          'www.gstatic.com',
          'www.recaptcha.net',
          'cdn.datatables.net',
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          'cdn.jsdelivr.net',
          'stackpath.bootstrapcdn.com',
          'maxcdn.bootstrapcdn.com',
          'cdnjs.cloudflare.com',
          'fonts.googleapis.com',
          'cdn.datatables.net',
        ],
        fontSrc: [
          "'self'",
          'fonts.gstatic.com',
          'maxcdn.bootstrapcdn.com',
          'cdnjs.cloudflare.com',
          'cdn.jsdelivr.net',
        ],
        objectSrc: ["'none'"],
        frameSrc: ["'self'", 'www.google.com', 'www.recaptcha.net'],
        scriptSrcAttr: ["'unsafe-inline'"],
      }, //Especifica las fuentes legítimas de contenido que un navegador puede cargar
    },
    hsts: { maxAge: 31536000, includeSubDomains: true }, //para https
    noCache: true, //Evitar que se guarde el caché en el navegador
    xssFilter: true, //Evita ataques de inyección de scripts maliciosos
    frameguard: { action: 'sameorigin' }, //'sameorigin' //'allow-from: dominio' //Controla si una página puede cargarse en un marco o iframe
  })
);

const limiter2 = rateLimit({
  windowMs: 60 * 1000, // tiempo de espera
  max: 100, // límite de solicitudes por dirección IP
  handler: (req, res) => {
    return res.render('home/message_error', {
      message: '¡Demasiadas solicitudes desde esta dirección IP!',
      message2: '!Inténtalo de nuevo más tarde!',
      limit: true,
    });
  },
});
//app.use(limiter);
app.use(limiter2);

app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: Number(process.env.SESSION_MAX_AGE_MS || 1 * 60 * 60 * 1000),
      secure: sessionCookieSecure,
      sameSite: sessionSameSite,
      httpOnly: true,
    },
  })
);

app.use(navigationMiddleware);
app.use((req, res, next) => {
  res.locals.recaptchaSiteKey = process.env.RECAPTCHA_SITE_KEY || '';
  next();
});
app.use(requestLogger);

app.use(express.static('public'));
app.use('/css', express.static('public/css'));
app.use('/js', express.static('public/js'));

app.set('host', process.env.HOST || '0.0.0.0');
app.set('port', process.env.PORT || 3000);

app.use(passport.initialize());
app.use('/api', require('./routes/api'));
app.use('/auth', require('./routes/api/microsoft'));
app.use(legacyBasePath, (req, res, next) => {
  const legacySuffix = req.originalUrl.slice(legacyBasePath.length) || '/';

  if (req.method === 'GET' || req.method === 'HEAD') {
    return res.redirect(301, `${canonicalBasePath}${legacySuffix}`);
  }

  next();
});

app.use(canonicalBasePath, require('./milab_routes'));
app.use(legacyBasePath, require('./milab_routes'));

//app.use("/auth", loginRouter);

// Microsoft Routes
//router.get('/auth/microsoft', passport.authenticate('microsoft', { session: false }));
//router.get('/auth/microsoft/redirect', passport.authenticate('microsoft', { session: false, failureRedirect: `https://localhost:3000/login` }), (req, res) => {
//  res.redirect(req.user);
//});

if (require.main === module) {
  app.listen(app.get('port'), app.get('host'), function () {
    logger.info(
      {
        host: app.get('host'),
        port: app.get('port'),
      },
      'Server started'
    );
  });
}

module.exports = app;
