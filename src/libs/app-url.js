require('dotenv').config();

function trimTrailingSlashes(value) {
  let output = (value || '').toString();
  while (output.length > 0 && output.endsWith('/')) {
    output = output.slice(0, -1);
  }
  return output;
}

function normalizeBaseUrl(baseUrl) {
  return trimTrailingSlashes(baseUrl);
}

function normalizePath(pathname) {
  return pathname.startsWith('/') ? pathname : `/${pathname}`;
}

const fallbackBaseUrl =
  process.env.NODE_ENV === 'production'
    ? 'https://laboratorios.udistrital.edu.co/milab'
    : `http://localhost:${process.env.PORT || 3000}/milab`;

const appBaseUrl = normalizeBaseUrl(process.env.APP_BASE_URL || fallbackBaseUrl);

function buildAppUrl(pathname = '/') {
  return `${appBaseUrl}${normalizePath(pathname)}`;
}

module.exports = {
  appBaseUrl,
  buildAppUrl,
};
