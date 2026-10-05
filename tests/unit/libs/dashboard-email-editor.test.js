const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dashboardSource = fs.readFileSync(
  path.resolve(__dirname, '../../../src/views/home/dashboard.ejs'),
  'utf8'
);
const submitLockSource = fs.readFileSync(
  path.resolve(__dirname, '../../../src/public/js/submit-lock.js'),
  'utf8'
);

function extractDashboardFunction(name, nextName) {
  const start = dashboardSource.indexOf(`  function ${name}(`);
  const asyncStart = dashboardSource.indexOf(`  async function ${name}(`);
  const end = dashboardSource.indexOf(`  ${nextName}`, Math.max(start, asyncStart));
  assert.ok(Math.max(start, asyncStart) >= 0 && end >= 0);
  return dashboardSource.slice(Math.max(start, asyncStart), end);
}

function createElement(tagName = 'INPUT', attributes = {}) {
  const classes = new Set();
  const attrs = new Map(Object.entries(attributes));
  return {
    nodeType: 1,
    tagName,
    value: '',
    checked: false,
    disabled: false,
    dataset: {},
    textContent: '',
    innerHTML: 'Guardar y enrolar',
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    },
    getAttribute: (name) => attrs.get(name) ?? null,
    hasAttribute: (name) => attrs.has(name),
    setAttribute(name, value) {
      attrs.set(name, value);
      if (name === 'disabled') this.disabled = true;
    },
    removeAttribute(name) {
      attrs.delete(name);
      if (name === 'disabled') this.disabled = false;
    },
  };
}

function createHarness(fetchImpl) {
  const elements = {};
  for (const name of ['Name', 'Document', 'Current', 'Input', 'Role', 'SaveButton', 'Form']) {
    elements[`dashboardEmailEditor${name}`] = createElement();
  }
  for (const name of [
    'dashboardEmailConfirmCheckbox',
    'dashboardEmailNotifyUser',
    'dashboardEmailModalFeedback',
    'dashboardEmailEditorModal',
    'dashboardEmailConfirmDocument',
    'dashboardEmailConfirmCorreo',
    'dashboardEmailConfirmRole',
  ]) {
    elements[name] = createElement();
  }
  const button = createElement('BUTTON', { 'data-submit-lock': 'true', type: 'submit' });
  const form = createElement('FORM');
  elements.dashboardEmailEditorSaveButton = button;
  elements.dashboardEmailEditorForm = form;
  button.form = form;
  form.querySelectorAll = () => [button];

  const documentHandlers = {};
  const document = {
    readyState: 'complete',
    body: createElement('BODY'),
    getElementById: (id) => elements[id],
    addEventListener: (event, callback) => {
      documentHandlers[event] = callback;
    },
  };
  const requests = [];
  const updates = [];
  const window = {
    bootstrap: {
      Modal: {
        getOrCreateInstance: () => ({
          show() {},
          hide() {
            context.dashboardEmailEditContext = null;
            elements.dashboardEmailConfirmCheckbox.checked = false;
            context.syncDashboardEmailSaveState();
          },
        }),
      },
    },
  };
  const context = vm.createContext({
    window,
    document,
    setTimeout: () => 1,
    clearTimeout() {},
    csrfToken: 'test-token',
    dashboardEmailEditContext: null,
    getUsuarioDashboardRowById: (id) => ({
      id,
      documento: `documento-${id}`,
      correo: 'no-email@placeholder.milab.local',
      codigo: String(id),
    }),
    syncUsuariosRowsAfterEmailUpdate: (id, correo) => updates.push({ id, correo }),
    renderDetailTable() {},
    showDashboardFeedback() {},
    fetch: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return fetchImpl
        ? fetchImpl(url, options)
        : { ok: true, json: async () => ({ ok: true, correo: JSON.parse(options.body).correo }) };
    },
  });
  vm.runInContext(submitLockSource, context);
  for (const [name, nextName] of [
    ['inferEnrollmentTypeFromRow', 'function openDashboardEmailEditorModal'],
    ['openDashboardEmailEditorModal', 'function updateDashboardEmailConfirmSummary'],
    ['updateDashboardEmailConfirmSummary', 'function syncDashboardEmailSaveState'],
    ['syncDashboardEmailSaveState', 'function isNoEmailPlaceholderCorreo'],
    ['actualizarCorreoUsuarioDesdeDashboard', 'async function toggleUsuarioActivoDesdeDashboard'],
  ]) {
    vm.runInContext(extractDashboardFunction(name, nextName), context);
  }

  const listener = dashboardSource.match(
    /emailEditorForm\.addEventListener\('submit', (async function\(event\) \{[\s\S]*?)\n {6}\}\);/
  );
  assert.ok(listener);
  context.emailEditorForm = form;
  const submitHandler = vm.runInContext(`(${listener[1]}\n})`, context);

  return {
    elements,
    form,
    button,
    requests,
    updates,
    open(id, correo) {
      context.openDashboardEmailEditorModal(id);
      elements.dashboardEmailEditorInput.value = correo;
      elements.dashboardEmailConfirmCheckbox.checked = true;
      context.syncDashboardEmailSaveState();
    },
    async submit() {
      const event = {
        target: button,
        prevented: false,
        stopped: false,
        preventDefault() {
          this.prevented = true;
        },
        stopPropagation() {
          this.stopped = true;
        },
        stopImmediatePropagation() {
          this.stopped = true;
        },
      };
      documentHandlers.click(event);
      if (event.prevented) return false;
      event.target = form;
      documentHandlers.submit(event);
      if (event.stopped) return false;
      await submitHandler(event);
      return true;
    },
  };
}

