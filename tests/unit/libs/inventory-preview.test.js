const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const scriptPath = path.resolve(__dirname, '../../../src/public/js/inventory-preview.js');
const hadDocument = Object.hasOwn(globalThis, 'document');
const originalDocument = globalThis.document;
const hadWindow = Object.hasOwn(globalThis, 'window');
const originalWindow = globalThis.window;

afterEach(() => {
  if (hadDocument) globalThis.document = originalDocument;
  else delete globalThis.document;
  if (hadWindow) globalThis.window = originalWindow;
  else delete globalThis.window;
});

function createFilterButton(filter) {
  const attributes = new Map();
  const listeners = new Map();
  return {
    dataset: { rowFilter: filter },
    listeners,
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    click() {
      listeners.get('click')();
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
  };
}

function createHarness({ dataTable = false, reducedMotion = false } = {}) {
  const rows = [
    { dataset: { rowStatus: 'ready' }, hidden: false },
    { dataset: { rowStatus: 'observations' }, hidden: false },
    { dataset: { rowStatus: 'ready' }, hidden: false },
  ];
  const buttons = ['all', 'ready', 'observations', 'missing'].map(createFilterButton);
  const table = {};
  const summary = { textContent: '' };
  const noMatchingRows = { hidden: true };
  const descriptionClasses = new Set();
  const description = {
    classList: {
      toggle(name, enabled) {
        if (enabled) descriptionClasses.add(name);
        else descriptionClasses.delete(name);
      },
    },
  };
  const descriptionToggle = createFilterButton('description');
  descriptionToggle.dataset = {};
  descriptionToggle.parentElement = {
    querySelector: () => description,
  };
  descriptionToggle.textContent = 'Ver más';
  descriptionToggle.setAttribute('aria-expanded', 'false');
  const scrollTop = createFilterButton('scroll');
  scrollTop.hidden = true;
  let scrollY = 0;
  const windowListeners = new Map();
  let scrollOptions;
  let dataTableApi;
  const document = {
    querySelectorAll(selector) {
      if (selector === '[data-row-filter]') return buttons;
      if (selector === '[data-preview-row]') return rows;
      if (selector === '[data-description-toggle]') return [descriptionToggle];
      return [];
    },
    getElementById(id) {
      return (
        {
          previewRowsTable: table,
          previewFilterSummary: summary,
          previewNoMatchingRows: noMatchingRows,
          inventoryPreviewScrollTop: scrollTop,
        }[id] || null
      );
    },
  };
  const window = {
    get scrollY() {
      return scrollY;
    },
    addEventListener(name, listener) {
      windowListeners.set(name, listener);
    },
    matchMedia: () => ({ matches: reducedMotion }),
    scrollTo(options) {
      scrollOptions = options;
    },
  };

  if (dataTable) {
    const searchFilters = [];
    dataTableApi = {
      on(_event, listener) {
        this.drawListener = listener;
      },
      rows() {
        return { count: () => this.visibleRows.length };
      },
      draw() {
        const settings = { nTable: table, aoData: rows.map((nTr) => ({ nTr })) };
        this.visibleRows = rows.filter((row, index) =>
          searchFilters.every((filter) => filter(settings, [], index))
        );
        this.drawListener?.();
      },
    };
    const jquery = (value) => {
      if (typeof value === 'function') {
        value();
        return;
      }
      if (value === table) return { DataTable: () => dataTableApi };
      throw new Error('Unexpected jQuery argument');
    };
    jquery.fn = {
      dataTable: {
        ext: { search: searchFilters },
        isDataTable: () => true,
      },
    };
    window.jQuery = jquery;
  }

  globalThis.window = window;
  globalThis.document = document;
  delete require.cache[scriptPath];
  require(scriptPath);
  delete require.cache[scriptPath];

  return {
    rows,
    buttons,
    summary,
    noMatchingRows,
    descriptionClasses,
    descriptionToggle,
    scrollTop,
    windowListeners,
    dataTableApi,
    dataTableFilters: dataTable ? window.jQuery.fn.dataTable.ext.search : [],
    table,
    setScrollY(value) {
      scrollY = value;
    },
    getScrollOptions() {
      return scrollOptions;
    },
  };
}

test('preview filters rows, updates accessible state and announces empty results', () => {
  const client = createHarness();

  client.buttons.find((button) => button.dataset.rowFilter === 'ready').click();
  assert.deepEqual(
    client.rows.map((row) => row.hidden),
    [false, true, false]
  );
  assert.equal(client.summary.textContent, 'Mostrando 2 de 3 filas.');
  assert.equal(client.noMatchingRows.hidden, true);
  assert.equal(
    client.buttons
      .find((button) => button.dataset.rowFilter === 'ready')
      .getAttribute('aria-pressed'),
    'true'
  );
  assert.equal(
    client.buttons
      .find((button) => button.dataset.rowFilter === 'all')
      .getAttribute('aria-pressed'),
    'false'
  );

  client.buttons.find((button) => button.dataset.rowFilter === 'missing').click();
  assert.deepEqual(
    client.rows.map((row) => row.hidden),
    [true, true, true]
  );
  assert.equal(client.summary.textContent, 'Mostrando 0 de 3 filas.');
  assert.equal(client.noMatchingRows.hidden, false);
});

test('DataTables preview filtering is scoped to its table and updates the applied count', () => {
  const client = createHarness({ dataTable: true });
  const filter = client.dataTableFilters[0];
  assert.equal(filter({ nTable: {} }, [], 0), true);
  assert.equal(client.summary.textContent, 'Mostrando 3 de 3 filas.');

  client.buttons.find((button) => button.dataset.rowFilter === 'observations').click();
  assert.equal(client.summary.textContent, 'Mostrando 1 de 3 filas.');
  assert.equal(client.dataTableApi.visibleRows[0].dataset.rowStatus, 'observations');
  const settings = { nTable: client.table, aoData: client.rows.map((nTr) => ({ nTr })) };
  assert.equal(filter(settings, [], 0), false);
  assert.equal(filter(settings, [], 1), true);
});

test('description and scroll controls expose their expanded and motion states', () => {
  const client = createHarness();

  client.descriptionToggle.click();
  assert.equal(client.descriptionClasses.has('is-expanded'), true);
  assert.equal(client.descriptionToggle.getAttribute('aria-expanded'), 'true');
  assert.equal(client.descriptionToggle.textContent, 'Ver menos');

  client.descriptionToggle.click();
  assert.equal(client.descriptionClasses.has('is-expanded'), false);
  assert.equal(client.descriptionToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(client.descriptionToggle.textContent, 'Ver más');

  assert.equal(client.scrollTop.hidden, true);
  client.setScrollY(500);
  client.windowListeners.get('scroll')();
  assert.equal(client.scrollTop.hidden, false);
  client.scrollTop.click();
  assert.equal(client.getScrollOptions().top, 0);
  assert.equal(client.getScrollOptions().behavior, 'smooth');

  const reducedMotionClient = createHarness({ reducedMotion: true });
  reducedMotionClient.scrollTop.click();
  assert.equal(reducedMotionClient.getScrollOptions().top, 0);
  assert.equal(reducedMotionClient.getScrollOptions().behavior, 'auto');
});
