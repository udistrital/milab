const { XMLParser } = require('fast-xml-parser');

const { config } = require('../config/config');
const { getAcademicServicePath, requestOati, requestOatiPost } = require('./oati-client');

const SGA_DEBT_CONCEPT_NAMES = Object.freeze({
  1: 'BIBLIOTECA INGENIERÍA',
  2: 'LAB. TOPOGRAFIA (MAC.A)',
  3: 'LABORATORIO DE FISICA',
  4: 'LABORATORIO DE QUIMICA',
  5: 'LABORATORIO DE BIOLOGIA',
  6: 'LAB. ELECTRON. (SED. CENTRAL)',
  7: 'AUDIOVISUALES',
  8: 'LABORATORIO DE FOTOGRAMETRIA (VIVERO)',
  9: 'BIENESTAR UNIVERSITARIO',
  10: 'BIBLIOTECA VIVERO',
  11: 'BIBLIOTECA MAC. A.',
  12: 'BIBLIOTECA MAC B',
  13: 'BIBLIOTECA TECNOLOGICA',
  14: 'CENTRO INVEST. GEOG. CIGER',
  15: 'BIBLIOTECA ILUD',
  16: 'LAB. INVERNADERO -VIVERO-',
  17: 'LAB. TOPOGRAFIA -VIVERO-',
  18: 'LAB. BIOLOGIA -VIVERO-',
  19: 'CALIDAD DE AGUAS -VIVERO-',
  20: 'FOTOINTERPRETACION -VIVERO-',
  21: 'DEPORTES - VIVERO',
  30: 'COORD. LABORATORIO VIVERO',
  31: 'LAB. MICROBIOLOGIA-VIVERO',
  32: 'LAB. SILVICULTURA VIVERO',
  33: 'LAB. SUELOS VIVERO',
  34: 'LAB. CARPINTERIA VIVERO',
  35: 'XILOTECA VIVERO',
  36: 'BIBLIOTECA ASAB',
  37: 'SALAS GEOMATICA - VIVERO',
  38: 'SALA CARTOGRAFIA - VIVERO',
  39: 'LAB. TECNOLOGIA EN MADERAS VIV',
  40: 'LABORATORIO CIVILES - TECNO',
  41: 'LAB. SANIDAD FORESTAL - VIVERO',
  42: 'LAB. SERVICIOS PUBLICOS - VIV.',
  43: 'LAB. QUIMICA - VIVERO',
  44: 'AUDIOVISUALES - VIVERO',
  45: 'HERBARIO - FORESTAL VIVERO',
  46: 'LAB. ELECTRONICA (TECNO)',
  47: 'LAB. ELECTRICIDAD (TECNO)',
  48: 'LAB. INDUSTRIAL (TECNO)',
  49: 'LAB. SISTEMAS (TECNO)',
  50: 'LAB. MECANICA (TECNO)',
  51: 'LAB. CIENCIAS BASICAS (TECNO)',
  52: 'BIBLIOTECA ADUANILLA DE PAIBA',
  53: 'LABORATORIO DE TECNOLOGIAS LIMPIAS (FAMARENA)',
  54: 'LABORATORIO CALIDAD DE AIRE (FAMARENA)',
  55: 'ZOONOSIS (FAMARENA)',
  56: 'CENTRO DE DOCUMENTACION SOCIALES',
  57: 'BIBLIOTECA POSGRADOS',
  58: 'BIBLIOTECA PORVENIR',
  59: 'LABORATORIO DE BIOLOGIA MOLECULAR (VIVERO)',
  72: 'LAB. QUIMICA ORGANICA (BOSA)',
});

function resolveSgaConceptName(rawCode) {
  const code = String(rawCode ?? '').trim();
  if (!code) return null;
  const normalizedCode = /^\d+$/.test(code) ? String(Number(code)) : code;
  return SGA_DEBT_CONCEPT_NAMES[code] || SGA_DEBT_CONCEPT_NAMES[normalizedCode] || null;
}

class SgaDebtService {
  constructor({
    serviceConfig = config,
    academicServicePath = getAcademicServicePath,
    requestAcademicData = requestOati,
    requestPost = requestOatiPost,
  } = {}) {
    this.config = serviceConfig;
    this.academicServicePath = academicServicePath;
    this.requestAcademicData = requestAcademicData;
    this.requestPost = requestPost;
    this.xmlParser = new XMLParser({
      ignoreAttributes: true,
      parseTagValue: false,
      removeNSPrefix: true,
      trimValues: true,
    });
  }

