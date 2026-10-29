const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ESTADOS_MANTENIMIENTO_EDITABLES,
  ESTADOS_MANTENIMIENTO_CIERRE,
  esEstadoMantenimientoEditable,
  esEstadoMantenimientoCierre,
  etiquetaEstadoMantenimiento,
} = require('../../../src/libs/hojas-vida-mantenimientos');

test('mantenimiento: solo Programado y En ejecucion son editables (CA01/CA03)', () => {
  assert.deepEqual(ESTADOS_MANTENIMIENTO_EDITABLES, ['PENDIENTE', 'EN_EJECUCION']);
  assert.equal(esEstadoMantenimientoEditable('PENDIENTE'), true);
  assert.equal(esEstadoMantenimientoEditable('EN_EJECUCION'), true);
  assert.equal(esEstadoMantenimientoEditable('CUMPLIDO'), false);
  assert.equal(esEstadoMantenimientoEditable('CANCELADO'), false);
});

test('mantenimiento: Cumplido y Cancelado son estados de cierre (CA02)', () => {
  assert.deepEqual(ESTADOS_MANTENIMIENTO_CIERRE, ['CUMPLIDO', 'CANCELADO']);
  assert.equal(esEstadoMantenimientoCierre('CUMPLIDO'), true);
  assert.equal(esEstadoMantenimientoCierre('CANCELADO'), true);
  assert.equal(esEstadoMantenimientoCierre('EN_EJECUCION'), false);
  assert.equal(esEstadoMantenimientoCierre('PENDIENTE'), false);
});

test('mantenimiento: la etiqueta visible de EN_EJECUCION es "En ejecución"', () => {
  assert.equal(etiquetaEstadoMantenimiento('EN_EJECUCION'), 'En ejecución');
  assert.equal(etiquetaEstadoMantenimiento('CUMPLIDO'), 'Cumplido');
});
