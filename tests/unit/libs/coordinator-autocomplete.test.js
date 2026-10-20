const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const scriptPath = path.resolve(__dirname, '../../../src/public/js/coordinator-autocomplete.js');
const hadDocument = Object.hasOwn(globalThis, 'document');
const originalDocument = globalThis.document;

afterEach(() => {
  if (hadDocument) globalThis.document = originalDocument;
  else delete globalThis.document;
});

function createElement(dataset = {}) {
  const listeners = new Map();
  return {
    dataset,
    hidden: false,
    value: '',
    focused: false,
    listeners,
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    focus() {
      this.focused = true;
    },
    click() {
      listeners.get('click')?.();
    },
  };
}

function setup({ options, submitOnSelect = true } = {}) {
  const input = createElement();
  const selectedValue = createElement();
  const results = createElement();
  const form = {
    submissions: 0,
    requestSubmit() {
      this.submissions += 1;
    },
  };
  input.form = form;
  results.hidden = true;
  const coordinatorOptions = (options || []).map((option) =>
    createElement({
      value: option.value,
      label: option.label,
      search: option.search || option.label,
    })
  );
  const widget = {
    dataset: { submitOnSelect: String(submitOnSelect) },
    querySelector(selector) {
      return {
        '[data-coordinator-search]': input,
        '[data-coordinator-value]': selectedValue,
        '[data-coordinator-results]': results,
      }[selector];
    },
    querySelectorAll: (selector) =>
      selector === '[data-coordinator-option]' ? coordinatorOptions : [],
    contains(target) {
      return (
        target === input ||
        target === selectedValue ||
        target === results ||
        coordinatorOptions.includes(target)
      );
    },
  };
  const documentListeners = new Map();
  globalThis.document = {
    querySelectorAll: () => [widget],
    addEventListener(name, listener) {
      documentListeners.set(name, listener);
    },
  };
  delete require.cache[scriptPath];
  require(scriptPath);
  delete require.cache[scriptPath];
  return {
    input,
    selectedValue,
    results,
    options: coordinatorOptions,
    form,
    documentListeners,
  };
}

function visibleValues(options) {
  return options.filter((option) => !option.hidden).map((option) => option.dataset.value);
}

test('coordinator search ignores accents and case and limits visible matches to ten', () => {
  const client = setup({
    options: Array.from({ length: 12 }, (_, index) => ({
      value: String(index + 1),
      label: `José Coordinador ${index + 1}`,
    })),
  });

  client.input.value = '  JOSE  ';
  client.input.listeners.get('input')();

  assert.equal(client.results.hidden, false);
  assert.deepEqual(visibleValues(client.options), [
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
    '8',
    '9',
    '10',
  ]);

  client.input.value = 'no existe';
  client.input.listeners.get('input')();
  assert.equal(client.results.hidden, true);
  assert.deepEqual(visibleValues(client.options), []);
});

test('keyboard selection stores the coordinator, submits once and clears stale selections', () => {
  const client = setup({
    options: [
      { value: '123', label: 'María Pérez' },
      { value: '456', label: 'Mario Gómez' },
    ],
  });

  client.input.value = 'maria';
  client.input.listeners.get('input')();
  let prevented = false;
  client.input.listeners.get('keydown')({
    key: 'ArrowDown',
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(client.options[0].focused, true);

  client.input.listeners.get('keydown')({
    key: 'Enter',
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(client.selectedValue.value, '123');
  assert.equal(client.input.value, 'María Pérez');
  assert.equal(client.results.hidden, true);
  assert.equal(client.form.submissions, 1);

  client.input.value = 'María Pérez modificada';
  client.input.listeners.get('input')();
  assert.equal(client.selectedValue.value, '');
});

test('escape and outside clicks close results without submitting an unselected coordinator', () => {
  const client = setup({
    submitOnSelect: false,
    options: [{ value: '123', label: 'Ana Pérez' }],
  });

  client.input.value = 'ana';
  client.input.listeners.get('input')();
  assert.equal(client.results.hidden, false);
  client.input.listeners.get('keydown')({ key: 'Escape' });
  assert.equal(client.results.hidden, true);

  client.input.listeners.get('focus')();
  client.documentListeners.get('click')({ target: {} });
  assert.equal(client.results.hidden, true);

  client.input.listeners.get('focus')();
  client.options[0].click();
  assert.equal(client.selectedValue.value, '123');
  assert.equal(client.form.submissions, 0);
});
