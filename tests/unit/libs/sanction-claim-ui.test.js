const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ejs = require('ejs');

const source = fs.readFileSync(
  path.resolve(__dirname, '../../../src/public/js/sanction-claims.js'),
  'utf8'
);

function element() {
  const attributes = new Map();
  return {
    children: [],
    textContent: '',
    append(...children) {
      this.children.push(...children);
    },
    replaceChildren() {
      this.children = [];
      this.textContent = '';
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    getAttribute(name) {
      return attributes.get(name);
    },
  };
}

function setup(fetch) {
  const panel = element();
  const handlers = {};
  const modal = {
    querySelector: () => panel,
    addEventListener: (name, callback) => {
      handlers[name] = callback;
    },
  };
  vm.runInNewContext(source, {
    document: {
      getElementById: (id) => (id === 'detalleSancionModal' ? modal : null),
      createElement: element,
    },
    fetch,
    AbortController,
  });
  return {
    panel,
    handlers,
    show: (id) =>
      handlers['show.bs.modal']({
        relatedTarget: { getAttribute: () => id },
      }),
  };
}

function contents(element) {
  return (
    element.textContent +
    element.children.map((child) => (typeof child === 'string' ? child : contents(child))).join('')
  );
}

test('sanction detail distinguishes an empty history from loading and HTTP errors', async () => {
  const empty = setup(async () => ({ ok: true, json: async () => ({ ok: true, history: [] }) }));
  await empty.show('9');
  assert.match(contents(empty.panel), /No hay reclamaciones registradas/);
  const failed = setup(async () => ({
    ok: false,
    json: async () => ({ ok: false, message: 'DB unavailable' }),
  }));
  await failed.show('9');
  assert.match(contents(failed.panel), /No fue posible cargar el historial/);
  assert.equal(failed.panel.getAttribute('role'), 'alert');
});

test('detail renders student claim, final response, decision and responsible names as text', async () => {
  const fixture = setup(async () => ({
    ok: true,
    json: async () => ({
      ok: true,
      history: [
        {
          id: 1,
          estudiante: 'Ana',
          texto: '<script>Revisión</script>',
          fecha_creacion: '2026-10-08T16:00:00Z',
          respuesta: 'Explicación',
          fecha_respuesta: '2026-10-09T16:00:00Z',
          decision: 'NO_PROCEDE',
          respondido_por: 'Responsable',
        },
      ],
    }),
  }));
  await fixture.show('9');
  assert.match(contents(fixture.panel), /Reclamación del estudiante: Ana/);
  assert.match(contents(fixture.panel), /<script>Revisión<\/script>/);
  assert.match(contents(fixture.panel), /No procede — Responsable/);
  assert.match(contents(fixture.panel), /Explicación/);
  assert.equal(fixture.panel.children.length, 2);
});

test('a delayed history cannot overwrite a different sanction or a closed modal', async () => {
  const pending = [];
  const fixture = setup(() => new Promise((resolve) => pending.push(resolve)));
  const first = fixture.show('1');
  const second = fixture.show('2');
  const response = (texto) => ({
    ok: true,
    json: async () => ({ ok: true, history: [{ id: 1, texto, responsable: 'Lab' }] }),
  });
  pending[1](response('Segunda sanción'));
  await second;
  pending[0](response('Primera sanción'));
  await first;
  assert.match(contents(fixture.panel), /Segunda sanción/);
  assert.doesNotMatch(contents(fixture.panel), /Primera sanción/);
  const third = fixture.show('3');
  fixture.handlers['hidden.bs.modal']();
  pending[2](response('Sanción cerrada'));
  await third;
  assert.equal(contents(fixture.panel), '');
});

test('profile exposes sanction access for student accounts, including multiple roles', () => {
  const profile = fs.readFileSync(
    path.resolve(__dirname, '../../../src/views/home/profile.ejs'),
    'utf8'
  );
  const header = profile.slice(
    profile.indexOf('<main '),
    profile.indexOf('<section class="row justify-content-center">')
  );
  const link = /href="\/milab\/api\/sanciones\/mis-sanciones"/;
  assert.match(ejs.render(header, { tipo: 'estudiante', roles: ['estudiante'] }), link);
  assert.match(
    ejs.render(header, { tipo: 'laboratorista', roles: ['laboratorista', 'estudiante'] }),
    link
  );
  assert.doesNotMatch(
    ejs.render(header, { tipo: 'laboratorista', roles: ['laboratorista'] }),
    link
  );
});
