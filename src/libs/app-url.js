require('dotenv').config();

function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, '');
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
