const { ensureOperationalRoleAssignmentsSchema } = require('./operational-role-assignments');

function normalizeAcademicText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

const OFFICIAL_FACULTY_NAMES = {
  VIVERO: 'Vivero',
  TECNOLOGICA: 'Tecnologica',
  PAIBA: 'Paiba',
  ASAB: 'ASAB',
  BOSA: 'Bosa',
  CALLE_34: 'Calle 34',
  CALLE_40: 'Calle 40',
  CALLE_42: 'Calle 42',
  MACARENA: 'Macarena',
};

const facultyAliasRules = [
  {
    officialName: OFFICIAL_FACULTY_NAMES.VIVERO,
    patterns: [
      'VIVERO',
      'FACULTAD VIVERO',
      'SEDE VIVERO',
      'MEDIO AMBIENTE',
      'RECURSOS NATURALES',
      'FACULTAD DEL MEDIO AMBIENTE',
    ],
  },
  {
    officialName: OFFICIAL_FACULTY_NAMES.TECNOLOGICA,
    patterns: ['TECNOLOGICA', 'FACULTAD TECNOLOGICA', 'SEDE TECNOLOGICA'],
  },
  {
    officialName: OFFICIAL_FACULTY_NAMES.PAIBA,
    patterns: ['PAIBA', 'SEDE PAIBA'],
  },
  {
    officialName: OFFICIAL_FACULTY_NAMES.ASAB,
    patterns: ['ASAB'],
  },
  {
    officialName: OFFICIAL_FACULTY_NAMES.BOSA,
    patterns: ['BOSA'],
  },
  {
    officialName: OFFICIAL_FACULTY_NAMES.CALLE_34,
    patterns: ['CALLE 34'],
  },
  {
    officialName: OFFICIAL_FACULTY_NAMES.CALLE_40,
    patterns: ['CALLE 40'],
  },
  {
    officialName: OFFICIAL_FACULTY_NAMES.CALLE_42,
    patterns: ['CALLE 42'],
  },
  {
    officialName: OFFICIAL_FACULTY_NAMES.MACARENA,
    patterns: ['MACARENA'],
  },
];

function canonicalizeFacultyName(value) {
  const normalizedValue = normalizeAcademicText(value);

  if (!normalizedValue) {
    return null;
  }

  const matchingRule = facultyAliasRules.find((rule) =>
    rule.patterns.some((pattern) => normalizedValue.includes(pattern))
  );

  return matchingRule ? matchingRule.officialName : null;
}

const academicProgramRules = [
  {
    facultyName: OFFICIAL_FACULTY_NAMES.VIVERO,
    patterns: [
      'ADMINISTRACION AMBIENTAL',
      'ADMINISTRACION DEPORTIVA',
      'INGENIERIA AMBIENTAL',
      'INGENIERIA FORESTAL',
      'INGENIERIA SANITARIA',
      'INGENIERIA TOPOGRAFICA',
      'GESTION AMBIENTAL',
      'LEVANTAMIENTOS TOPOGRAFICOS',
    ],
  },
  {
    facultyName: OFFICIAL_FACULTY_NAMES.TECNOLOGICA,
    patterns: [
      'INGENIERIA CIVIL',
      'INGENIERIA DE PRODUCCION',
      'INGENIERIA EN TELECOMUNICACIONES',
      'INGENIERIA EN TELEMATICA',
      'INGENIERIA MECANICA',
      'CONSTRUCCIONES CIVILES',
      'ELECTRONICA INDUSTRIAL',
      'GESTION DE LA PRODUCCION INDUSTRIAL',
      'MECANICA INDUSTRIAL',
      'SISTEMATIZACION DE DATOS',
    ],
  },
];

function resolveAcademicFacultyName(programName) {
  const normalizedProgram = normalizeAcademicText(programName);

  if (!normalizedProgram) {
    return null;
  }

  const matchingRule = academicProgramRules.find((rule) =>
    rule.patterns.some((pattern) => normalizedProgram.includes(pattern))
  );

  return matchingRule ? matchingRule.facultyName : null;
}

