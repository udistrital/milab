const test = require('node:test');
const assert = require('node:assert/strict');

const {
  canonicalizeFacultyName,
  normalizeAcademicText,
  OFFICIAL_FACULTY_NAMES,
  resolveAcademicFacultyName,
  resolveCoordinatorFacultyNames,
  resolveCoordinatorScope,
  coordinatorScopeAllowsUal,
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

test('resolveCoordinatorScope returns unique faculty ids from institutional assignments', async () => {
  const queries = [];
  const client = {
    async query(query, values) {
      queries.push({ query, values });

      if (queries.length === 1) {
        return { rows: [{ documento: '1024467835', nombre_u: 'acmendeza', usuario_id: null }] };
      }

      if (query.includes('to_regclass')) {
        return { rows: [{ table_name: 'milab.usuario_ual_rol_operativo' }] };
      }
      if (query.includes('FROM usuario')) return { rows: [] };
      if (query.includes('usuario_ual_rol_operativo')) return { rows: [] };
      return { rows: [{ facultad_id: 7 }, { facultad_id: 7 }] };
    },
  };

  const result = await resolveCoordinatorScope(client, 'acmendeza');

  assert.deepEqual(result, {
    coordinatorDocument: '1024467835',
    scopeType: 'institucional',
    facultyIds: [7],
    ualIds: [],
  });
});

test('resolveCoordinatorScope gives active UAL assignments precedence over institutional scope', async () => {
  const client = {
    async query(query) {
      if (query.includes('FROM coordinador')) {
        return {
          rows: [{ documento: '1024467835', nombre_u: 'acmendeza', usuario_id: 12 }],
        };
      }
      if (query.includes('to_regclass')) {
        return { rows: [{ table_name: 'milab.usuario_ual_rol_operativo' }] };
      }
      if (query.includes('usuario_ual_rol_operativo')) {
        return {
          rows: [
            { ual_id: 5, facultad_id: 7, ual_activo: true, assignment_active: true },
            { ual_id: 5, facultad_id: 7, ual_activo: true, assignment_active: true },
            { ual_id: 6, facultad_id: 7, ual_activo: false, assignment_active: true },
          ],
        };
      }
      assert.fail('A UAL-scoped coordinator must not fall back to institutional assignments');
    },
  };

  const result = await resolveCoordinatorScope(client, 'acmendeza');

  assert.deepEqual(result, {
    coordinatorDocument: '1024467835',
    scopeType: 'uales',
    facultyIds: [7],
    ualIds: [5],
  });
  assert.equal(coordinatorScopeAllowsUal(result, 5, 7), true);
  assert.equal(coordinatorScopeAllowsUal(result, 6, 7), false);
});

test('inactive UAL assignments do not fall back to broader institutional access', async () => {
  const client = {
    async query(query) {
      if (query.includes('FROM coordinador')) {
        return {
          rows: [{ documento: '1024467835', nombre_u: 'acmendeza', usuario_id: 12 }],
        };
      }
      if (query.includes('to_regclass')) {
        return { rows: [{ table_name: 'milab.usuario_ual_rol_operativo' }] };
      }
      if (query.includes('usuario_ual_rol_operativo')) {
        return {
          rows: [{ ual_id: 5, facultad_id: 7, ual_activo: true, assignment_active: false }],
        };
      }
      assert.fail('Inactive UAL assignments must not fall back to institutional scope');
    },
  };

  const result = await resolveCoordinatorScope(client, 'acmendeza');
  assert.deepEqual(result, {
    coordinatorDocument: '1024467835',
    scopeType: 'uales',
    facultyIds: [],
    ualIds: [],
  });
});

test('resolveCoordinatorFacultyNames resolves and canonicalizes faculty names', async () => {
  let step = 0;
  const client = {
    async query() {
      step += 1;

      if (step === 1) {
        return {
          rows: [{ documento: '1024467835', nombre_u: 'acmendeza', usuario_id: null }],
        };
      }

      if (step === 2) {
        return { rows: [] };
      }

      if (step === 3) {
        return { rows: [{ facultad_id: 2 }, { facultad_id: 1 }, { facultad_id: 2 }] };
      }
      return { rows: [{ nombre: 'Sede Tecnológica' }, { nombre: 'Facultad del Medio Ambiente' }] };
    },
  };

  const result = await resolveCoordinatorFacultyNames(client, 'acmendeza');

  assert.deepEqual(result, [OFFICIAL_FACULTY_NAMES.TECNOLOGICA, OFFICIAL_FACULTY_NAMES.VIVERO]);
});
