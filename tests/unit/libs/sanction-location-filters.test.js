const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const template = fs.readFileSync(
  path.resolve(__dirname, '../../../src/views/home/get_list_multas.ejs'),
  'utf8'
);
const source = template.match(
  /<script nonce="<%= cspNonce %>">\s*(\(function \(\) \{\s*const facultySelect[\s\S]*?)<\/script>/
)[1];

function setup(role = 'admin', initial = {}) {
  class Option {
    constructor(text, value) {
      this.textContent = text;
      this.value = value;
      this.attributes = {};
    }
    setAttribute(key, value) {
      this.attributes[key] = value;
    }
    getAttribute(key) {
      return this.attributes[key] || null;
    }
  }
  function select(id, rows) {
    return {
      value: initial[id] || '',
      options: [
        new Option('Todas', ''),
        ...rows.map(([value, faculty, dependency]) => {
          const option = new Option(value, value);
          option.setAttribute('data-facultad-id', faculty);
          option.setAttribute('data-dependencia-id', dependency || '');
          return option;
        }),
      ],
      listeners: {},
      remove(index) {
        this.options.splice(index, 1);
      },
      add(option) {
        this.options.push(option);
      },
      addEventListener(event, handler) {
        this.listeners[event] = handler;
      },
    };
  }
  const controls = {
    filtro_facultad: role === 'admin' ? select('filtro_facultad', [['1'], ['2']]) : null,
    filtro_dependencia:
      role !== 'laboratorista'
        ? select('filtro_dependencia', [
            ['10', '1'],
            ['20', '2'],
          ])
        : null,
    filtro_ual: select('filtro_ual', [
      ['100', '1', '10'],
      ['200', '2', '20'],
      ['300', '1', ''],
    ]),
  };
  vm.runInNewContext(source, { document: { getElementById: (id) => controls[id] }, Option });
  return controls;
}

test('sanction filters require faculty then dependency and clear descendants on changes', () => {
  const c = setup();
  assert.equal(c.filtro_dependencia.disabled, true);
  assert.equal(c.filtro_ual.disabled, true);
  c.filtro_facultad.value = '1';
  c.filtro_facultad.listeners.change();
  assert.equal(c.filtro_dependencia.disabled, false);
  assert.deepEqual(
    c.filtro_dependencia.options.map((o) => o.value),
    ['', '10']
  );
  assert.equal(c.filtro_ual.disabled, true);
  c.filtro_dependencia.value = '10';
  c.filtro_dependencia.listeners.change();
  assert.deepEqual(
    c.filtro_ual.options.map((o) => o.value),
    ['', '100']
  );
  assert.equal(c.filtro_ual.disabled, false);
  c.filtro_ual.value = '100';
  c.filtro_facultad.value = '2';
  c.filtro_facultad.listeners.change();
  assert.equal(c.filtro_dependencia.value, '');
  assert.equal(c.filtro_ual.value, '');
  assert.equal(c.filtro_ual.disabled, true);
});

test('coordinator starts at dependency and laboratorista can select assigned UAL directly', () => {
  const c = setup('coordinador');
  assert.equal(c.filtro_dependencia.disabled, false);
  assert.equal(c.filtro_ual.disabled, true);
  c.filtro_dependencia.value = '20';
  c.filtro_dependencia.listeners.change();
  assert.deepEqual(
    c.filtro_ual.options.map((o) => o.value),
    ['', '200']
  );
  const l = setup('laboratorista');
  assert.equal(l.filtro_ual.disabled, false);
  assert.equal(l.filtro_ual.options.length, 4);
});

test('preselected UAL restores its dependency and faculty', () => {
  const c = setup('admin', { filtro_ual: '200' });
  assert.equal(c.filtro_facultad.value, '2');
  assert.equal(c.filtro_dependencia.value, '20');
  assert.equal(c.filtro_ual.value, '200');
  assert.equal(c.filtro_ual.disabled, false);
});

test('existing direct UAL links remain selected until the faculty changes', () => {
  const c = setup('admin', { filtro_ual: '300' });
  assert.equal(c.filtro_facultad.value, '1');
  assert.equal(c.filtro_ual.value, '300');
  assert.equal(c.filtro_ual.disabled, false);
  c.filtro_facultad.value = '2';
  c.filtro_facultad.listeners.change();
  assert.equal(c.filtro_ual.value, '');
  assert.equal(c.filtro_ual.disabled, true);
});
