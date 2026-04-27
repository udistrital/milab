const test = require('node:test');
const assert = require('node:assert/strict');

const {
  canonicalizeFacultyName,
  normalizeAcademicText,
  OFFICIAL_FACULTY_NAMES,
  resolveAcademicFacultyName,
  resolveCoordinatorFacultyNames,
  resolveCoordinatorScope,
} = require('../../../src/libs/faculty-scope');

test('normalizeAcademicText removes accents, symbols and repeated spaces', () => {
  assert.equal(
    normalizeAcademicText('  Ingeniería   Ambiental / Énfasis  '),
    'INGENIERIA AMBIENTAL ENFASIS'
  );
});

test('canonicalizeFacultyName maps known aliases to official names', () => {
  assert.equal(
    canonicalizeFacultyName('Facultad del Medio Ambiente'),
    OFFICIAL_FACULTY_NAMES.VIVERO
  );
  assert.equal(canonicalizeFacultyName('Sede Tecnológica'), OFFICIAL_FACULTY_NAMES.TECNOLOGICA);
  assert.equal(canonicalizeFacultyName('Nombre desconocido'), null);
});

test('resolveAcademicFacultyName maps known academic programs', () => {
  assert.equal(resolveAcademicFacultyName('Ingeniería Ambiental'), OFFICIAL_FACULTY_NAMES.VIVERO);
  assert.equal(
    resolveAcademicFacultyName('Ingeniería en Telecomunicaciones'),
    OFFICIAL_FACULTY_NAMES.TECNOLOGICA
  );
  assert.equal(resolveAcademicFacultyName('Licenciatura en Arte'), null);
});

test('resolveCoordinatorScope returns unique faculty ids and falls back to primary faculty', async () => {
  const queries = [];
  const client = {
    async query(query, values) {
      queries.push({ query, values });

      if (queries.length === 1) {
        return { rows: [{ documento: '1024467835', id_facultad: 7 }] };
      }

      return { rows: [] };
    },
  };

  const result = await resolveCoordinatorScope(client, 'acmendeza');

  assert.deepEqual(result, {
    coordinatorDocument: '1024467835',
    facultyIds: [7],
  });
});

test('resolveCoordinatorFacultyNames resolves and canonicalizes faculty names', async () => {
  let step = 0;
  const client = {
    async query() {
      step += 1;

      if (step === 1) {
        return { rows: [{ documento: '1024467835', id_facultad: 2 }] };
      }

      if (step === 2) {
        return { rows: [{ id_facultad: 2 }, { id_facultad: 1 }, { id_facultad: 2 }] };
      }

      return {
        rows: [{ nombre: 'Sede Tecnológica' }, { nombre: 'Facultad del Medio Ambiente' }],
      };
    },
  };

  const result = await resolveCoordinatorFacultyNames(client, 'acmendeza');

  assert.deepEqual(result, [OFFICIAL_FACULTY_NAMES.TECNOLOGICA, OFFICIAL_FACULTY_NAMES.VIVERO]);
});
