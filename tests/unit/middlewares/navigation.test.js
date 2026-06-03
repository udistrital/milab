const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const navigationPath = path.resolve(__dirname, '../../../src/routes/middlewares/navigation.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const facultyScopePath = path.resolve(__dirname, '../../../src/libs/faculty-scope.js');
const menuPath = path.resolve(__dirname, '../../../src/libs/menu.js');

function loadNavigationModule({ menuImpl, scopeImpl, queryImpl } = {}) {
  const originals = new Map();
  const queryCalls = [];

  const stubs = [
    [
      dbPath,
      {
        query: async (sql, params) => {
          queryCalls.push({ sql, params });
          if (typeof queryImpl === 'function') {
            return queryImpl(sql, params);
          }

          return { rows: [{ total: 0 }] };
        },
      },
    ],
    [
      facultyScopePath,
      {
        resolveCoordinatorScope:
          scopeImpl || (async () => ({ coordinatorDocument: null, facultyIds: [] })),
      },
    ],
    [
      menuPath,
      {
        getMenuForRoles:
          menuImpl ||
          (async () => ({
            primaryLinks: [],
            secondaryGroups: [],
            accountLinks: [],
          })),
      },
    ],
  ];

  delete require.cache[navigationPath];

  for (const [modulePath, stub] of stubs) {
    originals.set(modulePath, require.cache[modulePath]);
    require.cache[modulePath] = {
      id: modulePath,
      filename: modulePath,
      loaded: true,
      exports: stub,
    };
  }

  return {
    ...require(navigationPath),
    getQueryCalls: () => queryCalls,
    restore() {
      for (const [modulePath, original] of originals.entries()) {
        if (original) {
          require.cache[modulePath] = original;
        } else {
          delete require.cache[modulePath];
        }
      }

      delete require.cache[navigationPath];
    },
  };
}

test('navigationMiddleware builds dynamic menu by role when DB menu is available', async () => {
  const loaded = loadNavigationModule({
    menuImpl: async () => ({
      primaryLinks: [{ label: 'Panel coordinador', href: '/custom/panel', icon: 'bi-grid' }],
      secondaryGroups: [],
      accountLinks: [{ label: 'Perfil', href: '/custom/profile', icon: 'bi-person' }],
    }),
    scopeImpl: async () => ({ coordinatorDocument: null, facultyIds: [] }),
  });

  try {
    const req = {
      session: {
        user: {
          tipo: 'coordinador',
          documento: '1024467835',
        },
      },
    };
    const res = { locals: {} };
    let nextCalled = false;

    await loaded.navigationMiddleware(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(res.locals.tipo, 'coordinador');
    assert.deepEqual(res.locals.roles, ['coordinador']);
    assert.equal(res.locals.appNavigation.primaryLinks[0].href, '/custom/panel');
    assert.equal(res.locals.pendingSanctionsCount, 0);
  } finally {
    loaded.restore();
  }
});

test('buildNavigation falls back to static menu when dynamic menu lookup fails', async () => {
  const loaded = loadNavigationModule({
    menuImpl: async () => {
      throw new Error('db unavailable');
    },
  });

  try {
    const navigation = await loaded.buildNavigation({ tipo: 'admin' });

    assert.equal(navigation.isAuthenticated, true);
    assert.equal(
      navigation.primaryLinks.some((link) => link.href === '/milab/api/dashboard'),
      true,
      'debe usar fallback estático de admin con enlace a monitoreo'
    );
  } finally {
    loaded.restore();
  }
});

test('navigationMiddleware sets pending sanctions badge for coordinador', async () => {
  const loaded = loadNavigationModule({
    menuImpl: async () => ({ primaryLinks: [], secondaryGroups: [], accountLinks: [] }),
    scopeImpl: async () => ({ coordinatorDocument: '1024467835', facultyIds: [4, 7] }),
    queryImpl: async () => ({ rows: [{ total: 5 }] }),
  });

  try {
    const req = {
      session: {
        user: {
          tipo: 'coordinador',
          documento: '1024467835',
        },
      },
    };
    const res = { locals: {} };
    let nextCalled = false;

    await loaded.navigationMiddleware(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(res.locals.pendingSanctionsCount, 5);

    const queryCalls = loaded.getQueryCalls();
    assert.equal(queryCalls.length >= 1, true);
    assert.equal(
      queryCalls.some((call) => call.sql.includes('INNER JOIN ual u ON u.ual_id = m.ual_id')),
      true,
      'debe contar sanciones uniendo multa con ual'
    );
  } finally {
    loaded.restore();
  }
});

test('navigationMiddleware keeps pending sanctions badge at zero for non coordinador roles', async () => {
  const loaded = loadNavigationModule({
    menuImpl: async () => ({
      primaryLinks: [{ label: 'Monitoreo', href: '/milab/api/dashboard', icon: 'bi-activity' }],
      secondaryGroups: [],
      accountLinks: [],
    }),
  });

  try {
    const req = {
      session: {
        user: {
          tipo: 'laboratorista',
          documento: '1234567890',
        },
      },
    };
    const res = { locals: {} };
    let nextCalled = false;

    await loaded.navigationMiddleware(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(res.locals.pendingSanctionsCount, 0);
    assert.equal(loaded.getQueryCalls().length, 0, 'no debe consultar conteo para no coordinador');
  } finally {
    loaded.restore();
  }
});
