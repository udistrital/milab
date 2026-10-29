const axios = require('axios');
const { getOatiAccessToken } = require('./oati-client');

const DEFAULT_TEST_ARKA_API_BASE_URL =
  'https://autenticacion.portaloas.udistrital.edu.co/apioas/arka_mid/v1';
const DEFAULT_TEST_TERCEROS_API_BASE_URL =
  'https://autenticacion.portaloas.udistrital.edu.co/apioas/terceros_crud/v1';

class ArkaIntegrationError extends Error {
  constructor(message, code = 'ARKA_INTEGRATION_ERROR', status = null) {
    super(message);
    this.name = 'ArkaIntegrationError';
    this.code = code;
    this.status = status;
  }
}

function normalizeBaseUrl(value, variableName) {
  let url;

  try {
    url = new URL(value);
  } catch {
    throw new ArkaIntegrationError(
      `${variableName} debe ser una URL válida.`,
      'ARKA_CONFIGURATION_ERROR'
    );
  }

  if (url.protocol !== 'https:') {
    throw new ArkaIntegrationError(
      `${variableName} debe usar HTTPS para proteger el token.`,
      'ARKA_CONFIGURATION_ERROR'
    );
  }

  return url.href.replace(/\/+$/, '');
}

function getArkaConfiguration(env = process.env) {
  const isProduction =
    String(env.NODE_ENV || '')
      .trim()
      .toLowerCase() === 'production';
  const arkaBaseUrl = String(
    env.ARKA_API_BASE_URL || (isProduction ? '' : DEFAULT_TEST_ARKA_API_BASE_URL)
  ).trim();
  const tercerosBaseUrl = String(
    env.ARKA_TERCEROS_API_BASE_URL || (isProduction ? '' : DEFAULT_TEST_TERCEROS_API_BASE_URL)
  ).trim();

  return {
    arkaBaseUrl: arkaBaseUrl ? normalizeBaseUrl(arkaBaseUrl, 'ARKA_API_BASE_URL') : '',
    tercerosBaseUrl: tercerosBaseUrl
      ? normalizeBaseUrl(tercerosBaseUrl, 'ARKA_TERCEROS_API_BASE_URL')
      : '',
    hasOatiCredentials: Boolean(
      String(env.OATI_CLIENT_ID || '').trim() && String(env.OATI_SECRET || '').trim()
    ),
    requestTimeoutMs: Number.parseInt(env.ARKA_REQUEST_TIMEOUT_MS || '20000', 10),
    maxResponseBytes: Number.parseInt(env.ARKA_MAX_RESPONSE_BYTES || '52428800', 10),
  };
}

function isArkaConfigured(env = process.env) {
  const configuration = getArkaConfiguration(env);
  return Boolean(
    configuration.arkaBaseUrl &&
    configuration.tercerosBaseUrl &&
    configuration.hasOatiCredentials &&
    Number.isFinite(configuration.requestTimeoutMs) &&
    configuration.requestTimeoutMs > 0 &&
    Number.isFinite(configuration.maxResponseBytes) &&
    configuration.maxResponseBytes > 0
  );
}

