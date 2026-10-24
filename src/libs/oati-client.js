const axios = require('axios');
const https = require('https');
const { setTimeout: delay } = require('node:timers/promises');

const { config } = require('../config/config');

let cachedToken = null;
let cachedTokenExpiresAt = 0;
let oatiCircuitOpenedAt = 0;
let hasWarnedAboutTlsFallback = false;
let hasWarnedAboutCircuit = false;
const oatiCircuitCooldownMs = Math.max(Number(process.env.OATI_CIRCUIT_COOLDOWN_MS || 90000), 1000);
const httpsAgent = new https.Agent({
  rejectUnauthorized: config.oatiRejectUnauthorized,
});
const insecureHttpsAgent = new https.Agent({
  rejectUnauthorized: false,
});
const oatiRetryDelaysMs = [500, 1500, 3000].slice(0, config.oatiMaxRetries);

class OatiUnavailableError extends Error {
  constructor(message, cause = null) {
    super(message);
    this.name = 'OatiUnavailableError';
    this.code = 'OATI_UNAVAILABLE';
    if (cause) {
      this.cause = cause;
    }
  }
}

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

function isOatiUnavailableCandidate(error) {
  if (!error) return false;
  if (error?.code === 'OATI_UNAVAILABLE') return true;
  if (isRetryableOatiError(error)) return true;
  if (isTlsCertificateError(error)) return true;
  return false;
}

function isOatiUnavailableError(error) {
  return error?.code === 'OATI_UNAVAILABLE' || error instanceof OatiUnavailableError;
}

function isOatiCircuitOpen() {
  return oatiCircuitOpenedAt > 0 && Date.now() - oatiCircuitOpenedAt < oatiCircuitCooldownMs;
}

function markOatiCircuitFailure(error) {
  if (!isOatiUnavailableCandidate(error)) {
    return;
  }

  oatiCircuitOpenedAt = Date.now();
  cachedToken = null;
  cachedTokenExpiresAt = 0;

  if (!hasWarnedAboutCircuit) {
    hasWarnedAboutCircuit = true;
    console.warn(
      `[OATI] External academic services unavailable. Failing fast for ${oatiCircuitCooldownMs}ms.`
    );
  }
}

function clearOatiCircuit() {
  if (oatiCircuitOpenedAt > 0) {
    oatiCircuitOpenedAt = 0;
  }
}

function throwWhenCircuitOpen() {
  if (!isOatiCircuitOpen()) {
    return;
  }

  throw new OatiUnavailableError('Los servicios OATI no están disponibles temporalmente.');
}

function wrapAsOatiUnavailable(error) {
  if (isOatiUnavailableError(error)) {
    return error;
  }
  return new OatiUnavailableError('No fue posible conectar con los servicios OATI.', error);
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

async function withOatiRetry(operation, signal) {
  let lastError;

  for (let attempt = 0; attempt <= oatiRetryDelaysMs.length; attempt += 1) {
    try {
      signal?.throwIfAborted();
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt === oatiRetryDelaysMs.length || !isRetryableOatiError(error)) {
        throw error;
      }

      await delay(oatiRetryDelaysMs[attempt], undefined, { signal });
    }
  }

  throw lastError;
}

async function fetchAccessToken(signal) {
  throwWhenCircuitOpen();
  ensureOatiCredentials();

  const now = Date.now();
  if (cachedToken && cachedTokenExpiresAt > now + 30000) {
    return cachedToken;
  }

  let tokenResponse;
  try {
    tokenResponse = await withOatiRetry(
      () =>
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
              signal,
            }
          )
        ),
      signal
    );
  } catch (error) {
    markOatiCircuitFailure(error);
    if (isOatiUnavailableCandidate(error)) {
      throw wrapAsOatiUnavailable(error);
    }
    throw error;
  }

  cachedToken = tokenResponse.data.access_token;
  const expiresInSeconds = Number(tokenResponse.data.expires_in || 300);
  cachedTokenExpiresAt = now + expiresInSeconds * 1000;
  clearOatiCircuit();
  hasWarnedAboutCircuit = false;

  return cachedToken;
}

async function requestOatiPublic(pathname, signal) {
  throwWhenCircuitOpen();
  const url = new URL(pathname, `${config.oatiPublicBaseUrl}/`).toString();
  let response;

  try {
    response = await withOatiTlsFallback((agent) =>
      axios.get(url, {
        httpsAgent: agent,
        timeout: config.oatiRequestTimeoutMs,
        signal,
      })
    );
  } catch (error) {
    markOatiCircuitFailure(error);
    if (isOatiUnavailableCandidate(error)) {
      throw wrapAsOatiUnavailable(error);
    }
    throw error;
  }

  clearOatiCircuit();
  hasWarnedAboutCircuit = false;
  return response.data;
}

async function requestOati(pathname, { signal } = {}) {
  if (config.oatiUsePublic) {
    return requestOatiPublic(pathname, signal);
  }

  const accessToken = await fetchAccessToken(signal);
  const url = new URL(pathname, `${config.oatiBaseUrl}/`).toString();
  let response;

  try {
    response = await withOatiRetry(
      () =>
        withOatiTlsFallback((agent) =>
          axios.get(url, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            httpsAgent: agent,
            timeout: config.oatiRequestTimeoutMs,
            signal,
          })
        ),
      signal
    );
  } catch (error) {
    markOatiCircuitFailure(error);
    if (isOatiUnavailableCandidate(error)) {
      throw wrapAsOatiUnavailable(error);
    }
    throw error;
  }

  clearOatiCircuit();
  hasWarnedAboutCircuit = false;
  return response.data;
}

async function requestOatiPost(pathname, body, contentType = 'application/json') {
  throwWhenCircuitOpen();
  const accessToken = await fetchAccessToken();
  const url = new URL(pathname, `${config.oatiBaseUrl}/`).toString();
  let response;

  try {
    response = await withOatiRetry(() =>
      withOatiTlsFallback((agent) =>
        axios.post(url, body, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': contentType,
          },
          httpsAgent: agent,
          timeout: config.oatiRequestTimeoutMs,
        })
      )
    );
  } catch (error) {
    markOatiCircuitFailure(error);
    if (isOatiUnavailableCandidate(error)) {
      throw wrapAsOatiUnavailable(error);
    }
    throw error;
  }

  clearOatiCircuit();
  hasWarnedAboutCircuit = false;
  return response.data;
}

function getAcademicServicePath(servicePath) {
  return `wso2eiserver/services/servicios_academicos_produccion/${servicePath}`;
}

module.exports = {
  requestOati,
  requestOatiPost,
  getAcademicServicePath,
  OatiUnavailableError,
  isOatiUnavailableError,
  isOatiCircuitOpen,
};
