const pool = require('./db');
const { normalizeRoles } = require('./roles');

let operationalRoleAssignmentSchemaEnsured = false;

async function ensureOperationalRoleAssignmentsSchema(executor = pool) {
  if (operationalRoleAssignmentSchemaEnsured) return;
  const result = await executor.query(
    `SELECT to_regclass('milab.usuario_ual_rol_operativo') AS table_name`
  );
  if (!result.rows[0]?.table_name) {
    throw new Error(
      'No existe milab.usuario_ual_rol_operativo. La tabla debe aprovisionarse con un usuario administrador de base de datos.'
    );
  }
  operationalRoleAssignmentSchemaEnsured = true;
}

async function fetchOperationalRoleAssignmentsByUserId(userId, roleName, executor = pool) {
  await ensureOperationalRoleAssignmentsSchema(executor);

  const normalizedUserId = Number(userId);
  const normalizedRoleName = String(roleName || '')
    .trim()
    .toLowerCase();
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0 || !normalizedRoleName) {
    return [];
  }

  const result = await executor.query(
    `
      SELECT
        a.id,
        a.usuario_id,
        a.ual_id,
        u.nombre AS ual_nombre,
        u.facultad_id,
        f.nombre AS facultad_nombre
      FROM usuario_ual_rol_operativo a
      JOIN rol r
        ON r.id = a.rol_id
      JOIN ual u
        ON u.ual_id = a.ual_id
       AND u.activo = TRUE
      LEFT JOIN dependencia_facultad f
        ON f.dependencia_facultad_id = u.facultad_id
      WHERE a.usuario_id = $1
        AND r.nombre = $2
        AND a.activo = TRUE
      ORDER BY f.nombre ASC NULLS LAST, u.nombre ASC
    `,
    [normalizedUserId, normalizedRoleName]
  );

  return result.rows || [];
}

async function fetchOperationalRoleScopeByUser(user, roleName, executor = pool) {
  const roles = normalizeRoles(user?.roles || user?.tipo);
  const normalizedRoleName = String(roleName || '')
    .trim()
    .toLowerCase();

  if (!normalizedRoleName || !roles.includes(normalizedRoleName)) {
    return {
      role: normalizedRoleName || null,
      facultyIds: [],
      laboratoryNames: [],
      ualIds: [],
    };
  }

  const assignments = await fetchOperationalRoleAssignmentsByUserId(
    user?.id,
    normalizedRoleName,
    executor
  );

  return {
    role: normalizedRoleName,
    facultyIds: Array.from(
      new Set(
        assignments
          .map((item) => Number(item.facultad_id))
          .filter((item) => Number.isInteger(item) && item > 0)
      )
    ),
    laboratoryNames: Array.from(
      new Set(
        assignments
          .map((item) => (item.ual_nombre || '').toString().trim().toUpperCase())
          .filter(Boolean)
      )
    ),
    ualIds: Array.from(
      new Set(
        assignments
          .map((item) => Number(item.ual_id))
          .filter((item) => Number.isInteger(item) && item > 0)
      )
    ),
  };
}

async function replaceOperationalRoleAssignments({
  userId,
  roleName,
  ualIds,
  facultyId = null,
  createdByUserId = null,
  purgeWhenEmpty = false,
  client = pool,
}) {
  await ensureOperationalRoleAssignmentsSchema(client);

  const normalizedUserId = Number(userId);
  const normalizedCreatedByUserId = Number(createdByUserId);
  const normalizedFacultyId = Number(facultyId);
  const normalizedRoleName = String(roleName || '')
    .trim()
    .toLowerCase();
  const normalizedUalIds = Array.from(
    new Set(
      (ualIds || [])
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0)
    )
  );

  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0 || !normalizedRoleName) {
    return;
  }

  if (!normalizedUalIds.length && purgeWhenEmpty) {
    await client.query(
      `DELETE FROM usuario_ual_rol_operativo
       WHERE usuario_id = $1
         AND rol_id = (SELECT id FROM rol WHERE nombre = $2 LIMIT 1)`,
      [normalizedUserId, normalizedRoleName]
    );
    return;
  }

  await client.query(
    `
      UPDATE usuario_ual_rol_operativo
      SET activo = FALSE,
          fecha_modificacion = CURRENT_TIMESTAMP
      WHERE usuario_id = $1
        AND rol_id = (SELECT id FROM rol WHERE nombre = $2 LIMIT 1)
        AND (
          $3::int IS NULL
          OR EXISTS (
            SELECT 1
            FROM ual u_scope
            WHERE u_scope.ual_id = usuario_ual_rol_operativo.ual_id
              AND u_scope.facultad_id = $3::int
          )
        )
    `,
    [
      normalizedUserId,
      normalizedRoleName,
      Number.isInteger(normalizedFacultyId) && normalizedFacultyId > 0 ? normalizedFacultyId : null,
    ]
  );

  if (!normalizedUalIds.length) {
    return;
  }

  await client.query(
    `
      INSERT INTO usuario_ual_rol_operativo (
        usuario_id,
        rol_id,
        ual_id,
        creado_por_id,
        activo
      )
      SELECT
        $1,
        r.id,
        UNNEST($3::int[]),
        $4,
        TRUE
      FROM rol r
      WHERE r.nombre = $2
      ON CONFLICT (usuario_id, rol_id, ual_id) DO UPDATE
      SET activo = TRUE,
          creado_por_id = EXCLUDED.creado_por_id,
          fecha_modificacion = CURRENT_TIMESTAMP
    `,
    [
      normalizedUserId,
      normalizedRoleName,
      normalizedUalIds,
      Number.isInteger(normalizedCreatedByUserId) && normalizedCreatedByUserId > 0
        ? normalizedCreatedByUserId
        : null,
    ]
  );
}

module.exports = {
  ensureOperationalRoleAssignmentsSchema,
  fetchOperationalRoleAssignmentsByUserId,
  fetchOperationalRoleScopeByUser,
  replaceOperationalRoleAssignments,
};
