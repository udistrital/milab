const passport = require('passport');
const MicrosoftStrategy = require('passport-microsoft').Strategy;
const { config } = require('dotenv');

config();

function trimTrailingSlashes(value) {
  let output = (value || '').toString();
  while (output.length > 0 && output.endsWith('/')) {
    output = output.slice(0, -1);
  }
  return output;
}

function resolveCallbackBaseUrl() {
  const explicitCallbackBase = process.env.MICROSOFT_CALLBACK_BASE_URL;
  if (explicitCallbackBase) {
    return explicitCallbackBase;
  }

  // Prefer APP_URL over APP_BASE_URL because APP_BASE_URL may include a path prefix (/milab).
  const configuredBase = process.env.APP_URL || process.env.APP_BASE_URL;

  if (configuredBase) {
    return configuredBase;
  }

  return (process.env.NODE_ENV || '').toLowerCase() === 'production'
    ? 'https://laboratorios.udistrital.edu.co'
    : `http://localhost:${process.env.PORT || 3000}`;
}

const callbackBaseUrl = trimTrailingSlashes(resolveCallbackBaseUrl());

if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
  passport.use(
    'auth-microsoft',
    new MicrosoftStrategy(
      {
        clientID: process.env.MICROSOFT_CLIENT_ID,
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
        callbackURL: `${callbackBaseUrl}/auth/microsoft/callback`,
        scope: ['openid', 'profile', 'email'],
        tenant: process.env.MICROSOFT_TENANT_ID,
        authorizationURL: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID || 'common'}/oauth2/v2.0/authorize`,
        tokenURL: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID || 'common'}/oauth2/v2.0/token`,
        state: true,
      },
      function (accessToken, refreshToken, profile, done) {
        done(null, profile);
      }
    )
  );
} else {
  console.warn(
    'Microsoft auth no se inicializo porque faltan MICROSOFT_CLIENT_ID o MICROSOFT_CLIENT_SECRET.'
  );
}
