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

test('claim notification badges reflect unread student answers and assigned pending requests', async () => {
  for (const role of ['estudiante', 'laboratorista', 'admin']) {
    const loaded = loadNavigationModule({
      queryImpl: async (sql) =>
        sql.includes('reclamacion_sancion') ? { rows: [{ total: 2 }] } : { rows: [] },
    });
    try {
      const res = { locals: {} };
      await loaded.navigationMiddleware(
        { session: { user: { tipo: role, documento: '123' } } },
        res,
        (error) => assert.ifError(error)
      );
      assert.equal(res.locals.claimNotifications.count, 2);
      assert.match(
        res.locals.claimNotifications.href,
        role === 'estudiante' ? /mis-sanciones$/ : /reclamaciones$/
      );
      const query = loaded.getQueryCalls().find((call) => call.sql.includes('reclamacion_sancion'));
      assert.match(
        query.sql,
        role === 'estudiante' ? /fecha_lectura IS NULL/ : /fecha_respuesta IS NULL/
      );
    } finally {
      loaded.restore();
    }
  }
});

test('navigationMiddleware still renders when claim notifications cannot be queried', async () => {
  const loaded = loadNavigationModule({
    queryImpl: async (sql) => {
      if (sql.includes('reclamacion_sancion')) {
        throw Object.assign(new Error('permission denied for table reclamacion_sancion'), {
          code: '42501',
        });
      }
      return { rows: [] };
    },
  });
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const res = { locals: {} };
    let nextError;
    await loaded.navigationMiddleware(
      { session: { user: { tipo: 'admin', documento: '123' } } },
      res,
      (error) => {
        nextError = error;
      }
    );
    assert.equal(nextError, undefined);
    assert.equal(res.locals.claimNotifications, null);
    assert.equal(res.locals.isAuthenticated, true);
  } finally {
    console.warn = originalWarn;
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
    assert.ok(
      !loaded
        .getQueryCalls()
        .some(
          (call) =>
            call.sql.includes('FROM multa m') && call.sql.includes("IN ('Pendiente', 'POR SALDAR')")
        ),
      'no debe consultar el conteo de autorizaciones para un laboratorista'
    );
    assert.equal(res.locals.claimNotifications.count, 0);
  } finally {
    loaded.restore();
  }
});