  isConfigured() {
    return Boolean(String(this.config.oatiDebtorsServiceName || '').trim());
  }

  isActiveDebt(debt) {
    const state = String(debt?.DEU_ESTADO ?? '').trim();
    return state === '1' || state === '2';
  }

  // Las deudas de biblioteca no corresponden a laboratorios: no se muestran ni bloquean.
  isLibraryDebt(debt) {
    const detail = String(debt?.DEU_MATERIAL || '')
      .normalize('NFD')
      .replaceAll(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    return detail.includes('biblioteca');
  }

  isBlockingDebt(debt) {
    return this.isActiveDebt(debt) && !this.isLibraryDebt(debt);
  }

  buildServicePath(codigoEstudiante) {
    const normalizedCode = String(codigoEstudiante || '').trim();
    if (!/^\d+$/.test(normalizedCode)) {
      throw new Error('El código de estudiante no es válido para consultar multas en SGA.');
    }

    const serviceName = String(this.config.oatiDebtorsServiceName || '').trim();
    if (!serviceName) {
      throw new Error('El servicio SGA de deudores no está configurado para este ambiente.');
    }
    if (!/^[a-z0-9_-]+$/i.test(serviceName)) {
      throw new Error('El nombre del servicio SGA de deudores no es válido.');
    }

    return `wso2eiserver/services/${serviceName}/deudores/${encodeURIComponent(normalizedCode)}`;
  }

  parseResponse(response) {
    if (!response || (typeof response !== 'string' && typeof response !== 'object')) {
      throw new Error('El servicio SGA devolvió una respuesta vacía o inválida.');
    }

    const parsedResponse = typeof response === 'string' ? this.xmlParser.parse(response) : response;
    if (!Object.hasOwn(parsedResponse, 'deudas')) {
      throw new Error('La respuesta del servicio SGA no contiene el resultado de deudas esperado.');
    }

    const records = parsedResponse.deudas?.estudiantes;
    if (!records) return [];
    return Array.isArray(records) ? records : [records];
  }

  async resolveStudentCode({ codigo, documento, identificador } = {}) {
    const normalizedCode = String(codigo || '').trim();
    if (/^\d+$/.test(normalizedCode)) return normalizedCode;

    const lookupValue = String(documento || identificador || '').trim();
    if (!/^\d+$/.test(lookupValue)) return null;

    const paths = [
      this.academicServicePath(`datos_basicos_estudiante/${lookupValue}`),
      this.academicServicePath(`datos_basicos_activos_cedula/${lookupValue}`),
    ];

    for (const path of paths) {
      try {
        const response = await this.requestAcademicData(path);
        const records = response?.datosEstudianteCollection?.datosBasicosEstudiante;
        const record = Array.isArray(records)
          ? records.find((item) => item?.codigo) || records.at(-1)
          : records;
        const resolvedCode = String(record?.codigo || '').trim();
        if (/^\d+$/.test(resolvedCode)) return resolvedCode;
      } catch {
        // Intentar con el siguiente endpoint académico.
      }
    }

    return null;
  }

  async fetchDebtsByStudentCode(codigoEstudiante) {
    if (!this.isConfigured()) return [];

    const servicePath = this.buildServicePath(codigoEstudiante);
    const requestXml =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<xs:_getdeudores_codigo_estudiante xmlns:xs="http://www.w3.org/2001/XMLSchema">` +
      `<xs:codigo_estudiante>${String(codigoEstudiante).trim()}</xs:codigo_estudiante>` +
      `</xs:_getdeudores_codigo_estudiante>`;
    const response = await this.requestPost(servicePath, requestXml, 'text/xml; charset=utf-8');

    return this.parseResponse(response);
  }

  async getActiveDebts({ codigo, documento, identificador } = {}) {
    if (!this.isConfigured()) return [];

    const codigoEstudiante = await this.resolveStudentCode({ codigo, documento, identificador });
    if (!codigoEstudiante) {
      throw new Error('No fue posible obtener el código del estudiante para consultar multas SGA.');
    }

    const debts = await this.fetchDebtsByStudentCode(codigoEstudiante);
    return debts
      .filter((debt) => this.isBlockingDebt(debt))
      .map((debt) => {
        const conceptName = resolveSgaConceptName(debt?.DEU_CPTO_COD);
        return conceptName && !debt.DEU_CPTO_NOMBRE
          ? { ...debt, DEU_CPTO_NOMBRE: conceptName }
          : debt;
      });
  }
}

const sgaDebtService = new SgaDebtService();

module.exports = {
  SgaDebtService,
  sgaDebtService,
  resolveSgaConceptName,
};
