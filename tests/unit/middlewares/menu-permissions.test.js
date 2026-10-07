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

  const { menuPermissionMiddleware } = require(middlewarePath);

  return {
    menuPermissionMiddleware(req, res, next) {
      return menuPermissionMiddleware(req, res, (error) => {
        assert.ifError(error);
        next();
      });
    },
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
        return { rows: [{ id: 15, route: '/milab/api/get_list_multas' }] };
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
        return { rows: [{ id: 15, route: '/milab/api/get_list_multas' }] };
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
        return { rows: [{ id: 15, route: '/milab/api/get_list_multas' }] };
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

test('menuPermissionMiddleware prioritizes exact route over parent module fallback', async () => {
  const loaded = loadMiddleware({
    poolQueryImpl: async (sql, params) => {
      if (sql.includes('FROM menu_item')) {
        return {
          rows: [
            { id: 10, route: '/milab/api/get_list_estudiantes/get_consulta' },
            { id: 11, route: '/milab/api/get_list_estudiantes' },
          ],
        };
      }

      if (sql.includes('FROM rol_permiso')) {
        assert.deepEqual(params[0], [10]);
        return { rows: [{ '?column?': 1 }] };
      }

      return { rows: [] };
    },
  });

  try {
    const req = {
      originalUrl: '/milab/api/get_list_estudiantes/get_consulta',
      session: {
        user: {
          tipo: 'laboratorista',
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

for (const role of ['admin', 'laboratorista', 'coordinador']) {
  test(`menuPermissionMiddleware uses the bulk query menu for ${role} form submissions`, async () => {
    const loaded = loadMiddleware({
      poolQueryImpl: async (sql, params) => {
        if (sql.includes('FROM menu_item')) {
          assert.ok(params[0].includes('/milab/api/get_list_estudiantes/get_consulta'));
          return {
            rows: [
              { id: 11, route: '/milab/api/get_list_estudiantes' },
              { id: 10, route: '/milab/api/get_list_estudiantes/get_consulta' },
            ],
          };
        }

        if (sql.includes('FROM rol_permiso')) {
          assert.deepEqual(params, [[10], [role]]);
          return { rows: [{}] };
        }

        return { rows: [] };
      },
    });

    try {
      const req = {
        method: 'POST',
        originalUrl: '/milab/api/get_list_estudiantes/consulta_masiva/?source=form',
        session: { user: { tipo: role } },
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
}

for (const hasExplicitActionMenu of [false, true]) {
  test(`menuPermissionMiddleware preserves bulk query denials with explicit action menu=${hasExplicitActionMenu}`, async () => {
    const loaded = loadMiddleware({
      poolQueryImpl: async (sql, params) => {
        if (sql.includes('FROM menu_item')) {
          const rows = [
            { id: 11, route: '/milab/api/get_list_estudiantes' },
            { id: 10, route: '/milab/api/get_list_estudiantes/get_consulta' },
          ];
          if (hasExplicitActionMenu) {
            rows.push({ id: 12, route: '/milab/api/get_list_estudiantes/consulta_masiva' });
          }
          return { rows };
        }

        if (sql.includes('FROM rol_permiso')) {
          assert.deepEqual(params[0], [hasExplicitActionMenu ? 12 : 10]);
          return { rows: [] };
        }

        return { rows: [] };
      },
    });

    try {
      const req = {
        method: 'POST',
        originalUrl: '/milab/api/get_list_estudiantes/consulta_masiva',
        session: { user: { tipo: 'laboratorista' } },
      };
      const res = createResponse();
      let nextCalled = false;

      await loaded.menuPermissionMiddleware(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, false);
      assert.match(res.rendered.payload.message2, /No tienes permisos para este modulo/i);
    } finally {
      loaded.restore();
    }
  });
}

for (const requestPath of [
  '/milab/api/get_list_estudiantes',
  '/milab/api/get_list_estudiantes/consulta_masiva',
]) {
  test(`menuPermissionMiddleware does not grant bulk query permissions to GET ${requestPath}`, async () => {
    const loaded = loadMiddleware({
      poolQueryImpl: async (sql, params) => {
        if (sql.includes('FROM menu_item')) {
          assert.equal(params[0].includes('/milab/api/get_list_estudiantes/get_consulta'), false);
          return { rows: [{ id: 11, route: '/milab/api/get_list_estudiantes' }] };
        }

        if (sql.includes('FROM rol_permiso')) {
          assert.deepEqual(params[0], [11]);
          return { rows: [] };
        }

        return { rows: [] };
      },
    });

    try {
      const req = {
        method: 'GET',
        originalUrl: requestPath,
        session: { user: { tipo: 'laboratorista' } },
      };
      const res = createResponse();
      let nextCalled = false;

      await loaded.menuPermissionMiddleware(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, false);
      assert.match(res.rendered.payload.message, /Acceso denegado/i);
    } finally {
      loaded.restore();
    }
  });
}

test('menuPermissionMiddleware delegates course API authorization to its routes', async () => {
  const loaded = loadMiddleware({
    poolQueryImpl: async () => ({ rows: [] }),
  });

  try {
    const req = {
      method: 'GET',
      originalUrl: '/milab/api/capacitacion-cursos/facultades',
      session: {
        user: {
          tipo: 'admin',
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
    assert.equal(loaded.getCalls().length, 0);
  } finally {
    loaded.restore();
  }
});

test('menuPermissionMiddleware delegates impersonation exit without requiring the dashboard menu', async () => {
  const loaded = loadMiddleware({
    poolQueryImpl: async () => {
      throw new Error('Impersonation exit must use route authorization, not dashboard permissions');
    },
  });

  try {
    const req = {
      method: 'POST',
      originalUrl: '/milab/api/dashboard/impersonacion/detener/?source=header',
      session: { user: { tipo: 'estudiante' } },
    };
    const res = createResponse();
    let nextCalled = false;
    await loaded.menuPermissionMiddleware(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
    assert.equal(res.rendered, null);
    assert.equal(loaded.getCalls().length, 0);
  } finally {
    loaded.restore();
  }
});

for (const [method, pathname] of [
  ['GET', '/milab/api/dashboard/impersonacion/detener'],
  ['POST', '/milab/api/dashboard/impersonacion/iniciar'],
  ['POST', '/milab/api/dashboard/impersonacion/detener/extra'],
]) {
  test(`menuPermissionMiddleware still checks dashboard permissions for ${method} ${pathname}`, async () => {
    const loaded = loadMiddleware({
      poolQueryImpl: async (sql) => ({
        rows: sql.includes('FROM menu_item') ? [{ id: 1, route: '/milab/api/dashboard' }] : [],
      }),
    });
    try {
      const req = {
        method,
        originalUrl: pathname,
        session: { user: { tipo: 'estudiante' } },
      };
      const res = createResponse();
      let nextCalled = false;
      await loaded.menuPermissionMiddleware(req, res, () => {
        nextCalled = true;
      });
      assert.equal(nextCalled, false);
      assert.match(res.rendered.payload.message2, /No tienes permisos para este modulo/);
    } finally {
      loaded.restore();
    }
  });
}

test('menuPermissionMiddleware blocks unregistered private API GET routes', async () => {
  const loaded = loadMiddleware({
    poolQueryImpl: async () => ({ rows: [] }),
  });

  try {
    const req = {
      method: 'GET',
      originalUrl: '/milab/api/internal-health-check',
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
    assert.match(res.rendered.payload.message2, /No tienes permisos para esta ruta/i);
  } finally {
    loaded.restore();
  }
});

test('menuPermissionMiddleware allows unregistered private API non-GET routes', async () => {
  const loaded = loadMiddleware({
    poolQueryImpl: async () => ({ rows: [] }),
  });

  try {
    const req = {
      method: 'POST',
      originalUrl: '/milab/api/coordinadores_registrados/actualizar',
      session: {
        user: {
          tipo: 'admin',
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

test('menuPermissionMiddleware allows unregistered public API routes', async () => {
  const loaded = loadMiddleware({
    poolQueryImpl: async () => ({ rows: [] }),
  });

  try {
    const req = {
      method: 'GET',
      originalUrl: '/milab/api/consulta-invit',
      session: {},
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

test('menuPermissionMiddleware allows the public service status endpoint', async () => {
  const loaded = loadMiddleware({
    poolQueryImpl: async () => ({ rows: [] }),
  });

  try {
    const req = {
      method: 'GET',
      originalUrl: '/milab/api/check-services',
      session: {},
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

test('menuPermissionMiddleware allows delegated approval action POST routes', async () => {
  const loaded = loadMiddleware({
    poolQueryImpl: async () => {
      throw new Error('Database should not be queried for delegated action routes');
    },
  });

  try {
    const req = {
      method: 'POST',
      originalUrl: '/milab/api/aprobacion_multa/activar',
      session: {
        user: {
          tipo: 'laboratorista',
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

test('menuPermissionMiddleware allows delegated approval action POST routes without api prefix', async () => {
  const loaded = loadMiddleware({
    poolQueryImpl: async () => {
      throw new Error('Database should not be queried for delegated action routes');
    },
  });

  try {
    const req = {
      method: 'POST',
      originalUrl: '/milab/aprobacion_multa/aplazar',
      session: {
        user: {
          tipo: 'laboratorista',
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