test('dashboard email editor saves two filtered placeholder users without reloading', async () => {
  const harness = createHarness();
  harness.open(101, 'primero@udistrital.edu.co');
  assert.equal(await harness.submit(), true);
  assert.equal(harness.form.dataset.submitting, undefined);
  assert.equal(harness.button.classList.contains('is-submitting'), false);
  assert.equal(harness.button.disabled, true);

  harness.open(202, 'segundo@udistrital.edu.co');
  assert.equal(harness.button.disabled, false);
  assert.equal(await harness.submit(), true);
  assert.deepEqual(
    harness.requests.map((request) => request.url),
    ['/milab/api/dashboard/usuarios/101/correo', '/milab/api/dashboard/usuarios/202/correo']
  );
  assert.deepEqual(harness.updates, [
    { id: 101, correo: 'primero@udistrital.edu.co' },
    { id: 202, correo: 'segundo@udistrital.edu.co' },
  ]);
});

test('dashboard email editor releases the form after validation errors and allows retry', async () => {
  const harness = createHarness();
  harness.open(101, 'correo@example.com');
  await harness.submit();
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.form.dataset.submitting, undefined);
  assert.match(harness.elements.dashboardEmailModalFeedback.textContent, /correo institucional/);
  assert.equal(harness.button.disabled, false);

  harness.elements.dashboardEmailEditorInput.value = 'corregido@udistrital.edu.co';
  assert.equal(await harness.submit(), true);
  assert.equal(harness.requests.length, 1);
});

test('dashboard email editor allows retry after HTTP and network failures', async () => {
  let attempt = 0;
  const harness = createHarness(async () => {
    attempt++;
    if (attempt === 1) {
      return { ok: false, json: async () => ({ ok: false, message: 'Correo duplicado' }) };
    }
    if (attempt === 2) throw new Error('Network unavailable');
    return { ok: true, json: async () => ({ ok: true, correo: 'nuevo@udistrital.edu.co' }) };
  });
  harness.open(101, 'nuevo@udistrital.edu.co');
  for (let index = 0; index < 2; index++) {
    assert.equal(await harness.submit(), true);
    assert.equal(harness.form.dataset.submitting, undefined);
    assert.equal(harness.button.disabled, false);
    assert.equal(harness.button.classList.contains('is-submitting'), false);
    assert.equal(harness.elements.dashboardEmailModalFeedback.classList.contains('d-none'), false);
  }
  assert.equal(await harness.submit(), true);
  assert.equal(harness.requests.length, 3);
  assert.equal(harness.updates.length, 1);
});

test('dashboard email editor still requires confirmation before saving', async () => {
  const harness = createHarness();
  harness.open(101, 'nuevo@udistrital.edu.co');
  harness.elements.dashboardEmailConfirmCheckbox.checked = false;
  await harness.submit();
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.form.dataset.submitting, undefined);
  assert.equal(harness.button.disabled, true);
  assert.match(harness.elements.dashboardEmailModalFeedback.textContent, /confirmar/);
});

test('dashboard email editor prevents duplicate submissions while the request is pending', async () => {
  let finishRequest;
  const harness = createHarness(
    () =>
      new Promise((resolve) => {
        finishRequest = resolve;
      })
  );
  harness.open(101, 'nuevo@udistrital.edu.co');
  const pending = harness.submit();
  assert.equal(harness.form.dataset.submitting, '1');
  assert.equal(harness.button.disabled, true);
  assert.equal(await harness.submit(), false);
  assert.equal(harness.requests.length, 1);
  finishRequest({ ok: true, json: async () => ({ ok: true, correo: 'nuevo@udistrital.edu.co' }) });
  await pending;
  assert.equal(harness.form.dataset.submitting, undefined);
});
