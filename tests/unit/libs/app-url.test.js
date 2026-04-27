const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../../src/libs/app-url.js');

function loadAppUrlWithEnv(envOverrides) {
  const previousEnv = {
    APP_BASE_URL: process.env.APP_BASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
  };

  Object.assign(process.env, envOverrides);
  delete require.cache[modulePath];

  const loadedModule = require(modulePath);

  return {
    ...loadedModule,
    restore() {
      Object.entries(previousEnv).forEach(([key, value]) => {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      });

      delete require.cache[modulePath];
    },
  };
}

test('buildAppUrl uses explicit APP_BASE_URL and normalizes slashes', () => {
  const loaded = loadAppUrlWithEnv({
    APP_BASE_URL: 'https://labs.udistrital.edu.co/milab/',
    NODE_ENV: 'production',
    PORT: '3000',
  });

  try {
    assert.equal(loaded.appBaseUrl, 'https://labs.udistrital.edu.co/milab');
    assert.equal(
      loaded.buildAppUrl('api/health'),
      'https://labs.udistrital.edu.co/milab/api/health'
    );
    assert.equal(
      loaded.buildAppUrl('/api/register'),
      'https://labs.udistrital.edu.co/milab/api/register'
    );
  } finally {
    loaded.restore();
  }
});

test('buildAppUrl falls back to localhost in non-production', () => {
  const loaded = loadAppUrlWithEnv({
    APP_BASE_URL: '',
    NODE_ENV: 'development',
    PORT: '4567',
  });

  try {
    assert.equal(loaded.appBaseUrl, 'http://localhost:4567/milab');
    assert.equal(loaded.buildAppUrl('/api/ping'), 'http://localhost:4567/milab/api/ping');
  } finally {
    loaded.restore();
  }
});

test('buildAppUrl falls back to canonical production URL when APP_BASE_URL is absent', () => {
  const loaded = loadAppUrlWithEnv({
    APP_BASE_URL: '',
    NODE_ENV: 'production',
    PORT: '3000',
  });

  try {
    assert.equal(loaded.appBaseUrl, 'https://laboratorios.udistrital.edu.co/milab');
  } finally {
    loaded.restore();
  }
});
