const express = require('express');
const passport = require('passport');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const session = require('express-session');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const rootEnvPath = path.join(process.cwd(), '.env');
const dockerEnvPath = path.join(__dirname, '../Docker/.env');
let resolvedEnvPath = null;

if (fs.existsSync(rootEnvPath)) {
  resolvedEnvPath = rootEnvPath;
} else if (fs.existsSync(dockerEnvPath)) {
  resolvedEnvPath = dockerEnvPath;
}

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

function resolveTrustProxySetting() {
  const rawValue = process.env.TRUST_PROXY;

  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return false;
  }

  const normalized = rawValue.trim().toLowerCase();

  if (normalized === 'true') return true;
  if (normalized === 'false') return false;

  const numericValue = Number.parseInt(normalized, 10);
  if (Number.isInteger(numericValue) && String(numericValue) === normalized) {
    return numericValue;
  }

  return rawValue.trim();
}

require('./routes/middlewares/microsoft');

const { installConsoleBridge, installProcessHandlers, logger } = require('./libs/logger');
const { requestLogger } = require('./routes/middlewares/request-logger');
const { navigationMiddleware } = require('./routes/middlewares/navigation');
const {
  createApplicationErrorHandler,
  enrichErrorPayloadForAdmin,
  renderApplicationError,
  wantsJson,
} = require('./routes/middlewares/error-handler');
const {
  csrfTokenMiddleware,
  verifyCsrfToken,
  createCsrfVerifier,
} = require('./routes/middlewares/csrf');
const { ipBlockMiddleware } = require('./routes/middlewares/limiter');
const { requireApiSessionUnlessPublic } = require('./routes/middlewares/api-session-gate');
const { sessionGateMiddleware } = require('./routes/middlewares/session-gate');
const { getSessionPolicy } = require('./libs/session-policy');
const {
  createSessionLifetimeMiddleware,
  expireSession,
} = require('./routes/middlewares/session-expiration');
const {
  startCoordinatorPendingNotificationsJob,
} = require('./jobs/coordinator-pending-notifications.job');

installConsoleBridge();
installProcessHandlers();

const app = express();
const legacyBasePath = '/pazysalvos';
const canonicalBasePath = '/milab';
const apiCsrfExemptPaths = [];
const verifyApiCsrfToken = createCsrfVerifier({ skipPaths: apiCsrfExemptPaths });
const normalizedNodeEnv = (process.env.NODE_ENV || '').toLowerCase();
const isProduction = normalizedNodeEnv === 'production';
const isDevLoginEnabled = ['1', 'true', 'yes'].includes(
  (process.env.ENABLE_DEV_LOGIN || '').toLowerCase()
);
const hasDevAdminPasswordConfigured = Boolean((process.env.ADMINDEV || '').trim());
const isDevLoginRuntime = normalizedNodeEnv === 'dev';
const codeDefinedAppVersion = '2.9.0';

// Dev-login: solo se habilita si NODE_ENV=dev y ENABLE_DEV_LOGIN=true.
if (isDevLoginEnabled && isDevLoginRuntime && !hasDevAdminPasswordConfigured) {
  throw new Error(
    '[SECURITY] ADMINDEV es obligatorio cuando ENABLE_DEV_LOGIN está activo en NODE_ENV=dev.'
  );
}
const localPort = process.env.PORT || 3000;
const appVersion = (codeDefinedAppVersion || process.env.APP_VERSION || '2.9.0').toString().trim();
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
const trustProxySetting = resolveTrustProxySetting();

app.disable('x-powered-by');
app.set('trust proxy', trustProxySetting);
if (isProduction && trustProxySetting === false) {
  logger.warn(
    '[SECURITY] TRUST_PROXY no está configurado; trust proxy queda deshabilitado. ' +
      'Define TRUST_PROXY según tu infraestructura (por ejemplo 1 detrás de ALB/Nginx).'
  );
}
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Función para generar un secreto aleatorio
const generateRandomSecret = () => {
  return crypto.randomBytes(64).toString('hex');
};
const sessionSecret = process.env.SESSION_SECRET || generateRandomSecret();
if (!process.env.SESSION_SECRET) {
  logger.warn(
    '[SECURITY] SESSION_SECRET no está definido — se usará un secreto aleatorio. ' +
      'Todas las sesiones activas se invalidarán cada vez que el servidor se reinicie.'
  );
}
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
const sessionPolicy = getSessionPolicy();
//Middleware
// Genera un nonce criptográfico por solicitud para CSP scriptSrc
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          (req, res) => `'nonce-${res.locals.cspNonce}'`,
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
app.use(ipBlockMiddleware);
app.use(limiter2);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      maxAge: sessionPolicy.idleTimeoutMs,
      secure: sessionCookieSecure,
      sameSite: sessionSameSite,
      httpOnly: true,
    },
  })
);

