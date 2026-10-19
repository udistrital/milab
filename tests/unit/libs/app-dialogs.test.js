const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../../..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function setup({ deferCloseEvent = false } = {}) {
  const handlers = {};
  const timers = [];
  function element(tagName = 'BUTTON') {
    const attributes = new Map();
    const classes = new Set();
    return {
      nodeType: 1,
      tagName,
      dataset: {},
      disabled: false,
      value: '',
      name: '',
      textContent: '',
      innerHTML: 'Acción',
      listeners: {},
      classList: {
        contains: (value) => classes.has(value),
        add: (value) => classes.add(value),
        remove: (value) => classes.delete(value),
      },
      setAttribute(name, value) {
        attributes.set(name, value);
        if (name === 'disabled') this.disabled = true;
      },
      getAttribute: (name) => attributes.get(name),
      hasAttribute: (name) => attributes.has(name),
      removeAttribute(name) {
        attributes.delete(name);
        if (name === 'disabled') this.disabled = false;
      },
      addEventListener(name, callback) {
        this.listeners[name] = callback;
      },
      focus() {},
    };
  }
  const title = element();
  const message = element();
  const accept = element();
  const cancel = element();
  const close = element();
  const modal = element('DIV');
  modal.showModal = () => {
    modal.open = true;
  };
  modal.close = () => {
    modal.open = false;
    if (!deferCloseEvent) modal.listeners.close();
  };
  modal.querySelector = (selector) =>
    ({
      '[data-dialog-title]': title,
      '#appDialogMessage': message,
      '[data-dialog-accept]': accept,
      '[data-dialog-cancel]': cancel,
      '[data-dialog-close]': close,
    })[selector];
  const document = {
    readyState: 'complete',
    activeElement: element(),
    body: element('BODY'),
    getElementById: () => modal,
    querySelector: () => null,
    createElement: (tag) => element(tag.toUpperCase()),
    addEventListener(name, callback, capture) {
      (handlers[name] ||= []).push({ callback, capture: Boolean(capture) });
    },
  };
  const window = {};
  const context = vm.createContext({
    window,
    document,
    setTimeout: (callback) => {
      timers.push(callback);
      return timers.length;
    },
    clearTimeout() {},
  });
  vm.runInContext(source('src/public/js/app-dialogs.js'), context);
  vm.runInContext(source('src/public/js/submit-lock.js'), context);

  function form({ confirmation = '¿Confirmar carga?', lock = true } = {}) {
    const form = element('FORM');
    form.dataset.confirmSubmit = confirmation;
    form.isConnected = true;
    form.fields = [];
    form.submissions = [];
    form.buttons = ['aprobar', 'rechazar'].map((value) => {
      const button = element();
      button.form = form;
      button.name = 'decision';
      button.value = value;
      if (lock) button.setAttribute('data-submit-lock', 'true');
      return button;
    });
    form.appendChild = (field) => {
      form.fields.push(field);
      field.remove = () => {
        form.fields = form.fields.filter((item) => item !== field);
      };
    };
    form.querySelectorAll = () => (lock ? form.buttons : []);
    form.querySelector = () =>
      form.buttons.find((button) => button.classList.contains('is-submitting'));
    form.requestSubmit = (submitter) => {
      const event = {
        target: form,
        submitter,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        stopImmediatePropagation() {
          this.stopped = true;
        },
        stopPropagation() {},
      };
      for (const handler of [...handlers.submit].sort((a, b) => b.capture - a.capture)) {
        handler.callback(event);
        if (event.stopped) break;
      }
      if (!event.defaultPrevented) {
        form.submissions.push([
          ...form.fields.map((field) => [field.name, field.value]),
          ...(submitter && !submitter.disabled ? [[submitter.name, submitter.value]] : []),
        ]);
      }
    };
    return form;
  }
  return {
    form,
    window,
    message,
    title,
    cancel,
    accept: () => accept.listeners.click(),
    dismiss: () => modal.close(),
    flushClose: () => modal.listeners.close(),
    escape() {
      let prevented = false;
      modal.listeners.cancel({
        preventDefault: () => {
          prevented = true;
        },
      });
      return prevented;
    },
    timers,
  };
}

