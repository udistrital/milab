const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.resolve(__dirname, '../../../src/public/js/inventory-location-filters.js'),
  'utf8'
);

function setup(role = 'admin', initial = {}) {
  function select(id, rows) {
    return {
      value: initial[id] || '',
      options: [{ value: '', textContent: 'Todas' }, ...rows],
      listeners: {},
      replaceChildren(...options) {
        this.options = options;
      },
      addEventListener(event, handler) {
        this.listeners[event] = handler;
      },
    };
  }
  const option = (value, facultyId, dependencyId = '') => ({
    value,
    dataset: { facultyId, dependencyId },
  });
  const controls = {
    '#inventory-faculty': ['admin', 'coordinador_general'].includes(role)
      ? select('faculty', [option('1'), option('2'), option('3')])
      : null,
    '#inventory-dependency':
      role !== 'laboratorista'
        ? select('dependency', [option('10', '1'), option('11', '1'), option('20', '2')])
        : null,
    '#ual_id': select('laboratory', [
      option('100', '1', '10'),
      option('200', '2', '20'),
      option('300', '1'),
    ]),
  };
  vm.runInNewContext(source, {
    document: {
      getElementById: () => ({ querySelector: (selector) => controls[selector] }),
    },
  });
  return {
    faculty: controls['#inventory-faculty'],
    dependency: controls['#inventory-dependency'],
    laboratory: controls['#ual_id'],
  };
}

function values(select) {
  return select.options.map((option) => option.value);
}

test('global inventory viewers cascade faculty, dependency and UAL and clear descendants', () => {
  for (const role of ['admin', 'coordinador_general']) {
    const c = setup(role);
    c.faculty.value = '1';
    c.faculty.listeners.change();
    assert.deepEqual(values(c.dependency), ['', '10', '11']);
    assert.deepEqual(values(c.laboratory), ['', '100', '300']);
    c.dependency.value = '10';
    c.dependency.listeners.change();
    assert.deepEqual(values(c.laboratory), ['', '100']);
    c.laboratory.value = '100';
    c.faculty.value = '2';
    c.faculty.listeners.change();
    assert.equal(c.dependency.value, '');
    assert.equal(c.laboratory.value, '');
    assert.deepEqual(values(c.dependency), ['', '20']);
    assert.deepEqual(values(c.laboratory), ['', '200']);
    c.faculty.value = '';
    c.faculty.listeners.change();
    assert.deepEqual(values(c.dependency), ['', '10', '11', '20']);
    assert.deepEqual(values(c.laboratory), ['', '100', '200', '300']);
  }
});

test('faculty coordinators filter UAL by dependency without a faculty selector', () => {
  const c = setup('coordinador');
  assert.equal(c.faculty, null);
  c.dependency.value = '20';
  c.dependency.listeners.change();
  assert.deepEqual(values(c.laboratory), ['', '200']);
  c.dependency.value = '';
  c.dependency.listeners.change();
  assert.deepEqual(values(c.laboratory), ['', '100', '200', '300']);
});

test('laboratoristas retain only the UAL options supplied by their authorized scope', () => {
  const c = setup('laboratorista', { laboratory: '100' });
  assert.equal(c.faculty, null);
  assert.equal(c.dependency, null);
  assert.deepEqual(values(c.laboratory), ['', '100', '200', '300']);
  assert.equal(c.laboratory.value, '100');
});

test('restored selections and faculty-level UAL remain available on initialization', () => {
  const c = setup('admin', { faculty: '2', dependency: '20', laboratory: '200' });
  assert.equal(c.faculty.value, '2');
  assert.equal(c.dependency.value, '20');
  assert.equal(c.laboratory.value, '200');
  assert.deepEqual(values(c.laboratory), ['', '200']);
  const direct = setup('admin', { faculty: '1', laboratory: '300' });
  assert.equal(direct.laboratory.value, '300');
});

test('empty faculties and dependencies show an explicit empty state and can be cleared', () => {
  const c = setup();
  c.faculty.value = '1';
  c.faculty.listeners.change();
  c.dependency.value = '11';
  c.dependency.listeners.change();
  assert.deepEqual(values(c.laboratory), ['']);
  assert.equal(c.laboratory.options[0].textContent, 'No hay opciones disponibles');
  c.faculty.value = '3';
  c.faculty.listeners.change();
  assert.deepEqual(values(c.dependency), ['']);
  assert.deepEqual(values(c.laboratory), ['']);
  c.faculty.value = '';
  c.faculty.listeners.change();
  assert.equal(c.dependency.options[0].textContent, 'Todas las dependencias');
  assert.equal(c.laboratory.options[0].textContent, 'Selecciona un laboratorio');
});

test('the inventory filter script does not affect pages without its form', () => {
  assert.doesNotThrow(() => {
    vm.runInNewContext(source, { document: { getElementById: () => null } });
  });
});
