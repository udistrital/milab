const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scriptPath = path.resolve(__dirname, '../../../src/public/js/scripts.js');
const script = fs.readFileSync(scriptPath, 'utf8');

function createPageShowHandler({ sanctionPage = false, dataGrid = false } = {}) {
  let pageShowHandler;
  let reloadCount = 0;
  const jquery = () => ({ ready: () => {} });
  jquery.fn = { DataTable() {} };

  const window = {
    jQuery: jquery,
    addEventListener(eventName, handler) {
      if (eventName === 'pageshow') pageShowHandler = handler;
    },
    location: {
      reload() {
        reloadCount += 1;
      },
    },
  };
  const document = {
    addEventListener() {},
    querySelector(selector) {
      if (selector === '[data-sanction-person-actions-page="true"]') {
        return sanctionPage ? {} : null;
      }
      if (selector === 'table[data-grid-refresh-on-restore="true"]') {
        return dataGrid ? {} : null;
      }
      return null;
    },
  };

  vm.runInNewContext(script, { window, document });
  return {
    handlePageShow: pageShowHandler,
    getReloadCount: () => reloadCount,
  };
}

test('restoring sanction information from browser history reloads persisted state', () => {
  const { handlePageShow, getReloadCount } = createPageShowHandler({ sanctionPage: true });

  handlePageShow({ persisted: true });

  assert.equal(getReloadCount(), 1);
});

test('page-show reload remains limited to restored pages and configured data grids', () => {
  const { handlePageShow, getReloadCount } = createPageShowHandler({ dataGrid: true });

  handlePageShow({ persisted: false });
  assert.equal(getReloadCount(), 0);

  handlePageShow({ persisted: true });
  assert.equal(getReloadCount(), 1);
});
