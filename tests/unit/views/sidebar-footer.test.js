const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ejs = require('ejs');

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
  const profileMenu = fs.readFileSync(path.join(viewsPath, 'partials/profile-menu.ejs'), 'utf8');
  const styles = fs.readFileSync(stylesPath, 'utf8');

  assert.equal((footer.match(/data-sidebar-action="/g) || []).length, 4);
  ['Perfil de usuario', 'Mis medallas', 'Centro de ayuda', 'Cerrar sesión'].forEach((label) => {
    assert.match(footer, new RegExp(`aria-label="${label}"`));
    assert.match(footer, new RegExp(`title="${label}"`));
  });
  assert.match(footer, /include\('\.\/profile-menu',/);
  assert.match(footer, /app-sidebar-avatar-mouth--neutral/);
  assert.match(footer, /app-sidebar-avatar-mouth--smile/);
  assert.match(footer, /bi-door-open/);
  assert.match(footer, /bi-door-closed/);
  ['Nombre', 'Documento', 'Roles'].forEach((label) => assert.match(profileMenu, new RegExp(label)));
  assert.doesNotMatch(profileMenu, /data-logout-trigger|Mis medallas|Centro de ayuda/);
  const renderedProfileMenu = ejs.render(profileMenu, {
    sessionName: 'Andres Mendez',
    sessionDocument: '1024467835',
    sessionRole: 'Admin',
    shouldShowAvatarSanctionsBadge: false,
    activeSanctionsCount: 0,
    activeSanctionsSummary: { items: [] },
    sanctionsActionHref: '/milab/api/sanciones/mis-sanciones',
    studentUsageSummary: null,
    activeRole: 'admin',
    accountLinks: [],
  });
  ['Andres Mendez', '1024467835', 'Admin'].forEach((value) =>
    assert.match(renderedProfileMenu, new RegExp(value))
  );
  assert.doesNotMatch(footer, /<span class="visually-hidden">/);
  assert.match(
    styles,
    /app-sidebar-footer\s*\{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/
  );
  assert.match(styles, /app-sidebar-profile-menu/);
  assert.match(styles, /max-height: min\(70vh, 38rem\)/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
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
