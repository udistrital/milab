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
  function select(id, rows, placeholder = 'Selecciona primero una opción') {
    return {
      value: initial[id] || '',
      disabled: false,
      options: [{ value: '', textContent: placeholder, hidden: false, disabled: false }, ...rows],
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
    hidden: true,
    disabled: true,
    dataset: { facultyId, dependencyId },
  });
  const submitButton = { disabled: true };
  const controls = {
    '#inventory-faculty': ['admin', 'coordinador_general', 'coordinador'].includes(role)
      ? select('faculty', [option('1'), option('2'), option('3')])
      : null,
    '#inventory-dependency':
      role !== 'laboratorista'
        ? select('dependency', [
            option('10', '1'),
            option('11', '1'),
            option('20', '2'),
            option('direct-1', '1'),
          ])
        : null,
    '#ual_id': select(
      'laboratory',
      [option('100', '1', '10'), option('200', '2', '20'), option('300', '1')],
      'Selecciona primero una dependencia'
    ),
  };
  const form = {
    querySelector: (selector) =>
      selector === 'button[type="submit"]' ? submitButton : controls[selector],
  };
  vm.runInNewContext(source, {
    document: {
      getElementById: () => form,
    },
  });
  return {
    faculty: controls['#inventory-faculty'],
    dependency: controls['#inventory-dependency'],
    laboratory: controls['#ual_id'],
    submitButton,
  };
}

function values(select) {
  return select.options.map((option) => option.value);
}

test('global and faculty coordinator viewers require faculty, dependency and UAL selections', () => {
  for (const role of ['admin', 'coordinador_general', 'coordinador']) {
    const c = setup(role);
    assert.deepEqual(values(c.dependency), ['']);
    assert.deepEqual(values(c.laboratory), ['']);
    assert.equal(c.dependency.disabled, true);
    assert.equal(c.laboratory.disabled, true);
    assert.equal(c.submitButton.disabled, true);

    c.faculty.value = '1';
    c.faculty.listeners.change();
    assert.deepEqual(values(c.dependency), ['', '10', '11', 'direct-1']);
    assert.deepEqual(values(c.laboratory), ['']);
    assert.equal(c.dependency.disabled, false);
    assert.equal(c.laboratory.disabled, true);

    c.dependency.value = '10';
    c.dependency.listeners.change();
    assert.deepEqual(values(c.laboratory), ['', '100']);
    assert.equal(c.laboratory.disabled, false);
    assert.equal(c.submitButton.disabled, true);
    c.laboratory.value = '100';
    c.laboratory.listeners.change();
    assert.equal(c.submitButton.disabled, false);

    c.laboratory.value = '100';
    c.faculty.value = '2';
    c.faculty.listeners.change();
    assert.equal(c.dependency.value, '');
    assert.equal(c.laboratory.value, '');
    assert.deepEqual(values(c.dependency), ['', '20']);
    assert.deepEqual(values(c.laboratory), ['']);
    assert.equal(c.submitButton.disabled, true);

    c.faculty.value = '';
    c.faculty.listeners.change();
    assert.deepEqual(values(c.dependency), ['']);
    assert.deepEqual(values(c.laboratory), ['']);
    assert.equal(c.dependency.options[0].textContent, 'Selecciona primero una facultad');
  }
});

test('faculty-level laboratories are available only through the explicit no-dependency option', () => {
  const c = setup();
  c.faculty.value = '1';
  c.faculty.listeners.change();
  c.dependency.value = 'direct-1';
  c.dependency.listeners.change();
  assert.deepEqual(values(c.laboratory), ['', '300']);
  c.laboratory.value = '300';
  c.laboratory.listeners.change();
  assert.equal(c.submitButton.disabled, false);
});

test('laboratoristas retain only the UAL options supplied by their authorized scope', () => {
  const c = setup('laboratorista', { laboratory: '100' });
  assert.equal(c.faculty, null);
  assert.equal(c.dependency, null);
  assert.deepEqual(values(c.laboratory), ['', '100', '200', '300']);
  assert.equal(c.laboratory.value, '100');
  assert.equal(c.submitButton.disabled, false);
});

test('restored selections and faculty-level UAL remain available on initialization', () => {
  const c = setup('admin', { faculty: '2', dependency: '20', laboratory: '200' });
  assert.equal(c.faculty.value, '2');
  assert.equal(c.dependency.value, '20');
  assert.equal(c.laboratory.value, '200');
  assert.deepEqual(values(c.laboratory), ['', '200']);
  const direct = setup('admin', {
    faculty: '1',
    dependency: 'direct-1',
    laboratory: '300',
  });
  assert.equal(direct.laboratory.value, '300');
  assert.deepEqual(values(direct.laboratory), ['', '300']);
});

test('empty faculties and dependencies show explicit states and cannot expose unrelated locations', () => {
  const c = setup();
  c.faculty.value = '1';
  c.faculty.listeners.change();
  c.dependency.value = '11';
  c.dependency.listeners.change();
  assert.deepEqual(values(c.laboratory), ['']);
  assert.equal(
    c.laboratory.options[0].textContent,
    'No hay laboratorios disponibles para esta dependencia'
  );
  c.faculty.value = '3';
  c.faculty.listeners.change();
  assert.deepEqual(values(c.dependency), ['']);
  assert.deepEqual(values(c.laboratory), ['']);
  assert.equal(
    c.dependency.options[0].textContent,
    'No hay dependencias disponibles para esta facultad'
  );
  c.faculty.value = '';
  c.faculty.listeners.change();
  assert.deepEqual(values(c.dependency), ['']);
  assert.deepEqual(values(c.laboratory), ['']);
  assert.equal(c.dependency.options[0].textContent, 'Selecciona primero una facultad');
  assert.equal(c.laboratory.options[0].textContent, 'Selecciona primero una facultad');
});

test('the inventory filter script does not affect pages without its form', () => {
  assert.doesNotThrow(() => {
    vm.runInNewContext(source, { document: { getElementById: () => null } });
  });
});
