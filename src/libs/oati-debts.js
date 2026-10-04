const { XMLParser } = require('fast-xml-parser');

const { config } = require('../config/config');
const { getAcademicServicePath, requestOati, requestOatiPost } = require('./oati-client');

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
    return String(debt?.DEU_ESTADO || '').trim() === '2';
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
    return debts.filter((debt) => this.isActiveDebt(debt));
  }
}

const sgaDebtService = new SgaDebtService();

module.exports = {
  SgaDebtService,
  sgaDebtService,
};
