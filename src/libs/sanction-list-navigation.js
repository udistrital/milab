const SANCTION_LIST_PATH = '/milab/api/get_list_multas';

const SANCTION_LIST_FILTER_FIELDS = Object.freeze([
  'fecha_desde',
  'fecha_hasta',
  'estado_multa',
  'facultad_id',
  'dependencia_id',
  'ual_id',
]);

function buildSanctionListReturnPath(filters = {}, success = '') {
  const params = new URLSearchParams();

  for (const field of SANCTION_LIST_FILTER_FIELDS) {
    const value = filters?.[field];
    if (typeof value !== 'string' && typeof value !== 'number') continue;

    const normalizedValue = String(value).trim();
    if (normalizedValue) params.set(field, normalizedValue);
  }

  if (typeof success === 'string' && success.trim()) {
    params.set('success', success.trim());
  }

  const query = params.toString();
  return query ? `${SANCTION_LIST_PATH}?${query}` : SANCTION_LIST_PATH;
}

module.exports = {
  SANCTION_LIST_PATH,
  SANCTION_LIST_FILTER_FIELDS,
  buildSanctionListReturnPath,
};