async function resolveCoordinatorScope(client, authDocument) {
  const coordInfoRes = await client.query(
    `SELECT documento, nombre_u, usuario_id
     FROM coordinador
     WHERE nombre_u = $1 OR documento = $1
     LIMIT 1`,
    [authDocument]
  );

  if (coordInfoRes.rows.length === 0) {
    return {
      coordinatorDocument: null,
      scopeType: null,
      facultyIds: [],
      ualIds: [],
    };
  }

  const coordinator = coordInfoRes.rows[0];
  const coordinatorDocument = coordinator.documento;
  let userId = Number(coordinator.usuario_id);
  if (!Number.isInteger(userId) || userId <= 0) {
    const userResult = await client.query(
      `SELECT id
       FROM usuario
       WHERE documento = $1 OR documento = $2
       LIMIT 1`,
      [coordinatorDocument, coordinator.nombre_u || authDocument]
    );
    userId = Number(userResult.rows[0]?.id);
  }

  if (Number.isInteger(userId) && userId > 0) {
    await ensureOperationalRoleAssignmentsSchema(client);
    const ualAssignments = await client.query(
      `SELECT a.ual_id, a.activo AS assignment_active,
              u.facultad_id, u.activo AS ual_activo
       FROM usuario_ual_rol_operativo a
       JOIN rol r ON r.id = a.rol_id
       JOIN ual u ON u.ual_id = a.ual_id
       WHERE a.usuario_id = $1
         AND r.nombre = 'coordinador'`,
      [userId]
    );

    if (ualAssignments.rows.length) {
      return {
        coordinatorDocument,
        scopeType: 'uales',
        facultyIds: [
          ...new Set(
            ualAssignments.rows
              .filter((row) => row.assignment_active && row.ual_activo)
              .map((row) => Number(row.facultad_id))
              .filter((value) => Number.isInteger(value) && value > 0)
          ),
        ],
        ualIds: [
          ...new Set(
            ualAssignments.rows
              .filter((row) => row.assignment_active && row.ual_activo)
              .map((row) => Number(row.ual_id))
              .filter((value) => Number.isInteger(value) && value > 0)
          ),
        ],
      };
    }
  }

  const facultiesRes = await client.query(
    `SELECT DISTINCT facultad_id
     FROM coordinador_facultad_alcance
     WHERE coordinador_documento_id = $1
       AND activo = TRUE`,
    [coordinatorDocument]
  );

  const facultyIds = facultiesRes.rows
    .map((row) => Number(row.facultad_id))
    .filter((value) => Number.isInteger(value) && value > 0);

  return {
    coordinatorDocument,
    scopeType: 'institucional',
    facultyIds: [...new Set(facultyIds)],
    ualIds: [],
  };
}

function coordinatorScopeAllowsUal(scope, ualId, facultyId) {
  if (scope?.scopeType === 'uales') {
    return scope.ualIds?.includes(Number(ualId)) || false;
  }
  return scope?.facultyIds?.includes(Number(facultyId)) || false;
}

async function resolveCoordinatorFacultyNames(client, authDocument) {
  const scope = await resolveCoordinatorScope(client, authDocument);

  if (scope.facultyIds.length === 0) {
    return [];
  }

  const result = await client.query(
    'SELECT nombre FROM dependencia_facultad WHERE dependencia_facultad_id = ANY($1::int[])',
    [scope.facultyIds]
  );

  return [...new Set(result.rows.map((row) => canonicalizeFacultyName(row.nombre) || row.nombre))];
}

module.exports = {
  OFFICIAL_FACULTY_NAMES,
  canonicalizeFacultyName,
  normalizeAcademicText,
  resolveAcademicFacultyName,
  resolveCoordinatorFacultyNames,
  resolveCoordinatorScope,
  coordinatorScopeAllowsUal,
};