test('confirmation preserves exactly the chosen approval decision after disabling submit buttons', async () => {
  for (const decision of ['aprobar', 'rechazar']) {
    const h = setup();
    const form = h.form();
    form.requestSubmit(form.buttons.find((button) => button.value === decision));
    assert.equal(form.submissions.length, 0);
    assert.ok(form.buttons.every((button) => !button.disabled));
    h.accept();
    await Promise.resolve();
    assert.deepEqual(form.submissions, [[['decision', decision]]]);
    assert.ok(form.buttons.every((button) => button.disabled));
    form.requestSubmit(form.buttons[0]);
    assert.equal(form.submissions.length, 1);
  }
});

test('cancel leaves the form unlocked and allows retry with a different decision', async () => {
  const h = setup();
  const form = h.form();
  form.requestSubmit(form.buttons[0]);
  h.dismiss();
  await Promise.resolve();
  assert.equal(form.submissions.length, 0);
  assert.equal(form.dataset.submitting, undefined);
  assert.ok(form.buttons.every((button) => !button.disabled));
  form.requestSubmit(form.buttons[1]);
  h.accept();
  await Promise.resolve();
  assert.deepEqual(form.submissions, [[['decision', 'rechazar']]]);
});

test('delayed dialog close events cannot stall submission or dismiss the next queued notice', async () => {
  const h = setup({ deferCloseEvent: true });
  const form = h.form();
  form.requestSubmit(form.buttons[0]);
  h.accept();
  await Promise.resolve();
  assert.deepEqual(form.submissions, [[['decision', 'aprobar']]]);
  h.flushClose();
  const notice = h.window.MiLabDialogs.alert('Aviso siguiente');
  h.flushClose();
  assert.equal(h.message.textContent, 'Aviso siguiente');
  h.accept();
  assert.equal(await notice, true);
});

test('Escape cancels confirmation without submitting or locking the form', async () => {
  const h = setup();
  const form = h.form();
  form.requestSubmit(form.buttons[0]);
  assert.equal(h.escape(), true);
  await Promise.resolve();
  assert.equal(form.submissions.length, 0);
  assert.ok(form.buttons.every((button) => !button.disabled));
});

test('duplicate submits while confirming open only one confirmation and send once', async () => {
  const h = setup();
  const form = h.form();
  form.requestSubmit(form.buttons[0]);
  form.requestSubmit(form.buttons[0]);
  h.accept();
  await Promise.resolve();
  assert.equal(form.submissions.length, 1);
});

test('unlocked forms do not duplicate the submitter field or become permanently locked', async () => {
  const h = setup();
  const form = h.form({ confirmation: '', lock: false });
  form.requestSubmit(form.buttons[0]);
  assert.deepEqual(form.submissions, [[['decision', 'aprobar']]]);
  assert.equal(form.dataset.submitting, undefined);
});

test('lock timeout removes the preserved field and permits a new decision', async () => {
  const h = setup();
  const form = h.form({ confirmation: '' });
  form.requestSubmit(form.buttons[0]);
  h.timers.forEach((callback) => callback());
  assert.equal(form.dataset.submitting, undefined);
  assert.equal(form.fields.length, 0);
  form.requestSubmit(form.buttons[1]);
  assert.deepEqual(form.submissions[1], [['decision', 'rechazar']]);
});

test('shared dialogs render messages as text, queue notices and dismiss confirmations safely', async () => {
  const h = setup();
  const confirmation = h.window.MiLabDialogs.confirm('<script>no ejecutar</script>');
  const notice = h.window.MiLabDialogs.alert('Mensaje informativo');
  assert.equal(h.message.textContent, '<script>no ejecutar</script>');
  h.dismiss();
  assert.equal(await confirmation, false);
  assert.equal(h.title.textContent, 'Información');
  assert.equal(h.cancel.hidden, true);
  h.accept();
  assert.equal(await notice, true);
});

test('facultad deletion forms use the same shared confirmation', async () => {
  const h = setup();
  const form = h.form({ confirmation: '' });
  form.dataset.facConfirm = 'esta dependencia';
  form.requestSubmit(form.buttons[0]);
  assert.equal(h.message.textContent, '¿Está seguro que desea eliminar esta dependencia?');
  h.dismiss();
  await Promise.resolve();
  assert.equal(form.submissions.length, 0);
});

test('MILab templates and public scripts no longer invoke native browser dialogs', () => {
  for (const folder of ['src/views', 'src/public/js']) {
    for (const file of fs.readdirSync(path.join(root, folder), { recursive: true })) {
      if (!/\.(ejs|js)$/.test(file)) continue;
      assert.doesNotMatch(
        source(path.join(folder, file)),
        /(?:^|[^\w.])(?:window\.)?(?:confirm|alert|prompt)\s*\(/m,
        file
      );
    }
  }
});
