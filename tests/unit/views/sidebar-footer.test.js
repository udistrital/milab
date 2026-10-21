const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const viewsPath = path.resolve(__dirname, '../../../src/views');
const headerPath = path.join(viewsPath, 'partials/header.ejs');
const logoutPath = path.join(viewsPath, 'home/logout.ejs');
const stylesPath = path.resolve(__dirname, '../../../src/public/css/styles.css');

test('sidebar footer contains four accessible icon-only user actions', () => {
  const header = fs.readFileSync(headerPath, 'utf8');
  const footerStart = header.indexOf('<nav class="app-sidebar-footer"');
  const footerEnd = header.indexOf('</nav>', footerStart);
  assert.notEqual(footerStart, -1);
  assert.notEqual(footerEnd, -1);

  const footer = header.slice(footerStart, footerEnd);
  const actions = [...footer.matchAll(/<(?:a|button)\b[\s\S]*?<\/(?:a|button)>/g)];
  const styles = fs.readFileSync(stylesPath, 'utf8');

  assert.equal(actions.length, 4);
  ['Perfil de usuario', 'Mis medallas', 'Centro de ayuda', 'Cerrar sesión'].forEach((label) => {
    assert.match(footer, new RegExp(`aria-label="${label}"`));
    assert.match(footer, new RegExp(`title="${label}"`));
  });
  assert.equal((footer.match(/<i class="bi /g) || []).length, 4);
  assert.doesNotMatch(footer, /<span>/);
  assert.match(
    styles,
    /app-sidebar-footer\s*\{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/
  );
});

test('logout click delegation opens confirmation and completes logout for later-rendered actions', () => {
  const logout = fs.readFileSync(logoutPath, 'utf8');
  const script = logout.match(/<script nonce="<%= cspNonce %>">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);

  let delegatedClick;
  let confirmClick;
  let modalShowCount = 0;
  let modalHideCount = 0;
  const logoutConfirm = {
    addEventListener(eventName, handler) {
      if (eventName === 'click') confirmClick = handler;
    },
  };
  const modal = {
    show() {
      modalShowCount += 1;
    },
    hide() {
      modalHideCount += 1;
    },
  };
  const document = {
    addEventListener(eventName, handler) {
      if (eventName === 'click') delegatedClick = handler;
    },
    getElementById(id) {
      if (id === 'confirmarCerrarSesion') return logoutConfirm;
      if (id === 'confirmarCerrarSesionModal') return {};
      return null;
    },
  };
  const window = {
    bootstrap: { Modal: { getOrCreateInstance: () => modal } },
    location: { href: '' },
  };

  vm.runInNewContext(script, { document, window });
  assert.equal(typeof delegatedClick, 'function');
  assert.equal(typeof confirmClick, 'function');

  let prevented = false;
  const sidebarTrigger = {
    closest(selector) {
      return selector === '[data-logout-trigger]' ? this : null;
    },
  };
  delegatedClick({
    target: sidebarTrigger,
    preventDefault() {
      prevented = true;
    },
  });

  assert.equal(prevented, true);
  assert.equal(modalShowCount, 1);
  confirmClick();
  assert.equal(modalHideCount, 1);
  assert.equal(window.location.href, '/milab/auth/logout');
});
