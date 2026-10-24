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

function normalizeNumericIdentifier(value) {
  const normalized = String(value ?? '').trim();
  return /^\d+$/.test(normalized) ? normalized : '';
}

function extractStudentRecords(payload) {
  if (Array.isArray(payload)) return payload;

  const records = payload?.datosEstudianteCollection?.datosBasicosEstudiante;
  if (Array.isArray(records)) return records;
  if (records) return [records];

  const flatRecords = payload?.datosBasicosEstudiante;
  if (Array.isArray(flatRecords)) return flatRecords;
  return flatRecords ? [flatRecords] : [];
}

function getStudentRecordDocument(record) {
  return normalizeNumericIdentifier(record?.documento || record?.numero_documento_identificacion);
}

function getSgaConceptName(debt) {
  return String(debt?.CPTO_NOMBRE || debt?.DEU_CPTO_NOMBRE || '').trim();
}

function isLaboratoryConceptName(value) {
  const normalizedName = String(value ?? '')
    .normalize('NFD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  const words = normalizedName.match(/[A-Z0-9]+/g) || [];
  return words.includes('LABORATORIO') || words.includes('LAB');
}

function normalizeSgaDebt(debt, queriedCode) {
  const conceptCode = String(debt?.DEU_CPTO_COD || '').trim();
  const conceptName = getSgaConceptName(debt) || resolveSgaConceptName(conceptCode) || null;

  return {
    ...debt,
    origen: 'SGA',
    id_sga: debt?.DEU_ID ? String(debt.DEU_ID).trim() : null,
    codigo_estudiante: normalizeNumericIdentifier(debt?.DEU_EST_COD) || queriedCode,
    codigo_concepto: conceptCode || null,
    nombre_concepto: conceptName,
    tipo_concepto: debt?.CPTO_TIPO || debt?.DEU_CPTO_TIPO || null,
    categoria: debt?.DEU_MATERIAL || null,
    valor: debt?.DEU_MULTA ?? null,
    fecha: debt?.DEU_FECHA || null,
    estado: String(debt?.DEU_ESTADO ?? '').trim() || null,
    anio: debt?.DEU_ANO || null,
    periodo: debt?.DEU_PER || null,
    fecha_pago: debt?.DEU_FECHA_PAGO || null,
  };
}

function getSgaDebtFingerprint(debt) {
  const id = String(debt?.DEU_ID ?? '').trim();
  if (id) return `id:${id}`;

  const fields = [
    'DEU_CPTO_COD',
    'CPTO_NOMBRE',
    'DEU_CPTO_NOMBRE',
    'DEU_MATERIAL',
    'DEU_MULTA',
    'DEU_FECHA',
    'DEU_ANO',
    'DEU_PER',
    'DEU_ESTADO',
    'DEU_FECHA_PAGO',
  ];
  return JSON.stringify(fields.map((field) => String(debt?.[field] ?? '').trim()));
}

function getSgaQueryMessage(result) {
  const errorMessage = result.errors?.map((error) => error.message).find(Boolean);
  if (errorMessage) return errorMessage;

  if (result.status === 'not_configured') {
    return 'El servicio SGA no está configurado en este ambiente.';
  }
  if (result.status === 'unresolved') {
    return 'No fue posible identificar de forma verificable los códigos académicos del estudiante.';
  }
  if (result.status === 'error') {
    return 'No fue posible consultar las multas del estudiante en SGA.';
  }
  if (result.status === 'partial' && result.unclassifiedCount > 0) {
    return 'SGA devolvió multas activas sin nombre de concepto; no fue posible clasificarlas.';
  }
  if (result.status === 'partial') {
    return 'La consulta de SGA quedó incompleta; el resultado no es concluyente.';
  }
  if (result.status === 'found') {
    return 'Se encontraron multas activas asociadas a conceptos de laboratorio.';
  }
  return 'Consulta SGA completa: no se encontraron multas activas de laboratorio.';
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
    const normalizedCode = normalizeNumericIdentifier(codigo);
    if (normalizedCode && !documento) return normalizedCode;

    const identity = await this.resolveStudentCodesForQuery({
      codigo: normalizedCode,
      documento,
      identificador,
    });
    if (!identity.identityConfirmed || identity.ambiguous) return null;
    if (normalizedCode) return identity.codes.includes(normalizedCode) ? normalizedCode : null;
    return identity.codes.length === 1 ? identity.codes[0] : null;
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

  async lookupStudentRecordsByDocument(documento) {
    const normalizedDocument = normalizeNumericIdentifier(documento);
    if (!normalizedDocument) return { records: [], codes: [] };

    const response = await this.requestAcademicData(
      this.academicServicePath(`datos_basicos_activos_cedula/${normalizedDocument}`)
    );
    const records = extractStudentRecords(response).filter((record) => {
      const recordDocument = getStudentRecordDocument(record);
      return !recordDocument || recordDocument === normalizedDocument;
    });
    const codes = [
      ...new Set(
        records.map((record) => normalizeNumericIdentifier(record?.codigo)).filter(Boolean)
      ),
    ];

    return { records, codes };
  }

  async lookupStudentRecordsByCode(codigo) {
    const normalizedCode = normalizeNumericIdentifier(codigo);
    if (!normalizedCode) return { records: [], codes: [] };

    const response = await this.requestAcademicData(
      this.academicServicePath(`datos_basicos_estudiante/${normalizedCode}`)
    );
    const records = extractStudentRecords(response).filter(
      (record) => normalizeNumericIdentifier(record?.codigo) === normalizedCode
    );

    return { records, codes: records.length ? [normalizedCode] : [] };
  }

  async resolveStudentCodesForQuery({ codigo, codigos = [], documento, identificador } = {}) {
    const suppliedCodes = [
      ...new Set([codigo, ...codigos].map(normalizeNumericIdentifier).filter(Boolean)),
    ];
    let codes = new Set();
    const errors = [];
    let normalizedDocument = normalizeNumericIdentifier(documento);
    let identityConfirmed = false;
    let ambiguous = false;
    let studentRecord = null;

    if (normalizedDocument) {
      try {
        const lookup = await this.lookupStudentRecordsByDocument(normalizedDocument);
        codes = new Set(lookup.codes);
        studentRecord =
          lookup.records.find((record) =>
            suppliedCodes.includes(normalizeNumericIdentifier(record?.codigo))
          ) ||
          lookup.records.at(-1) ||
          null;
        identityConfirmed = codes.size > 0;
        suppliedCodes
          .filter((code) => !codes.has(code))
          .forEach(() =>
            errors.push({
              stage: 'identity',
              code: 'STUDENT_CODE_DOCUMENT_ASSOCIATION_UNCONFIRMED',
              message: 'Uno o más códigos no aparecen asociados al documento en OAS.',
            })
          );
        if (!identityConfirmed) {
          errors.push({
            stage: 'identity',
            code: 'STUDENT_RECORD_NOT_FOUND',
            message: 'No fue posible confirmar códigos académicos asociados al documento.',
          });
        }
      } catch (error) {
        errors.push({
          stage: 'identity',
          code: error?.code || 'ACADEMIC_LOOKUP_FAILED',
          message: 'No fue posible verificar los códigos académicos asociados al documento.',
        });
      }
    } else if (suppliedCodes.length) {
      const discoveredDocuments = new Set();
      for (const code of suppliedCodes) {
        try {
          const lookup = await this.lookupStudentRecordsByCode(code);
          lookup.records
            .map(getStudentRecordDocument)
            .filter(Boolean)
            .forEach((recordDocument) => discoveredDocuments.add(recordDocument));
        } catch (error) {
          errors.push({
            stage: 'identity',
            code: error?.code || 'ACADEMIC_LOOKUP_FAILED',
            message: 'No fue posible verificar el documento asociado al código académico.',
          });
        }
      }

      if (discoveredDocuments.size > 1) {
        ambiguous = true;
        errors.push({
          stage: 'identity',
          code: 'AMBIGUOUS_STUDENT_IDENTITY',
          message: 'Los códigos consultados no corresponden a una única persona verificable.',
        });
      } else if (discoveredDocuments.size === 1) {
        [normalizedDocument] = discoveredDocuments;
        try {
          const lookup = await this.lookupStudentRecordsByDocument(normalizedDocument);
          codes = new Set(lookup.codes);
          studentRecord =
            lookup.records.find((record) =>
              suppliedCodes.includes(normalizeNumericIdentifier(record?.codigo))
            ) ||
            lookup.records.at(-1) ||
            null;
          identityConfirmed = codes.size > 0;
          suppliedCodes
            .filter((code) => !codes.has(code))
            .forEach(() =>
              errors.push({
                stage: 'identity',
                code: 'STUDENT_CODE_DOCUMENT_ASSOCIATION_UNCONFIRMED',
                message: 'Uno o más códigos no aparecen asociados al documento en OAS.',
              })
            );
          if (!identityConfirmed) {
            errors.push({
              stage: 'identity',
              code: 'STUDENT_RECORD_NOT_FOUND',
              message: 'No fue posible confirmar los códigos asociados al documento.',
            });
          }
        } catch (error) {
          errors.push({
            stage: 'identity',
            code: error?.code || 'ACADEMIC_LOOKUP_FAILED',
            message: 'No fue posible verificar los códigos académicos asociados al documento.',
          });
        }
      } else {
        errors.push({
          stage: 'identity',
          code: 'STUDENT_DOCUMENT_NOT_FOUND',
          message: 'No fue posible verificar el documento asociado al código académico.',
        });
      }
      if (!normalizedDocument) codes = new Set();
    } else {
      const lookupValue = normalizeNumericIdentifier(identificador);
      if (lookupValue) {
        const [codeLookup, documentLookup] = await Promise.allSettled([
          this.lookupStudentRecordsByCode(lookupValue),
          this.lookupStudentRecordsByDocument(lookupValue),
        ]);
        const codeRecords = codeLookup.status === 'fulfilled' ? codeLookup.value.records : [];
        const documentRecords =
          documentLookup.status === 'fulfilled' ? documentLookup.value.records : [];
        const candidateDocuments = new Set(
          codeRecords.map(getStudentRecordDocument).filter(Boolean)
        );
        documentRecords
          .map(getStudentRecordDocument)
          .filter(Boolean)
          .forEach((recordDocument) => candidateDocuments.add(recordDocument));
        if (documentRecords.length && !candidateDocuments.size) {
          candidateDocuments.add(lookupValue);
        }

        if (codeLookup.status === 'rejected' || documentLookup.status === 'rejected') {
          const failedLookup = codeLookup.status === 'rejected' ? codeLookup : documentLookup;
          errors.push({
            stage: 'identity',
            code: failedLookup.reason?.code || 'ACADEMIC_LOOKUP_FAILED',
            message: 'No fue posible completar la verificación de identidad en OAS.',
          });
        }

        if (candidateDocuments.size > 1) {
          ambiguous = true;
          errors.push({
            stage: 'identity',
            code: 'AMBIGUOUS_STUDENT_IDENTITY',
            message: 'El identificador coincide con más de una persona en OAS.',
          });
        } else if (candidateDocuments.size === 1 || documentRecords.length) {
          normalizedDocument = [...candidateDocuments][0] || lookupValue;
          try {
            const relatedLookup =
              documentLookup.status === 'fulfilled' &&
              normalizedDocument === lookupValue &&
              documentRecords.length
                ? documentLookup.value
                : await this.lookupStudentRecordsByDocument(normalizedDocument);
            const codeLookupCodes = new Set(
              codeRecords
                .map((record) => normalizeNumericIdentifier(record?.codigo))
                .filter(Boolean)
            );
            codes = new Set(relatedLookup.codes);
            studentRecord =
              relatedLookup.records.find((record) =>
                codeLookupCodes.has(normalizeNumericIdentifier(record?.codigo))
              ) ||
              relatedLookup.records.at(-1) ||
              null;
            identityConfirmed = codes.size > 0;
            if ([...codeLookupCodes].some((code) => !codes.has(code))) {
              errors.push({
                stage: 'identity',
                code: 'STUDENT_CODE_DOCUMENT_ASSOCIATION_UNCONFIRMED',
                message: 'El código no aparece asociado al documento en OAS.',
              });
            }
            if (!identityConfirmed) {
              errors.push({
                stage: 'identity',
                code: 'STUDENT_RECORD_NOT_FOUND',
                message: 'No se encontraron códigos académicos asociados al estudiante.',
              });
            }
          } catch (error) {
            errors.push({
              stage: 'identity',
              code: error?.code || 'ACADEMIC_LOOKUP_FAILED',
              message: 'No fue posible consultar los códigos asociados al documento.',
            });
          }
        } else {
          errors.push({
            stage: 'identity',
            code: 'STUDENT_RECORD_NOT_FOUND',
            message: 'No se encontró una asociación académica verificable para el identificador.',
          });
        }
      }
    }

    if (!normalizedDocument && !codes.size && !errors.length) {
      errors.push({
        stage: 'identity',
        code: 'STUDENT_IDENTIFIER_INVALID',
        message: 'No se recibió un código o documento válido para la consulta.',
      });
    }

    return {
      codes: [...codes],
      document: normalizedDocument || null,
      studentRecord,
      identityConfirmed,
      ambiguous,
      errors,
    };
  }

  async queryStudent({ codigo, codigos = [], documento, identificador } = {}) {
    const emptyResult = {
      status: 'not_configured',
      debts: [],
      codes: [],
      document: normalizeNumericIdentifier(documento) || null,
      studentRecord: null,
      nonLaboratoryCount: 0,
      unclassifiedCount: 0,
      errors: [],
      message: '',
    };
    if (!this.isConfigured()) {
      emptyResult.message = getSgaQueryMessage(emptyResult);
      return emptyResult;
    }

    const identity = await this.resolveStudentCodesForQuery({
      codigo,
      codigos,
      documento,
      identificador,
    });
    const result = {
      ...emptyResult,
      status: 'unresolved',
      codes: identity.codes,
      document: identity.document,
      studentRecord: identity.studentRecord,
      errors: identity.errors,
    };

    if (identity.ambiguous || !identity.codes.length) {
      result.status = identity.errors.some(
        (error) => error.code === 'OATI_UNAVAILABLE' || error.code.endsWith('_FAILED')
      )
        ? 'error'
        : 'unresolved';
      result.message = getSgaQueryMessage(result);
      return result;
    }

    const queried = await Promise.all(
      identity.codes.map(async (code) => {
        try {
          return { code, debts: await this.fetchDebtsByStudentCode(code) };
        } catch (error) {
          return {
            code,
            error: {
              stage: 'sga',
              code: error?.code || 'SGA_QUERY_FAILED',
              message: 'No fue posible consultar las multas asociadas a un código académico.',
            },
          };
        }
      })
    );

    const debtFingerprints = new Set();
    const debts = [];
    let successfulQueries = 0;
    let nonLaboratoryCount = 0;
    let unclassifiedCount = 0;
    const errors = [...identity.errors];

    queried.forEach(({ code, debts: codeDebts, error }) => {
      if (error) {
        errors.push(error);
        return;
      }
      successfulQueries += 1;

      codeDebts.forEach((debt) => {
        if (!this.isActiveDebt(debt) || this.isLibraryDebt(debt)) return;

        const debtCode = normalizeNumericIdentifier(debt?.DEU_EST_COD);
        if (debtCode && debtCode !== code) {
          unclassifiedCount += 1;
          errors.push({
            stage: 'sga',
            code: 'SGA_STUDENT_CODE_MISMATCH',
            message: 'SGA devolvió una multa asociada a un código diferente al consultado.',
          });
          return;
        }

        const conceptName = getSgaConceptName(debt);
        if (!conceptName) {
          unclassifiedCount += 1;
          return;
        }
        if (!isLaboratoryConceptName(conceptName)) {
          nonLaboratoryCount += 1;
          return;
        }

        const fingerprint = getSgaDebtFingerprint(debt);
        if (debtFingerprints.has(fingerprint)) return;
        debtFingerprints.add(fingerprint);
        debts.push(normalizeSgaDebt(debt, code));
      });
    });

    const hasQueryFailures = successfulQueries < identity.codes.length;
    const hasIncompleteIdentity = !identity.identityConfirmed;
    result.debts = debts;
    result.nonLaboratoryCount = nonLaboratoryCount;
    result.unclassifiedCount = unclassifiedCount;
    result.errors = errors;
    if (successfulQueries === 0) {
      result.status = 'error';
    } else if (
      hasQueryFailures ||
      hasIncompleteIdentity ||
      unclassifiedCount > 0 ||
      identity.errors.length > 0
    ) {
      result.status = 'partial';
    } else {
      result.status = debts.length ? 'found' : 'clear';
    }

    result.message = getSgaQueryMessage(result);
    return result;
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
  getSgaConceptName,
  getSgaQueryMessage,
  isLaboratoryConceptName,
  normalizeSgaDebt,
  sgaDebtService,
  resolveSgaConceptName,
};
