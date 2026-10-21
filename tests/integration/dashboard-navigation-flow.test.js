const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ejs = require('ejs');
const request = require('supertest');

const { buildApp, resolveRepoPath } = require('./helpers/build-test-app');
const { createSessionHarness, createUser } = require('./helpers/session-fixtures');

const routePath = resolveRepoPath('src/routes/api/dashboard.js');
const dbPath = resolveRepoPath('src/libs/db.js');
const authPath = resolveRepoPath('src/routes/middlewares/auth.js');
const normalizeRoleListForMatch = require(authPath).normalizeRoleListForMatch;
const facultyScopePath = resolveRepoPath('src/libs/faculty-scope.js');
const dashboardViewPath = resolveRepoPath('src/views/home/dashboard.ejs');
const dashboardStylesPath = resolveRepoPath('src/public/css/styles.css');

function createDashboardClient(scopeRows = {}) {
  return {
    async query(sql, params = []) {
      if (sql.includes('FROM information_schema.columns')) {
        return { rows: [{ column_name: params[1][0] }] };
      }

      if (sql.includes('FROM dependencia_facultad')) {
        return { rows: scopeRows.faculties || [] };
      }

      return { rows: [] };
    },
    release() {},
  };
}

function loadDashboardApp({ user, scopeImpl, scopeRows, poolRows = {} }) {
  const sessionHarness = createSessionHarness({ user });
  const client = createDashboardClient(scopeRows);

  const poolStub = {
    async query(sql, params = []) {
      if (sql.includes('FROM information_schema.columns')) {
        return { rows: [{ column_name: (params && params[1] && params[1][0]) || 'id' }] };
      }
      if (sql.includes('FROM dependencia_facultad')) {
        return { rows: scopeRows.faculties || [] };
      }
      if (sql.includes('FROM certificado_estudiante')) {
        return { rows: poolRows.studentCertificates || [] };
      }
      if (sql.includes('FROM certificado_docente')) {
        return { rows: poolRows.teacherCertificates || [] };
      }
      if (sql.includes('FROM multa')) {
        return { rows: poolRows.sanctions || [] };
      }
      if (sql.includes('FROM laboratorista')) {
        return { rows: poolRows.laboratoristas || [] };
      }
      if (sql.includes('FROM coordinador')) {
        return { rows: poolRows.coordinators || [] };
      }
      if (sql.includes('FROM usuario_rol')) {
        return { rows: poolRows.usuarioRoles || [] };
      }
      if (sql.includes('FROM usuario')) {
        return { rows: poolRows.usuarios || [] };
      }
      return { rows: [] };
    },
    async connect() {
      return client;
    },
  };

  return buildApp({
    entryPath: routePath,
    sessionHarness,
    stubs: [
      [dbPath, poolStub],
      [
        authPath,
        {
          normalizeRoleListForMatch,
          requireRoles: () => (req, res, next) => next(),
          requireJsonRoles: () => (req, res, next) => next(),
        },
      ],
      [
        facultyScopePath,
        {
          resolveAcademicFacultyName: (value) => value,
          resolveCoordinatorScope:
            scopeImpl || (async () => ({ coordinatorDocument: '900', facultyIds: [10] })),
        },
      ],
    ],
    purgePaths: [routePath],
  });
}

test('inventory dashboard is an in-page tab beside platform and peace-and-clearance tabs', () => {
  const template = fs.readFileSync(dashboardViewPath, 'utf8');
  const tabsStart = template.indexOf('<nav class="dashboard-section-tabs"');
  const tabsEnd = template.indexOf('</nav>', tabsStart);

  assert.notEqual(tabsStart, -1);
  assert.notEqual(tabsEnd, -1);

  const tabs = template.slice(tabsStart, tabsEnd);
  assert.match(tabs, /class="dashboard-section-tablist" role="tablist"/);
  assert.match(
    tabs,
    /<button[^>]*id="dashboardTabInventarios"[^>]*role="tab"[^>]*data-dashboard-section="inventarios"/
  );
  assert.match(template, /id="dashboardSectionInventarios"[^>]*data-dashboard-inventory-panel/);
  assert.match(
    template,
    /data-dashboard-inventory-url="\/milab\/api\/dashboard\/inventarios\?fragment=1"/
  );
  assert.doesNotMatch(tabs, /href="\/milab\/api\/dashboard\/inventarios"/);
  assert.doesNotMatch(template, /dashboard-section-tab-link/);
  assert.doesNotThrow(() => ejs.compile(template, { filename: dashboardViewPath }));
});

