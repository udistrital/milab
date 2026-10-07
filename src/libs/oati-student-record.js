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
 * Consulta deudas SGA para todos los códigos de la misma persona: una deuda con un código
 * anterior (otro programa) también bloquea el paz y salvo. Si SGA falla para cualquier código,
 * se propaga el error para no emitir certificados sin confirmar el estado.
 */
async function getActiveSgaDebtsForStudent(debtService, { codigos = [], documento } = {}) {
  if (!codigos.length) {
    return debtService.getActiveDebts({ documento });
  }

  const debtsByCodigo = await Promise.all(
    codigos.map((codigo) => debtService.getActiveDebts({ codigo, documento }))
  );
  return debtsByCodigo.flat();
}

module.exports = {
  collectStudentCodigos,
  findUsuarioCodigoByDocumento,
  getActiveSgaDebtsForStudent,
  selectStudentRecordForDocumento,
};
