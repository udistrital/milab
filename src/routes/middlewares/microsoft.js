const passport = require('passport');
const MicrosoftStrategy = require('passport-microsoft').Strategy;
const { config } = require('dotenv');

config();

function resolveCallbackBaseUrl() {
  const configuredBase =
    process.env.MICROSOFT_CALLBACK_BASE_URL || process.env.APP_BASE_URL || process.env.APP_URL;

  if (configuredBase) {
    return configuredBase;
  }

  return (process.env.NODE_ENV || '').toLowerCase() === 'production'
    ? 'https://laboratorios.udistrital.edu.co'
    : `http://localhost:${process.env.PORT || 3000}`;
}

function normalizeCallbackUrl(url) {
  const normalizedUrl = (url || '').replace(/\/+$/, '');

  if ((process.env.NODE_ENV || '').toLowerCase() !== 'production') {
    return normalizedUrl;
  }

  if (normalizedUrl.endsWith('/milab')) {
    return normalizedUrl;
  }

  return `${normalizedUrl}/milab`;
}

const callbackBaseUrl = normalizeCallbackUrl(resolveCallbackBaseUrl());

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