function assertArkaConfiguration(configuration) {
  if (
    !configuration.arkaBaseUrl ||
    !configuration.tercerosBaseUrl ||
    !configuration.hasOatiCredentials ||
    !Number.isFinite(configuration.requestTimeoutMs) ||
    configuration.requestTimeoutMs <= 0 ||
    !Number.isFinite(configuration.maxResponseBytes) ||
    configuration.maxResponseBytes <= 0
  ) {
    throw new ArkaIntegrationError(
      'Configura las URL de ARKA y las credenciales OATI_CLIENT_ID y OATI_SECRET.',
      'ARKA_CONFIGURATION_ERROR'
    );
  }

  return {
    ...configuration,
    arkaBaseUrl: normalizeBaseUrl(configuration.arkaBaseUrl, 'ARKA_API_BASE_URL'),
    tercerosBaseUrl: normalizeBaseUrl(configuration.tercerosBaseUrl, 'ARKA_TERCEROS_API_BASE_URL'),
  };
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function toOptionalText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function toOptionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requestError(error) {
  const status = Number(error?.response?.status) || null;
  if (status === 401 || status === 403) {
    return new ArkaIntegrationError(
      'ARKA rechazó la autenticación. Verifica el Access token configurado.',
      'ARKA_AUTHENTICATION_ERROR',
      status
    );
  }
  if (status) {
    return new ArkaIntegrationError(
      `El API de ARKA respondió con estado HTTP ${status}.`,
      'ARKA_HTTP_ERROR',
      status
    );
  }
  return new ArkaIntegrationError(
    'No fue posible conectar con los servicios de ARKA.',
    'ARKA_NETWORK_ERROR'
  );
}

function createArkaClient({
  configuration = getArkaConfiguration(),
  httpClient = axios,
  accessTokenProvider = getOatiAccessToken,
} = {}) {
  const clientConfiguration = assertArkaConfiguration(configuration);

  async function get(url, params) {
    let accessToken;
    try {
      accessToken = await accessTokenProvider();
    } catch {
      throw new ArkaIntegrationError(
        'No fue posible obtener el token OAuth para consultar ARKA.',
        'ARKA_TOKEN_ERROR'
      );
    }

    if (typeof accessToken !== 'string' || !accessToken.trim()) {
      throw new ArkaIntegrationError(
        'El servicio OAuth no devolvió un token válido para consultar ARKA.',
        'ARKA_TOKEN_ERROR'
      );
    }

    try {
      const response = await httpClient.get(url, {
        headers: {
          Authorization: `Bearer ${accessToken.trim()}`,
          Accept: 'application/json',
        },
        params,
        timeout: clientConfiguration.requestTimeoutMs,
        maxContentLength: clientConfiguration.maxResponseBytes,
      });
      return response.data;
    } catch (error) {
      throw requestError(error);
    }
  }

  async function resolveThirdPartyId(document) {
    const query = String(document || '').trim();
    if (!query || query.length > 50) {
      throw new ArkaIntegrationError(
        'El documento del coordinador no es válido.',
        'ARKA_INVALID_COORDINATOR_DOCUMENT'
      );
    }

    const data = await get(`${clientConfiguration.tercerosBaseUrl}/tercero/identificacion`, {
      query,
    });
    if (!Array.isArray(data)) {
      throw new ArkaIntegrationError(
        'Terceros devolvió una respuesta con formato no válido.',
        'ARKA_INVALID_TERCEROS_RESPONSE'
      );
    }

    const thirdPartyIds = [
      ...new Set(data.map((row) => toPositiveInteger(row?.tercero_id)).filter(Boolean)),
    ];
    if (thirdPartyIds.length !== 1) {
      throw new ArkaIntegrationError(
        thirdPartyIds.length
          ? 'Terceros devolvió más de un identificador para el documento del coordinador.'
          : 'Terceros no encontró un identificador para el documento del coordinador.',
        thirdPartyIds.length ? 'ARKA_AMBIGUOUS_THIRD_PARTY' : 'ARKA_THIRD_PARTY_NOT_FOUND'
      );
    }

    return thirdPartyIds[0];
  }

  async function getCoordinatorInventory(document) {
    const terceroId = await resolveThirdPartyId(document);
    const data = await get(
      `${clientConfiguration.arkaBaseUrl}/traslados/funcionario/${encodeURIComponent(terceroId)}`
    );
    if (!data || typeof data !== 'object' || !Array.isArray(data.Elementos)) {
      throw new ArkaIntegrationError(
        'ArkaMid devolvió una respuesta con formato no válido.',
        'ARKA_INVALID_INVENTORY_RESPONSE'
      );
    }

    const items = data.Elementos.map((item, sourceIndex) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new ArkaIntegrationError(
          'ArkaMid devolvió un elemento con formato no válido.',
          'ARKA_INVALID_INVENTORY_ITEM'
        );
      }

      return {
        sourceIndex,
        arkaId: toPositiveInteger(item.Id),
        elementoActaId: toPositiveInteger(item.ElementoActaId),
        placa: toOptionalText(item.Placa),
        serie: toOptionalText(item.Serie),
        nombre: toOptionalText(item.Nombre),
        marca: toOptionalText(item.Marca),
        valor: toOptionalNumber(item.Valor),
      };
    });

    return { terceroId, items };
  }

  return {
    getCoordinatorInventory,
    resolveThirdPartyId,
  };
}

module.exports = {
  ArkaIntegrationError,
  DEFAULT_TEST_ARKA_API_BASE_URL,
  DEFAULT_TEST_TERCEROS_API_BASE_URL,
  createArkaClient,
  getArkaConfiguration,
  isArkaConfigured,
};
