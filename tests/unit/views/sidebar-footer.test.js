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

  const logoutLinks = header.match(
    /<a\b(?=[^>]*\bdata-logout-trigger="true")(?=[^>]*\bhref="\/milab\/auth\/logout")[^>]*>/g
  );
  assert.equal(logoutLinks?.length, 3);
  assert.doesNotMatch(header, /<button\b(?=[^>]*\bdata-logout-trigger="true")/);
  assert.equal((footer.match(/data-sidebar-action="/g) || []).length, 4);
  ['Perfil de usuario', 'Mis medallas', 'Centro de ayuda', 'Cerrar sesión'].forEach((label) => {
    assert.match(footer, new RegExp(`aria-label="${label}"`));
    assert.match(footer, new RegExp(`title="${label}"`));
  });
  assert.match(footer, /include\('\.\/profile-menu',/);
  assert.match(footer, /formatSanctionDate,\s*sanctionsActionHref/);
  assert.match(footer, /formatUsageHours,/);
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
    shouldShowAvatarSanctionsBadge: true,
    activeSanctionsCount: 1,
    activeSanctionsSummary: {
      items: [
        {
          categoria: 'Seguridad',
          estado: 'Activa',
          tipo: 'General',
          ual: 'Laboratorio Uno',
          fecha: '2026-10-26',
        },
      ],
    },
    formatSanctionDate: () => '26/10/2026',
    sanctionsActionHref: '/milab/api/sanciones/mis-sanciones',
    studentUsageSummary: {
      items: [
        {
          icon: 'bi-clock',
          label: 'Horas de uso',
          hasLimit: true,
          used: 2.5,
          limit: 10,
          remaining: 7.5,
          percentage: 25,
        },
      ],
    },
    formatUsageHours: (value) => Number(value).toFixed(2),
    activeRole: 'admin',
    accountLinks: [],
  });
  ['Andres Mendez', '1024467835', 'Admin', '26/10/2026', '2.50 / 10.00 h'].forEach((value) =>
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
  assert.match(
    styles,
    /body\.app-shell \.app-sidebar\s*\{[^}]*height: auto;[^}]*max-height: calc\(100vh - 2rem\)/
  );
});

test('guided tour introduction offers dynamic modules and an all-modules route', () => {
  const introPath = path.join(viewsPath, 'partials/guided-tour-intro.ejs');
  const intro = ejs.render(fs.readFileSync(introPath, 'utf8'));
  const scripts = fs.readFileSync(
    path.resolve(__dirname, '../../../src/public/js/scripts.js'),
    'utf8'
  );

  assert.match(intro, /modal-dialog modal-dialog-centered/);
  assert.match(intro, /id="milabTourModuleSelect"/);
  assert.match(intro, /data-guide-start="module"/);
  assert.match(intro, /data-guide-start="all"/);
  assert.match(scripts, /getAvailableGuideModules/);
  assert.match(scripts, /scrollGuideTargetIntoView/);
  assert.match(scripts, /syncGuideDropdownForTarget/);
});

test('app footer follows the workspace without fixed blank spacers', () => {
  const footerPath = path.join(viewsPath, 'partials/footer.ejs');
  const footer = fs.readFileSync(footerPath, 'utf8');
  const styles = fs.readFileSync(stylesPath, 'utf8');

  assert.doesNotMatch(footer, /<br\s*\/?>\s*<br\s*\/?>/);
  assert.match(styles, /body\.app-shell \.app-frame\s*\{[^}]*padding-bottom:\s*0;/);
  assert.match(
    styles,
    /body\.app-shell \.app-workspace\s*\{[^}]*padding:\s*1\.25rem 1rem 0\.5rem;/
  );
  assert.match(styles, /body\.app-shell footer\.footer\s*\{\s*margin:\s*0\.5rem auto 0;/);
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
