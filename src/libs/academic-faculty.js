const facultyScope = require('./faculty-scope');

function normalizeAcademicText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

const FACULTY_KEYS = Object.freeze({
  MEDIO_AMBIENTE: 'MEDIO_AMBIENTE',
  INGENIERIA: 'INGENIERIA',
  SALUD: 'SALUD',
  ASAB: 'ASAB',
  EDUCACION: 'EDUCACION',
  TECNOLOGICA: 'TECNOLOGICA',
  MATEMATICAS: 'MATEMATICAS',
});

// Mismo orden y códigos de proyecto curricular que determinarFacultad (get-data.js).
const PROGRAM_CODES_BY_FACULTY = [
  [
    FACULTY_KEYS.MEDIO_AMBIENTE,
    [
      1, 2, 3, 4, 10, 14, 21, 24, 30, 31, 32, 33, 80, 81, 85, 110, 114, 131, 180, 181, 185, 186,
      481, 485, 607, 710, 732, 780, 781, 785,
    ],
  ],
  [FACULTY_KEYS.INGENIERIA, [5, 7, 15, 20, 22, 25, 27, 28, 295, 395, 495, 595, 695, 700]],
  [FACULTY_KEYS.SALUD, [27, 28, 90, 93]],
  [FACULTY_KEYS.ASAB, [11, 12, 16, 96, 97, 98, 102, 103, 104]],
  [
    FACULTY_KEYS.EDUCACION,
    [
      52, 53, 135, 140, 145, 150, 155, 160, 164, 165, 187, 188, 245, 255, 260, 265, 287, 288, 952,
      953,
    ],
  ],
  [
    FACULTY_KEYS.TECNOLOGICA,
    [
      77, 78, 79, 272, 372, 373, 374, 375, 377, 378, 379, 383, 572, 573, 574, 577, 578, 579, 583,
      673, 677, 678, 772, 773, 774, 777, 778, 779, 872, 873, 874, 877, 878, 879, 972, 973, 974, 977,
      978, 979,
    ],
  ],
  [FACULTY_KEYS.MATEMATICAS, [107, 108, 109, 167]],
];

const FACULTY_NAME_RULES = [
  [FACULTY_KEYS.MEDIO_AMBIENTE, ['MEDIO AMBIENTE', 'RECURSOS NATURALES', 'VIVERO']],
  [FACULTY_KEYS.TECNOLOGICA, ['TECNOLOGICA', 'TECNOLOGIA', 'POLITECNICA']],
  [FACULTY_KEYS.ASAB, ['ASAB', 'ARTES']],
  [FACULTY_KEYS.SALUD, ['SALUD']],
  [FACULTY_KEYS.MATEMATICAS, ['MATEMATICAS Y NATURALES']],
  [FACULTY_KEYS.EDUCACION, ['CIENCIAS Y EDUCACION', 'EDUCACION']],
  [FACULTY_KEYS.INGENIERIA, ['INGENIERIA']],
];

const LEGACY_PROGRAM_FACULTY_KEYS = {
  Vivero: FACULTY_KEYS.MEDIO_AMBIENTE,
  Tecnologica: FACULTY_KEYS.TECNOLOGICA,
};

function resolveFacultyKeyFromName(name) {
  const normalized = normalizeAcademicText(name);
  if (!normalized) return null;

  const match = FACULTY_NAME_RULES.find(([, patterns]) =>
    patterns.some((pattern) => normalized.includes(pattern))
  );
  return match ? match[0] : null;
}

// Códigos estudiantiles UD de 11 dígitos: AAAA + periodo + proyecto (3) + consecutivo (3).
function resolveFacultyKeyFromStudentCode(codigo) {
  const digits = String(codigo ?? '').trim();
  if (!/^\d{11}$/.test(digits)) return null;

  const programCode = Number(digits.slice(5, 8));
  const match = PROGRAM_CODES_BY_FACULTY.find(([, codes]) => codes.includes(programCode));
  return match ? match[0] : null;
}

function resolveStudentFacultyKey({ codigo, carrera } = {}) {
  const byCode = resolveFacultyKeyFromStudentCode(codigo);
  if (byCode) return byCode;

  const legacyName = facultyScope.resolveAcademicFacultyName(carrera || '');
  return LEGACY_PROGRAM_FACULTY_KEYS[legacyName] || null;
}

module.exports = {
  FACULTY_KEYS,
  resolveFacultyKeyFromName,
  resolveFacultyKeyFromStudentCode,
  resolveStudentFacultyKey,
};
