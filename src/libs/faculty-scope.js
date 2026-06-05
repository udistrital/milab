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
    'SELECT documento FROM coordinador WHERE nombre_u = $1',
    [authDocument]
  );

  if (coordInfoRes.rows.length === 0) {
    return {
      coordinatorDocument: null,
      facultyIds: [],
    };
  }

  const coordinatorDocument = coordInfoRes.rows[0].documento;
  const facultiesRes = await client.query(
    'SELECT facultad_id FROM coordinador_facultad WHERE coordinador_documento_id = $1',
    [coordinatorDocument]
  );

  const facultyIds = facultiesRes.rows.map((row) => Number(row.facultad_id)).filter(Boolean);

  return {
    coordinatorDocument,
    facultyIds: [...new Set(facultyIds)],
  };
}

async function resolveCoordinatorFacultyNames(client, authDocument) {
  const scope = await resolveCoordinatorScope(client, authDocument);

  if (scope.facultyIds.length === 0) {
    return [];
  }

  const result = await client.query(
    'SELECT nombre FROM facultad WHERE facultad_id = ANY($1::int[])',
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
};