app.use(requestLogger);
app.use((req, res, next) => {
  req.sessionCookieSecure = sessionCookieSecure;
  req.sessionSameSite = sessionSameSite;
  next();
});
app.use(createSessionLifetimeMiddleware(sessionPolicy));
app.use(csrfTokenMiddleware);
app.use(
  '/milab/auth/session',
  (req, res, next) => {
    if (!req.session?.user) return expireSession(req, res, next);
    return next();
  },
  verifyCsrfToken,
  require('./routes/api/session')
);
app.use(navigationMiddleware);
app.use((req, res, next) => {
  res.locals.recaptchaSiteKey = process.env.RECAPTCHA_SITE_KEY || '';
  res.locals.environmentName = (process.env.NODE_ENV || 'development').trim();
  res.locals.isNonProductionEnvironment = res.locals.environmentName !== 'production';
  res.locals.isDevEnvironment = res.locals.environmentName.toLowerCase() === 'dev';
  res.locals.isDevLoginEnabled = isDevLoginEnabled && normalizedNodeEnv === 'dev';
  res.locals.appVersion = appVersion;
  res.setHeader('X-App-Version', appVersion);
  next();
});

app.use((req, res, next) => {
  const originalRender = res.render.bind(res);

  res.render = function patchedRender(view, locals, callback) {
    const viewName = String(view || '');

    if (viewName !== 'home/message_error') {
      return originalRender(view, locals, callback);
    }

    let effectiveLocals = locals;
    let effectiveCallback = callback;

    if (typeof locals === 'function') {
      effectiveCallback = locals;
      effectiveLocals = undefined;
    }

    const normalizedLocals =
      effectiveLocals && typeof effectiveLocals === 'object' ? effectiveLocals : {};
    const enrichedLocals = enrichErrorPayloadForAdmin(req, normalizedLocals);

    return originalRender(view, enrichedLocals, effectiveCallback);
  };

  return next();
});

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.use('/css', express.static(path.join(publicDir, 'css')));
app.use('/js', express.static(path.join(publicDir, 'js')));

app.set('host', process.env.HOST || '0.0.0.0');
app.set('port', process.env.PORT || 3000);

app.use(passport.initialize());
app.use('/api', requireApiSessionUnlessPublic, verifyApiCsrfToken, require('./routes/api'));
app.use('/milab/api', requireApiSessionUnlessPublic, verifyApiCsrfToken, require('./routes/api'));
app.use('/auth', require('./routes/api/microsoft'));
app.use(legacyBasePath, (req, res, next) => {
  const legacySuffix = req.originalUrl.slice(legacyBasePath.length) || '/';

  if (req.method === 'GET' || req.method === 'HEAD') {
    return res.redirect(301, `${canonicalBasePath}${legacySuffix}`);
  }

  next();
});

app.use(canonicalBasePath, sessionGateMiddleware, verifyCsrfToken, require('./milab_routes'));
app.use(legacyBasePath, sessionGateMiddleware, verifyCsrfToken, require('./milab_routes'));

// Redirección desde la raíz del dominio hacia la aplicación milab
// Garantiza que https://laboratorios.udistrital.edu.co/ lleve a /milab/
app.get('/', (req, res) => {
  const authenticatedHomePath = req.session?.user?.tipo ? '/milab/inicio' : '/milab/';
  return res.redirect(301, authenticatedHomePath);
});
app.head('/', (req, res) => {
  return res.redirect(301, '/milab/');
});

// 404 handler: evita respuestas default de Express tipo "Cannot POST ..."
app.use((req, res) => {
  const requestUrl = String(req.originalUrl || '');

  if (wantsJson(req) || requestUrl.startsWith('/api') || requestUrl.startsWith('/milab/api')) {
    return res.status(404).json({
      ok: false,
      message: 'Ruta no encontrada',
      message2: 'La URL solicitada no existe o el método no está permitido.',
    });
  }

  return renderApplicationError(res, {
    status: 404,
    message: 'Página no encontrada',
    message2: 'La URL solicitada no existe o el método no está permitido.',
  });
});
app.use(createApplicationErrorHandler(logger));

if (require.main === module) {
  startCoordinatorPendingNotificationsJob();

  app.listen(app.get('port'), app.get('host'), function () {
    logger.info(
      {
        host: app.get('host'),
        port: app.get('port'),
        version: appVersion,
      },
      'Server started'
    );
  });
}

module.exports = app;
