const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ejs = require('ejs');

const source = fs.readFileSync(
  path.resolve(__dirname, '../../../src/public/js/grid-actions.js'),
  'utf8'
);

function createElement(text = '', classes = '') {
  const attributes = new Map();
  const element = {
    nodeType: 1,
    textContent: text,
    dataset: {},
    children: [],
    className: classes,
    get classList() {
      const names = new Set(this.className.split(/\s+/).filter(Boolean));
      return {
        add: (name) => {
          names.add(name);
          this.className = [...names].join(' ');
        },
        contains: (name) => names.has(name),
        [Symbol.iterator]: () => names[Symbol.iterator](),
      };
    },
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: (name) => attributes.get(name) ?? null,
    hasAttribute: (name) => attributes.has(name),
    appendChild(child) {
      this.children.push(child);
    },
    matches(selector) {
      return selector === '[data-labs-toggle], [data-grid-action-ignore]'
        ? attributes.has('data-labs-toggle') || attributes.has('data-grid-action-ignore')
        : false;
    },
    querySelector(selector) {
      return (
        this.children.find((child) =>
          selector === '.app-grid-action-icon'
            ? child.classList.contains('app-grid-action-icon')
            : child.classList.contains('bi') && !child.classList.contains('app-grid-action-icon')
        ) || null
      );
    },
    querySelectorAll: () => [],
  };
  return element;
}

function createHarness(labels, heading = 'Ver detalle') {
  const header = createElement(heading);
  const table = createElement();
  table.isConnected = true;
  table.tHead = { rows: [{ cells: [header] }] };
  table.closest = (selector) => (selector === 'table' ? table : null);
  const cell = createElement();
  cell.cellIndex = 0;
  cell.closest = () => table;
  const controls = labels.map((label) => {
    const control = createElement(label, 'btn btn-sm');
    control.closest = (selector) => (selector === 'td' ? cell : table);
    return control;
  });
  table.querySelectorAll = () => controls;
  let observerCallback;
  const context = vm.createContext({
    window: {},
    document: {
      readyState: 'complete',
      body: {},
      createElement: () => createElement(),
      querySelectorAll: () => [table],
    },
    MutationObserver: class {
      constructor(callback) {
        observerCallback = callback;
      }
      observe() {}
      disconnect() {}
    },
  });

  return {
    controls,
    header,
    cell,
    start: () => vm.runInContext(source, context),
    redraw: () => observerCallback([{ target: table, addedNodes: [] }]),
  };
}

test('grid actions use related icons and accessible labels without replacing controls', () => {
  const labels = [
    'Ver detalle',
    'Editar',
    'Saldar',
    'Aplazar',
    'Activar',
    'Eliminar',
    'Impersonar',
    'Asignar a dependencia',
  ];
  const icons = [
    'bi-eye',
    'bi-pencil-square',
    'bi-check2-all',
    'bi-pause-circle',
    'bi-check-circle',
    'bi-trash',
    'bi-person-badge',
    'bi-diagram-3',
  ];
  const harness = createHarness(labels);
  const originalControl = harness.controls[1];
  originalControl.setAttribute('data-sancion-id', '42');
  originalControl.setAttribute('disabled', '');
  const clickHandler = () => 42;
  originalControl.onclick = clickHandler;
  harness.start();

  harness.controls.forEach((control, index) => {
    assert.equal(control.getAttribute('aria-label'), labels[index]);
    assert.equal(control.getAttribute('title'), labels[index]);
    assert.ok(control.children[0].classList.contains(icons[index]));
    assert.equal(control.children[0].getAttribute('aria-hidden'), 'true');
    assert.equal(control.textContent, labels[index]);
  });
  assert.equal(originalControl.onclick, clickHandler);
  assert.equal(originalControl.getAttribute('data-sancion-id'), '42');
  assert.ok(originalControl.hasAttribute('disabled'));
  assert.equal(harness.header.textContent, 'Acciones');
});

test('grid actions reapply to dynamic rows and labels without duplicate icons', () => {
  const harness = createHarness(['Activar']);
  harness.start();
  harness.redraw();
  assert.equal(harness.controls[0].children.length, 1);

  harness.controls[0].textContent = 'Inactivar';
  harness.redraw();
  assert.equal(harness.controls[0].getAttribute('aria-label'), 'Inactivar');
  assert.equal(harness.controls[0].getAttribute('title'), 'Inactivar');
  assert.ok(harness.controls[0].children[0].classList.contains('bi-person-dash'));
  assert.equal(harness.controls[0].dataset.gridActionTone, 'danger');
});

