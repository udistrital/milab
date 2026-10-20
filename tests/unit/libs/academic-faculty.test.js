const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FACULTY_KEYS,
  resolveFacultyKeyFromName,
  resolveFacultyKeyFromStudentCode,
  resolveStudentFacultyKey,
} = require('../../../src/libs/academic-faculty');

test('academic faculty resolves faculty keys from catalog names', () => {
  assert.equal(
    resolveFacultyKeyFromName('FACULTAD DE TECNOLOGIA - POLITECNICA / TECNOLOGICA'),
    FACULTY_KEYS.TECNOLOGICA
  );
  assert.equal(
    resolveFacultyKeyFromName('Facultad de Medio Ambiente'),
    FACULTY_KEYS.MEDIO_AMBIENTE
  );
  assert.equal(
    resolveFacultyKeyFromName('FACULTAD DE CIENCIAS MATEMÁTICAS Y NATURALES'),
    FACULTY_KEYS.MATEMATICAS
  );
  assert.equal(
    resolveFacultyKeyFromName('FACULTAD DE CIENCIAS Y EDUCACION'),
    FACULTY_KEYS.EDUCACION
  );
  assert.equal(resolveFacultyKeyFromName('FACULTAD DE ARTES - ASAB'), FACULTY_KEYS.ASAB);
  assert.equal(resolveFacultyKeyFromName('FACULTAD DE INGENIERIA'), FACULTY_KEYS.INGENIERIA);
  assert.equal(resolveFacultyKeyFromName(''), null);
});

test('academic faculty resolves faculty keys from 11 digit student codes', () => {
  assert.equal(resolveFacultyKeyFromStudentCode('20231077001'), FACULTY_KEYS.TECNOLOGICA);
  assert.equal(resolveFacultyKeyFromStudentCode('20231005001'), FACULTY_KEYS.INGENIERIA);
  assert.equal(resolveFacultyKeyFromStudentCode('20231090001'), FACULTY_KEYS.SALUD);
  assert.equal(resolveFacultyKeyFromStudentCode('12345'), null);
  assert.equal(resolveFacultyKeyFromStudentCode('20231999001'), null);
});

test('academic faculty falls back to the program name when the code is not usable', () => {
  assert.equal(
    resolveStudentFacultyKey({ codigo: '20231077001', carrera: 'Ingeniería Forestal' }),
    FACULTY_KEYS.TECNOLOGICA
  );
  assert.equal(
    resolveStudentFacultyKey({ codigo: '', carrera: 'Ingeniería Civil' }),
    FACULTY_KEYS.TECNOLOGICA
  );
});
