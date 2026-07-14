const axios = require('axios');
const https = require('https');
const { setTimeout: delay } = require('node:timers/promises');

const { config } = require('../config/config');

let cachedToken = null;
let cachedTokenExpiresAt = 0;
const httpsAgent = new https.Agent({
  rejectUnauthorized: config.oatiRejectUnauthorized,
});
const insecureHttpsAgent = new https.Agent({
  rejectUnauthorized: false,
});
const oatiRetryDelaysMs = [500, 1500, 3000].slice(0, config.oatiMaxRetries);
let hasWarnedAboutTlsFallback = false;

function ensureOatiCredentials() {
  if (!config.oatiClientId || !config.oatiSecret) {
    throw new Error('Faltan OATI_CLIENT_ID u OATI_SECRET en las variables de entorno');
  }
}

function isRetryableOatiError(error) {
  const code = error?.code;
  const status = error?.response?.status;

  if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN'].includes(code)) {
    return true;
  }

  return status === 429 || status >= 500;
}

function isTlsCertificateError(error) {
  const code = (error?.code || '').toString().toUpperCase();
  const message = (error?.message || '').toString().toLowerCase();

  return (
    ['CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT'].includes(
      code
    ) || message.includes('certificate has expired')
  );
}

async function withOatiTlsFallback(operation) {
  try {
    return await operation(httpsAgent);
  } catch (error) {
    if (!config.oatiRejectUnauthorized || !isTlsCertificateError(error)) {
      throw error;
    }

    if (!hasWarnedAboutTlsFallback) {
      hasWarnedAboutTlsFallback = true;
      console.warn(
        '[OATI] TLS certificate validation failed. Applying temporary insecure fallback for OATI requests.'
      );
    }

    return operation(insecureHttpsAgent);
  }
}

async function withOatiRetry(operation) {
  let lastError;

  for (let attempt = 0; attempt <= oatiRetryDelaysMs.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt === oatiRetryDelaysMs.length || !isRetryableOatiError(error)) {
        throw error;
      }

      await delay(oatiRetryDelaysMs[attempt]);
    }
  }

  throw lastError;
}

async function fetchAccessToken() {
  ensureOatiCredentials();

  const now = Date.now();
  if (cachedToken && cachedTokenExpiresAt > now + 30000) {
    return cachedToken;
  }

  const tokenResponse = await withOatiRetry(() =>
    withOatiTlsFallback((agent) =>
      axios.post(
        config.oatiTokenUrl,
        new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
        {
          auth: {
            username: config.oatiClientId,
            password: config.oatiSecret,
          },
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          httpsAgent: agent,
          timeout: config.oatiTokenTimeoutMs,
        }
      )
    )
  );

  cachedToken = tokenResponse.data.access_token;
  const expiresInSeconds = Number(tokenResponse.data.expires_in || 300);
  cachedTokenExpiresAt = now + expiresInSeconds * 1000;

  return cachedToken;
}

async function requestOatiPublic(pathname) {
  const url = new URL(pathname, `${config.oatiPublicBaseUrl}/`).toString();
  const response = await withOatiTlsFallback((agent) =>
    axios.get(url, {
      httpsAgent: agent,
      timeout: config.oatiRequestTimeoutMs,
    })
  );
  return response.data;
}

async function requestOati(pathname) {
  if (config.oatiUsePublic) {
    return requestOatiPublic(pathname);
  }

  const accessToken = await fetchAccessToken();
  const url = new URL(pathname, `${config.oatiBaseUrl}/`).toString();

  const response = await withOatiRetry(() =>
    withOatiTlsFallback((agent) =>
      axios.get(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        httpsAgent: agent,
        timeout: config.oatiRequestTimeoutMs,
      })
    )
  );

  return response.data;
}

function getAcademicServicePath(servicePath) {
  return `wso2eiserver/services/servicios_academicos_produccion/${servicePath}`;
}

module.exports = {
  requestOati,
  getAcademicServicePath,
};
