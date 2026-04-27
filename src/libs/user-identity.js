const pool = require('./db');
const { getPrimaryRole, normalizeRoles } = require('./roles');

async function fetchUserByEmail(correo) {
  if (!correo) return null;

  const result = await pool.query(
    `
      SELECT
        u.id,
        u.correo,
        u.documento,
        u.nombre,
        COALESCE(
          ARRAY_REMOVE(ARRAY_AGG(r.name ORDER BY r.name), NULL),
          ARRAY[]::text[]
        ) AS roles
      FROM usuarios u
      LEFT JOIN usuario_roles ur
        ON ur.usuario_id = u.id
       AND ur.activo = TRUE
      LEFT JOIN roles r
        ON r.id = ur.role_id
      WHERE LOWER(u.correo) = LOWER($1)
      GROUP BY u.id
      LIMIT 1
    `,
    [correo]
  );

  return result.rows[0] || null;
}

async function fetchUserById(id) {
  if (!id) return null;

  const result = await pool.query(
    `
      SELECT
        u.id,
        u.correo,
        u.documento,
        u.nombre,
        COALESCE(
          ARRAY_REMOVE(ARRAY_AGG(r.name ORDER BY r.name), NULL),
          ARRAY[]::text[]
        ) AS roles
      FROM usuarios u
      LEFT JOIN usuario_roles ur
        ON ur.usuario_id = u.id
       AND ur.activo = TRUE
      LEFT JOIN roles r
        ON r.id = ur.role_id
      WHERE u.id = $1
      GROUP BY u.id
      LIMIT 1
    `,
    [id]
  );

  return result.rows[0] || null;
}

function buildSessionUser(row) {
  if (!row) return null;
  const roles = normalizeRoles(row.roles);
  const primaryRole = getPrimaryRole(roles);

  return {
    id: row.id,
    correo: row.correo,
    documento: row.documento,
    documento_real: row.documento,
    nombre: row.nombre,
    roles,
    tipo: primaryRole,
  };
}

module.exports = {
  buildSessionUser,
  fetchUserByEmail,
  fetchUserById,
};