test('laboratorista dashboard omits platform monitoring and keeps authorized tabs', () => {
  const template = fs.readFileSync(dashboardViewPath, 'utf8');
  const tabsStart = template.indexOf('<nav class="dashboard-section-tabs"');
  const tabsEnd = template.indexOf('</nav>', tabsStart) + '</nav>'.length;
  const platformTabIndex = template.indexOf('id="dashboardTabGeneral"');
  const platformPanelIndex = template.indexOf('id="dashboardSectionGeneral"');
  const platformTabGuard = template.lastIndexOf(
    '<% if (canViewPlatformMonitoring) { %>',
    platformTabIndex
  );
  const platformPanelGuard = template.lastIndexOf(
    '<% if (canViewPlatformMonitoring) { %>',
    platformPanelIndex
  );
  const platformPanelEnd = template.indexOf(
    '\n  <% } %>\n\n  <% if (hasPazYSalvo) { %>',
    platformPanelIndex
  );

  assert.notEqual(platformTabIndex, -1);
  assert.ok(platformTabGuard < platformTabIndex);
  assert.notEqual(platformPanelIndex, -1);
  assert.ok(platformPanelGuard < platformPanelIndex);
  assert.notEqual(platformPanelEnd, -1);
  const renderedTabs = ejs.render(template.slice(tabsStart, tabsEnd), {
    canViewPlatformMonitoring: false,
    hasPazYSalvo: true,
  });
  const renderedPlatformPanel = ejs.render(
    template.slice(platformPanelGuard, platformPanelEnd + '\n  <% } %>'.length),
    { canViewPlatformMonitoring: false }
  );

  assert.doesNotMatch(renderedTabs, /Toda la plataforma/);
  assert.match(renderedTabs, /Paz y salvos/);
  assert.match(renderedTabs, /Dashboard de inventarios/);
  assert.equal(renderedPlatformPanel.trim(), '');
  assert.doesNotThrow(() => ejs.compile(template, { filename: dashboardViewPath }));
});

test('inventory dashboard tab constrains its content to the available width', () => {
  const styles = fs.readFileSync(dashboardStylesPath, 'utf8');

  assert.match(
    styles,
    /body\.app-shell \.dashboard-section-panel\[data-dashboard-inventory-panel\]\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*min-width:\s*0;/s
  );
  assert.match(
    styles,
    /body\.app-shell \.dashboard-inventory-content\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s
  );
});

test('inventory dashboard page route returns to its tab in the shared dashboard', async () => {
  const loaded = loadDashboardApp({
    user: createUser({ tipo: 'admin', roles: ['admin'] }),
  });

  try {
    const response = await request(loaded.app).get('/inventarios');
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/milab/api/dashboard#inventarios');
  } finally {
    loaded.restore();
  }
});

test('dashboard flow renders admin summary from mounted HTTP handler', async () => {
  const loaded = loadDashboardApp({
    user: createUser({ tipo: 'admin', roles: ['admin'] }),
    scopeRows: {},
  });

  try {
    const response = await request(loaded.app).get('/');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/dashboard');
    assert.equal(response.body.locals.dashboardRole, 'admin');
    assert.equal(response.body.locals.selectedChart, 'estudiantes');
  } finally {
    loaded.restore();
  }
});

test('dashboard flow rejects coordinators without associated faculties', async () => {
  const loaded = loadDashboardApp({
    user: createUser({ tipo: 'coordinador', roles: ['coordinador'], documento: 'coord-1' }),
    scopeImpl: async () => ({ coordinatorDocument: null, facultyIds: [] }),
    scopeRows: {},
  });

  try {
    const response = await request(loaded.app).get('/');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.match(response.body.locals.message2, /no tiene facultades asociadas/i);
  } finally {
    loaded.restore();
  }
});

test('dashboard flow keeps sanctions out of the coordinador platform tab', async () => {
  const loaded = loadDashboardApp({
    user: createUser({ tipo: 'coordinador', roles: ['coordinador'], documento: 'coord-1' }),
    scopeImpl: async () => ({ coordinatorDocument: 'coord-1', facultyIds: [10] }),
    scopeRows: {
      faculties: [{ nombre: 'Tecnologica' }],
    },
    poolRows: {
      sanctions: [
        {
          id: 101,
          fecha_multa: '2026-09-01T10:00:00.000Z',
          con_estado_multa: 'ACTIVA',
          faculty_id: 10,
          ual_id: 1001,
        },
        {
          id: 102,
          fecha_multa: '2026-09-02T10:00:00.000Z',
          con_estado_multa: 'ACTIVA',
          faculty_id: 99,
          ual_id: 9901,
        },
      ],
    },
  });

  try {
    const response = await request(loaded.app).get('/');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/dashboard');
    assert.equal(response.body.locals.dashboardRole, 'coordinador');

    const sanctionsChart = (response.body.locals.availableCharts || []).find(
      (chart) => chart.id === 'sanciones'
    );
    assert.equal(sanctionsChart, undefined);
    assert.equal(response.body.locals.scopeCounters, undefined);
    assert.equal('sanciones' in (response.body.locals.tablesData || {}), false);
  } finally {
    loaded.restore();
  }
});
