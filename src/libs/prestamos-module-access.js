const pool = require('./db');
const { resolveCoordinatorScope } = require('./faculty-scope');
const { normalizeRoles } = require('./roles');

function sanitizeText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function isMissingAccessTableError(error) {
  return error?.code === '42P01' || error?.code === '42703';
}

async function resolveLaboratoristaDocument(client, authDocument) {
  const result = await client.query(
    `
      SELECT documento
      FROM laboratorista
      WHERE documento = $1 OR n_usuario = $1
      LIMIT 1
    `,
    [authDocument]
  );

  return result.rows[0]?.documento || null;
}

async function resolveLaboratoristaFacultyIds(client, authDocument) {
  const laboratoristaDocument = await resolveLaboratoristaDocument(client, authDocument);
  if (!laboratoristaDocument) {
    return [];
  }

  const result = await client.query(
    `
      SELECT DISTINCT u.facultad_id AS faculty_id
      FROM laboratorista_ual lu
      JOIN ual u
        ON u.ual_id = lu.ual_id
      WHERE lu.laboratorista_documento_id = $1
        AND lu.activo = TRUE
        AND u.activo = TRUE
        AND u.facultad_id IS NOT NULL
      ORDER BY u.facultad_id ASC
    `,
    [laboratoristaDocument]
  );

  return (result.rows || []).map((row) => Number(row.faculty_id)).filter(Number.isInteger);
}

async function resolvePrestamosRestrictedRoleScope(user, client = pool) {
  const roles = normalizeRoles(user?.roles || user?.tipo);
  const authDocument = sanitizeText(user?.documento_real || user?.documento);

  if (!authDocument) {
    return {
      role: null,
      facultyIds: [],
    };
  }

  if (roles.includes('coordinador')) {
    const scope = await resolveCoordinatorScope(client, authDocument);
    return {
      role: 'coordinador',
      facultyIds: (scope.facultyIds || []).map((item) => Number(item)).filter(Number.isInteger),
    };
  }

  if (roles.includes('laboratorista')) {
    return {
      role: 'laboratorista',
      facultyIds: await resolveLaboratoristaFacultyIds(client, authDocument),
    };
  }

  return {
    role: null,
    facultyIds: [],
  };
}

async function resolveAllowedPrestamosFacultyIdsForRole(facultyIds, role, client = pool) {
  const normalizedFacultyIds = (facultyIds || [])
    .map((item) => Number(item))
    .filter(Number.isInteger);
  if (!normalizedFacultyIds.length || !role) {
    return [];
  }

  try {
    const result = await client.query(
      `
        SELECT facultad_id, permitido
        FROM facultad_modulo_acceso
        WHERE modulo = 'prestamos'
          AND rol = $2
          AND activo = TRUE
          AND facultad_id = ANY($1::int[])
      `,
      [normalizedFacultyIds, role]
    );

    const accessByFaculty = new Map(
      (result.rows || []).map((row) => [Number(row.facultad_id), Boolean(row.permitido)])
    );

    return normalizedFacultyIds.filter((facultyId) => accessByFaculty.get(facultyId) !== false);
  } catch (error) {
    if (isMissingAccessTableError(error)) {
      return normalizedFacultyIds;
    }

    throw error;
  }
}

async function getPrestamosModuleAccess(user, client = pool) {
  const roles = normalizeRoles(user?.roles || user?.tipo);
  if (roles.includes('admin')) {
    return {
      role: 'admin',
      facultyIds: [],
      allowedFacultyIds: [],
      blockedFacultyIds: [],
      blocked: false,
    };
  }

  const restrictedScope = await resolvePrestamosRestrictedRoleScope(user, client);
  if (!restrictedScope.role) {
    return {
      role: null,
      facultyIds: [],
      allowedFacultyIds: [],
      blockedFacultyIds: [],
      blocked: false,
    };
  }

  const allowedFacultyIds = await resolveAllowedPrestamosFacultyIdsForRole(
    restrictedScope.facultyIds,
    restrictedScope.role,
    client
  );

  const blockedFacultyIds = restrictedScope.facultyIds.filter(
    (facultyId) => !allowedFacultyIds.includes(facultyId)
  );

  return {
    role: restrictedScope.role,
    facultyIds: restrictedScope.facultyIds,
    allowedFacultyIds,
    blockedFacultyIds,
    blocked: restrictedScope.facultyIds.length > 0 && allowedFacultyIds.length === 0,
  };
}

async function listPrestamosFacultyAccess(client = pool) {
  try {
    const result = await client.query(
      `
        SELECT
          f.facultad_id,
          f.nombre,
          COALESCE(coord.permitido, TRUE) AS coordinador_permitido,
          COALESCE(lab.permitido, TRUE) AS laboratorista_permitido
        FROM facultad f
        LEFT JOIN facultad_modulo_acceso coord
          ON coord.facultad_id = f.facultad_id
         AND coord.modulo = 'prestamos'
         AND coord.rol = 'coordinador'
         AND coord.activo = TRUE
        LEFT JOIN facultad_modulo_acceso lab
          ON lab.facultad_id = f.facultad_id
         AND lab.modulo = 'prestamos'
         AND lab.rol = 'laboratorista'
         AND lab.activo = TRUE
        WHERE f.activo = TRUE
        ORDER BY f.nombre ASC
      `
    );

    return result.rows || [];
  } catch (error) {
    if (isMissingAccessTableError(error)) {
      const fallback = await client.query(
        `
          SELECT
            facultad_id,
            nombre,
            TRUE AS coordinador_permitido,
            TRUE AS laboratorista_permitido
          FROM facultad
          WHERE activo = TRUE
          ORDER BY nombre ASC
        `
      );

      return fallback.rows || [];
    }

    throw error;
  }
}

async function updatePrestamosFacultyAccess({ facultadId, role, permitido }, client = pool) {
  await client.query(
    `
      INSERT INTO facultad_modulo_acceso (
        facultad_id,
        modulo,
        rol,
        permitido,
        activo
      )
      VALUES ($1, 'prestamos', $2, $3, TRUE)
      ON CONFLICT (facultad_id, modulo, rol) DO UPDATE
      SET permitido = EXCLUDED.permitido,
          activo = TRUE,
          fecha_modificacion = CURRENT_TIMESTAMP
    `,
    [facultadId, role, permitido]
  );
}

function filterPrestamosLinks(items = []) {
  return (items || []).filter((item) => !String(item?.href || '').startsWith('/milab/prestamos'));
}

function removePrestamosNavigation(navigation = {}) {
  return {
    ...navigation,
    primaryLinks: filterPrestamosLinks(navigation.primaryLinks || []),
    accountLinks: filterPrestamosLinks(navigation.accountLinks || []),
    secondaryGroups: (navigation.secondaryGroups || [])
      .map((group) => ({
        ...group,
        items: filterPrestamosLinks(group.items || []),
      }))
      .filter((group) => {
        const normalizedTitle = sanitizeText(group.title).toLowerCase();
        return normalizedTitle !== 'prestamos' && (group.items || []).length > 0;
      }),
  };
}

module.exports = {
  getPrestamosModuleAccess,
  listPrestamosFacultyAccess,
  removePrestamosNavigation,
  resolveAllowedPrestamosFacultyIdsForRole,
  resolvePrestamosRestrictedRoleScope,
  updatePrestamosFacultyAccess,
};
