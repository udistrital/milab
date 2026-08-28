//ConfigurCIÓN variables de entorno

require('dotenv').config();

const envName = (process.env.NODE_ENV || '').toLowerCase();

const config = {
  env: process.env.NODE_ENV,
  port: process.env.PORT,
  dbUser: process.env.DB_USER,
  dbPassword: process.env.DB_PASSWORD,
  dbName: process.env.DB_NAME,
  dbHost: process.env.DB_HOST,
  dbPort: process.env.DB_PORT,
  options: `-c search_path=${process.env.DB_SCHEMA}`,
  oatiClientId: process.env.OATI_CLIENT_ID,
  oatiSecret: process.env.OATI_SECRET,
  oatiBaseUrl: process.env.OATI_BASE_URL || 'https://busservicios.intranetoas.udistrital.edu.co',
  oatiTokenUrl:
    process.env.OATI_TOKEN_URL || 'https://busservicios.intranetoas.udistrital.edu.co/oauth2/token',
  oatiRejectUnauthorized: process.env.OATI_REJECT_UNAUTHORIZED === 'true',
  oatiTokenTimeoutMs: Number(process.env.OATI_TIMEOUT_MS ?? 15000),
  oatiRequestTimeoutMs: Number(process.env.OATI_TIMEOUT_MS ?? 20000),
  oatiMaxRetries: Number(process.env.OATI_MAX_RETRIES ?? 3),
  oatiPublicBaseUrl:
    process.env.OATI_PUBLIC_BASE_URL || 'https://autenticacion.portaloas.udistrital.edu.co',
  oatiUsePublic: envName === 'dev',
};

module.exports = { config };
