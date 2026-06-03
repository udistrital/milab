const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const middlewarePath = path.resolve(
  __dirname,
  '../../../src/routes/middlewares/menu-permissions.js'
);
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const authPath = path.resolve(__dirname, '../../../src/routes/middlewares/auth.js');

function createResponse() {
  return {
    rendered: null,
    render(view, payload) {
      this.rendered = { view, payload };
      return this;
    },
  };
}

function loadMiddleware({ poolQueryImpl } = {}) {
  const originals = new Map();
  const calls = [];
  const stubs = [
    [
      dbPath,
      {
        query: async (sql, params) => {
          calls.push({ sql, params });
          if (typeof poolQueryImpl === 'function') {
            return poolQueryImpl(sql, params);
          }

          return { rows: [] };
        },
      },
    ],
    [
      authPath,
      {
        renderAuthError(res, overrides = {}) {
          const payload = {
            message: '¡Algo ha salido mal!',
            message2: 'Inténtalo nuevamente',
            limit: 'noSession',
            ...overrides,
          };
          return res.render('home/message_error', payload);
        },
      },
    ],
  ];

  delete require.cache[middlewarePath];

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
    menuPermissionMiddleware: require(middlewarePath).menuPermissionMiddleware,
    getCalls: () => calls,
    restore() {
      for (const [modulePath, original] of originals.entries()) {
        if (original) {
          require.cache[modulePath] = original;
        } else {
          delete require.cache[modulePath];
        }
      }

      delete require.cache[middlewarePath];
    },
  };
}

test('menuPermissionMiddleware blocks protected route when user is missing', async () => {
  const loaded = loadMiddleware({
    poolQueryImpl: async (sql) => {
      if (sql.includes('FROM menu_item')) {
        return { rows: [{ id: 15 }] };
      }

      return { rows: [] };
    },
  });

  try {
    const req = {
      originalUrl: '/milab/api/get_list_multas',
      session: {},
    };
    const res = createResponse();
    let nextCalled = false;

    await loaded.menuPermissionMiddleware(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.rendered.view, 'home/message_error');
    assert.match(res.rendered.payload.message, /Acceso denegado/i);
  } finally {
    loaded.restore();
  }
});

test('menuPermissionMiddleware allows protected route with permitted role', async () => {
  const loaded = loadMiddleware({
    poolQueryImpl: async (sql) => {
      if (sql.includes('FROM menu_item')) {
        return { rows: [{ id: 15 }] };
      }

      if (sql.includes('FROM rol_permiso')) {
        return { rows: [{ '?column?': 1 }] };
      }

      return { rows: [] };
    },
  });

  try {
    const req = {
      originalUrl: '/milab/api/get_list_multas',
      session: {
        user: {
          tipo: 'coordinador',
        },
      },
    };
    const res = createResponse();
    let nextCalled = false;

    await loaded.menuPermissionMiddleware(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(res.rendered, null);
  } finally {
    loaded.restore();
  }
});

test('menuPermissionMiddleware blocks protected route with denied role', async () => {
  const loaded = loadMiddleware({
    poolQueryImpl: async (sql) => {
      if (sql.includes('FROM menu_item')) {
        return { rows: [{ id: 15 }] };
      }

      if (sql.includes('FROM rol_permiso')) {
        return { rows: [] };
      }

      return { rows: [] };
    },
  });

  try {
    const req = {
      originalUrl: '/milab/api/get_list_multas',
      session: {
        user: {
          tipo: 'estudiante',
        },
      },
    };
    const res = createResponse();
    let nextCalled = false;

    await loaded.menuPermissionMiddleware(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.rendered.view, 'home/message_error');
    assert.match(res.rendered.payload.message2, /No tienes permisos/i);
  } finally {
    loaded.restore();
  }
});
