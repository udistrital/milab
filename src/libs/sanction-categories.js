const pool = require('./db');

async function fetchSanctionCategories({ activeOnly = true, client = pool } = {}) {
  const result = await client.query(
    `SELECT id, nombre, descripcion, activo
     FROM categoria_sancion
     ${activeOnly ? 'WHERE activo = TRUE' : ''}
     ORDER BY nombre ASC, id ASC`
  );
  return result.rows;
}

async function isActiveSanctionCategory(value, client = pool) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 500) return false;
  const result = await client.query(
    'SELECT id FROM categoria_sancion WHERE descripcion = $1 AND activo = TRUE LIMIT 1',
    [value.trim()]
  );
  return result.rows.length > 0;
}

module.exports = { fetchSanctionCategories, isActiveSanctionCategory };
