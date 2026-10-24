const pool = require('./db');

function normalizeStudentRecords(records) {
  if (Array.isArray(records)) return records;
  return records ? [records] : [];
}

function normalizeCodigo(value) {
  const codigo = String(value ?? '').trim();
  return /^\d+$/.test(codigo) ? codigo : '';
}

async function findUsuarioCodigoByDocumento(documento) {
  const normalizedDocumento = String(documento || '').trim();
  if (!/^\d+$/.test(normalizedDocumento)) return '';

  const result = await pool.query(
    'SELECT codigo::text AS codigo FROM usuario WHERE documento = $1 LIMIT 1',
    [normalizedDocumento]
  );

  return normalizeCodigo(result?.rows?.[0]?.codigo);
}

/**
 * Elige el registro OATI asociado al estudiante en MILab (usuario.codigo), ya sea por registro
 * o por edición desde el dashboard. Si no hay código asociado o ya no aparece en OATI para esa
 * cédula, conserva el comportamiento histórico: el último registro.
 */
async function selectStudentRecordForDocumento(records, documento) {
  const list = normalizeStudentRecords(records);
  if (!list.length) {
    return { record: undefined, associatedCodigo: '', matchedAssociation: false };
  }

  const lastRecord = list[list.length - 1];
  const associatedCodigo = await findUsuarioCodigoByDocumento(documento);
  const associatedRecord = associatedCodigo
    ? list.find((item) => normalizeCodigo(item?.codigo) === associatedCodigo)
    : undefined;

  return {
    record: associatedRecord || lastRecord,
    associatedCodigo,
    matchedAssociation: Boolean(associatedRecord),
  };
}

function collectStudentCodigos(records, ...extraCodigos) {
  const codigos = [];
  for (const value of [
    ...normalizeStudentRecords(records).map((item) => item?.codigo),
    ...extraCodigos,
  ]) {
    const codigo = normalizeCodigo(value);
    if (codigo && !codigos.includes(codigo)) codigos.push(codigo);
  }
  return codigos;
}

/**
 * Compatibilidad para los flujos que requieren una respuesta concluyente antes de continuar.
 * La consulta centraliza códigos históricos, filtro de laboratorios y deduplicación.
 */
async function getActiveSgaDebtsForStudent(debtService, { codigo, codigos = [], documento } = {}) {
  const query = { codigos, documento };
  if (codigo) query.codigo = codigo;
  const result = await debtService.queryStudent(query);
  if (!['found', 'clear'].includes(result.status)) {
    const error = new Error(
      'No fue posible confirmar completamente las sanciones de laboratorio en SGA.'
    );
    error.code = 'SGA_QUERY_INCOMPLETE';
    error.result = result;
    throw error;
  }
  return result.debts;
}

module.exports = {
  collectStudentCodigos,
  findUsuarioCodigoByDocumento,
  getActiveSgaDebtsForStudent,
  selectStudentRecordForDocumento,
};
