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

function getOriginFromUrl(url) {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

require('./routes/middlewares/microsoft');

const { installConsoleBridge, installProcessHandlers, logger } = require('./libs/logger');
const { requestLogger } = require('./routes/middlewares/request-logger');
const { navigationMiddleware } = require('./routes/middlewares/navigation');
const { createApplicationErrorHandler } = require('./routes/middlewares/error-handler');

installConsoleBridge();
installProcessHandlers();

var app = express();
const legacyBasePath = '/pazysalvos';
const canonicalBasePath = '/milab';
const isProduction = process.env.NODE_ENV === 'production';
const localPort = process.env.PORT || 3000;
const configuredAppOrigin = getOriginFromUrl(process.env.APP_BASE_URL);
const defaultLocalFormOrigins = [
  `http://localhost:${localPort}`,
  `http://127.0.0.1:${localPort}`,
  `https://localhost:${localPort}`,
  `https://127.0.0.1:${localPort}`,
];
const formActionSources = Array.from(
  new Set([
    "'self'",
    ...(isProduction ? [] : defaultLocalFormOrigins),
    ...(configuredAppOrigin ? [configuredAppOrigin] : []),
  ])
);

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
          'https://code.jquery.com',
          'cdn.jsdelivr.net',
          'https://cdn.jsdelivr.net',
          'stackpath.bootstrapcdn.com',
          'https://stackpath.bootstrapcdn.com',
          'maxcdn.bootstrapcdn.com',
          'https://maxcdn.bootstrapcdn.com',
          'cdnjs.cloudflare.com',
          'https://cdnjs.cloudflare.com',
          'www.google.com',
          'https://www.google.com',
          'www.gstatic.com',
          'https://www.gstatic.com',
          'www.recaptcha.net',
          'https://www.recaptcha.net',
          'cdn.datatables.net',
          'https://cdn.datatables.net',
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          'cdn.jsdelivr.net',
          'https://cdn.jsdelivr.net',
          'stackpath.bootstrapcdn.com',
          'https://stackpath.bootstrapcdn.com',
          'maxcdn.bootstrapcdn.com',
          'https://maxcdn.bootstrapcdn.com',
          'cdnjs.cloudflare.com',
          'https://cdnjs.cloudflare.com',
          'fonts.googleapis.com',
          'https://fonts.googleapis.com',
          'cdn.datatables.net',
          'https://cdn.datatables.net',
        ],
        fontSrc: [
          "'self'",
          'fonts.gstatic.com',
          'https://fonts.gstatic.com',
          'maxcdn.bootstrapcdn.com',
          'https://maxcdn.bootstrapcdn.com',
          'cdnjs.cloudflare.com',
          'https://cdnjs.cloudflare.com',
          'cdn.jsdelivr.net',
          'https://cdn.jsdelivr.net',
        ],
        imgSrc: [
          "'self'",
          'data:',
          'www.google.com',
          'https://www.google.com',
          'www.gstatic.com',
          'https://www.gstatic.com',
          'www.recaptcha.net',
          'https://www.recaptcha.net',
        ],
        connectSrc: [
          "'self'",
          'www.google.com',
          'https://www.google.com',
          'www.gstatic.com',
          'https://www.gstatic.com',
          'www.recaptcha.net',
          'https://www.recaptcha.net',
          'cdn.jsdelivr.net',
          'https://cdn.jsdelivr.net',
        ],
        formAction: formActionSources,
        objectSrc: ["'none'"],
        frameSrc: [
          "'self'",
          'www.google.com',
          'https://www.google.com',
          'www.recaptcha.net',
          'https://www.recaptcha.net',
        ],
        scriptSrcAttr: ["'unsafe-inline'"],
        upgradeInsecureRequests: isProduction ? [] : null,
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
  res.locals.environmentName = (process.env.NODE_ENV || 'development').trim();
  res.locals.isNonProductionEnvironment = res.locals.environmentName !== 'production';
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
app.use(createApplicationErrorHandler(logger));

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