test('grid actions cover loan, incident, course and dashboard operations', () => {
  const cases = [
    ['Solicitar', 'bi-calendar-plus'],
    ['Aprobar', 'bi-check-circle'],
    ['Rechazar', 'bi-x-circle'],
    ['No asistió', 'bi-x-circle'],
    ['Iniciar', 'bi-play-circle'],
    ['Completar', 'bi-check-circle'],
    ['Entregar', 'bi-box-arrow-up-right'],
    ['Recibir', 'bi-box-arrow-in-down'],
    ['Incidencia', 'bi-exclamation-triangle'],
    ['Convertir a bloqueo', 'bi-shield-lock'],
    ['Pendiente por cerrar', 'bi-hourglass-split'],
    ['Cerrar', 'bi-check2-circle'],
    ['Asignar última hora', 'bi-lightning-charge'],
    ['Comentarios', 'bi-chat-left-text'],
    ['Reasignar sala', 'bi-arrow-left-right'],
    ['Horarios', 'bi-calendar-week'],
    ['Estado', 'bi-toggles'],
    ['Retirar', 'bi-x-circle'],
    ['Guardar', 'bi-floppy'],
    ['Editar usuario', 'bi-person-gear'],
    ['Editar correo', 'bi-envelope'],
  ];
  const harness = createHarness(cases.map(([label]) => label));
  harness.start();

  cases.forEach(([label, icon], index) => {
    assert.equal(harness.controls[index].getAttribute('aria-label'), label);
    assert.ok(harness.controls[index].children[0].classList.contains(icon));
  });
});

test('grid actions preserve custom descriptions, existing icons and expand-text controls', () => {
  const harness = createHarness(['Retirar', 'Acción especializada', 'Ver más'], 'Laboratorio');
  harness.controls[0].setAttribute('title', 'Retira la asociación, sin eliminar el equipo');
  const existingIcon = createElement('', 'bi bi-link-45deg');
  harness.controls[1].appendChild(existingIcon);
  harness.controls[2].setAttribute('data-labs-toggle', 'true');
  harness.start();

  assert.equal(
    harness.controls[0].getAttribute('title'),
    'Retira la asociación, sin eliminar el equipo'
  );
  assert.ok(harness.controls[1].children[1].classList.contains('bi-link-45deg'));
  assert.equal(harness.controls[2].getAttribute('aria-label'), null);
  assert.equal(harness.header.textContent, 'Laboratorio');
});

test('grid actions survive submit-lock content changes and restore the original action', () => {
  const harness = createHarness(['Eliminar']);
  harness.start();
  const control = harness.controls[0];
  control.setAttribute('aria-busy', 'true');
  control.textContent = 'Procesando...';
  control.children = [];
  harness.redraw();
  assert.equal(control.getAttribute('aria-label'), 'Procesando...');
  assert.ok(control.classList.contains('app-grid-action'));

  control.setAttribute('aria-busy', 'false');
  control.textContent = 'Eliminar';
  control.children = [];
  harness.redraw();
  assert.equal(control.getAttribute('aria-label'), 'Eliminar');
  assert.ok(control.children[0].classList.contains('bi-trash'));
});

test('merged action columns preserve table structure and state in registered-user lists', async () => {
  const person = {
    con_nombre: 'Persona de prueba',
    con_documento: '10000001',
    con_correo: 'prueba@example.org',
    con_ual: 'Laboratorio',
    con_facultad: 'Facultad',
    activo: true,
    tipo: 'coordinador',
    facultad_nombre: 'Facultad',
  };
  for (const [view, variables, expectedColumns] of [
    ['laboratoristas_registrados', { laboratoristas: [person] }, 7],
    ['coordinadores_registrados', { coordinadores: [person], facultadesDisponibles: [] }, 8],
    [
      'facultad',
      {
        facultades: [{ facultad_id: 1, nombre: 'Facultad', dependencias_count: 2, uals_count: 0 }],
        dependencias: [],
        selectedFacultad: null,
        uals: [],
      },
      4,
    ],
  ]) {
    const html = await ejs.renderFile(
      path.resolve(__dirname, `../../../src/views/home/${view}.ejs`),
      { tipo: 'admin', cspNonce: 'test', csrfToken: 'test', successMessage: null, ...variables }
    );
    const table = html.match(/<table\b[\s\S]*?<\/table>/)[0];
    const head = table.match(/<thead\b[\s\S]*?<\/thead>/)[0];
    const body = table.match(/<tbody\b[\s\S]*?<\/tbody>/)[0];
    assert.equal((head.match(/<th(?:\s|>)/g) || []).length, expectedColumns);
    assert.equal((body.match(/<td(?:\s|>)/g) || []).length, expectedColumns);
    assert.equal((head.match(/>Acciones<\/th>/g) || []).length, 1);
    assert.match(html, /\/milab\/public\/js\/grid-actions\.js/);
    if (view !== 'facultad') {
      assert.match(body, /Activo/);
      assert.match(body, /Inactivar/);
      assert.match(body, /Editar/);
    } else {
      assert.match(body, /Ver dependencias/);
      assert.doesNotMatch(body, /Ver UALs/);
      assert.match(body, /Editar/);
      assert.match(body, /Eliminar/);
    }
  }
});
