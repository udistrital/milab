const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const ejs = require('ejs');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/gestores_laboratorio.js');
const viewPath = path.resolve(__dirname, '../../../src/views/home/gestores_laboratorio.ejs');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const accountEmailPath = path.resolve(__dirname, '../../../src/libs/account-email.js');
const authPath = path.resolve(__dirname, '../../../src/routes/middlewares/auth.js');
const errorHandlerPath = path.resolve(
  __dirname,
  '../../../src/routes/middlewares/error-handler.js'
);

function buildApp(route, sessionUser) {
  const app = express();
  app.use((req, res, next) => {
    req.session = { user: sessionUser };
    res.render = (view, locals) => res.status(res.statusCode || 200).json({ view, locals });
    next();
  });
  app.use('/', route);
  return app;
}

function loadRoute({ clientQueryImpl, poolQueryImpl } = {}) {
  const originals = new Map();
  const poolCalls = [];
  const clientCalls = [];

  const client = {
    async query(sql, params = []) {
      clientCalls.push({ sql, params });
      if (clientQueryImpl) return clientQueryImpl(sql, params);
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('SELECT id FROM rol WHERE nombre')) return { rows: [{ id: 8 }] };
      if (sql.includes('SELECT id, documento FROM usuario')) {
        return { rows: [{ id: 20, documento: '12345' }] };
      }
      if (sql.includes('SELECT r.nombre')) return { rows: [] };
      if (sql.includes('SELECT activo FROM usuario_rol')) return { rows: [] };
      if (sql.includes('SELECT ur.activo, u.documento')) {
        return { rows: [{ activo: true, documento: '12345' }] };
      }
      return { rows: [] };
    },
    release() {},
  };

  const pool = {
    async query(sql, params = []) {
      poolCalls.push({ sql, params });
      if (poolQueryImpl) return poolQueryImpl(sql, params);
      if (sql.includes('SELECT id FROM rol WHERE nombre')) return { rows: [{ id: 8 }] };
      return { rows: [] };
    },
    async connect() {
      return client;
    },
  };

  const stubs = [
    [dbPath, pool],
    [accountEmailPath, { normalizeLogDocument: (value) => value }],
    [
      authPath,
      {
        renderAuthError: (res, payload) => res.status(403).json(payload),
      },
    ],
    [
      errorHandlerPath,
      {
        renderApplicationError: (res) =>
          res.status(500).json({ message: 'No fue posible cargar la gestión.' }),
      },
    ],
  ];

  delete require.cache[routePath];
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
    route: require(routePath),
    poolCalls,
    clientCalls,
    restore() {
      for (const [modulePath, original] of originals.entries()) {
        if (original) {
          require.cache[modulePath] = original;
        } else {
          delete require.cache[modulePath];
        }
      }
      delete require.cache[routePath];
    },
  };
}

test('gestores_laboratorio view compiles', () => {
  const view = fs.readFileSync(viewPath, 'utf8');
  assert.doesNotThrow(() => {
    ejs.compile(view, { filename: viewPath });
  });
  assert.match(view, /Enrolar una cuenta existente/);
  assert.match(view, /Guardar cambios/);
  assert.doesNotMatch(view, /name="ual_ids"/);
});

test('gestores_laboratorio denies users without an explicit admin role', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, { tipo: 'coordinador_general' });
    const response = await request(app).get('/');

    assert.equal(response.status, 403);
    assert.equal(loaded.poolCalls.length, 0);
  } finally {
    loaded.restore();
  }
});

test('gestores_laboratorio enrols an existing account university-wide without creating a user', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, {
      id: 3,
      tipo: 'admin',
      documento_real: '900',
    });
    const response = await request(app).post('/enrolar').type('form').send({ user_id: '20' });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/gestores_laboratorio');
    assert.match(response.body.locals.success, /cobertura universitaria, sin UAL/i);
    assert.equal(
      loaded.clientCalls.some((call) => /INSERT\s+INTO\s+usuario\s*\(/i.test(call.sql)),
      false
    );
    assert.equal(
      loaded.clientCalls.some((call) => call.sql.includes('INSERT INTO usuario_rol')),
      true
    );
    assert.equal(
      loaded.clientCalls.some((call) => call.sql.includes('INSERT INTO log')),
      true
    );
    assert.equal(
      loaded.clientCalls.some((call) =>
        /INSERT\s+INTO\s+usuario_ual_rol_operativo/i.test(call.sql)
      ),
      false
    );
    assert.equal(
      loaded.clientCalls.some((call) => /FROM\s+ual\b/i.test(call.sql)),
      false
    );
  } finally {
    loaded.restore();
  }
});

test('gestores_laboratorio creates a new account and assigns the role without UALs', async () => {
  const loaded = loadRoute({
    clientQueryImpl: async (sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('SELECT id FROM rol WHERE nombre')) return { rows: [{ id: 8 }] };
      if (sql.includes('SELECT id') && sql.includes('LOWER(correo)')) return { rows: [] };
      if (sql.includes('INSERT INTO usuario (correo, documento, nombre)')) {
        return { rows: [{ id: 20 }] };
      }
      return { rows: [] };
    },
  });

  try {
    const app = buildApp(loaded.route, {
      id: 3,
      tipo: 'admin',
      documento_real: '900',
    });
    const response = await request(app).post('/crear').type('form').send({
      nombre: 'Gestora Nueva',
      documento: '12345',
      correo: 'GESTORA@UDISTRITAL.EDU.CO',
    });

    assert.equal(response.status, 200);
    assert.match(response.body.locals.success, /sin asociar UAL/i);
    const createUser = loaded.clientCalls.find((call) =>
      call.sql.includes('INSERT INTO usuario (correo, documento, nombre)')
    );
    assert.deepEqual(createUser.params, ['gestora@udistrital.edu.co', '12345', 'Gestora Nueva']);
    assert.equal(
      loaded.clientCalls.some((call) => call.sql.includes('INSERT INTO usuario_rol')),
      true
    );
    assert.equal(
      loaded.clientCalls.some((call) => /usuario_ual_rol_operativo/i.test(call.sql)),
      false
    );
    assert.equal(
      loaded.clientCalls.some((call) => call.sql.includes('INSERT INTO log')),
      true
    );
  } finally {
    loaded.restore();
  }
});

test('gestores_laboratorio directs duplicate identities to the existing-account flow', async () => {
  const loaded = loadRoute({
    clientQueryImpl: async (sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('SELECT id FROM rol WHERE nombre')) return { rows: [{ id: 8 }] };
      if (sql.includes('SELECT id') && sql.includes('LOWER(correo)')) {
        return { rows: [{ id: 44 }] };
      }
      return { rows: [] };
    },
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'admin' });
    const response = await request(app).post('/crear').type('form').send({
      nombre: 'Gestora Existente',
      documento: '12345',
      correo: 'gestora@udistrital.edu.co',
    });

    assert.equal(response.status, 409);
    assert.match(response.body.locals.error, /cuenta existente/i);
    assert.equal(
      loaded.clientCalls.some((call) => call.sql.includes('INSERT INTO usuario (correo')),
      false
    );
    assert.equal(
      loaded.clientCalls.some((call) => call.sql.includes('INSERT INTO usuario_rol')),
      false
    );
  } finally {
    loaded.restore();
  }
});

test('gestores_laboratorio ignores UAL input when enrolling an existing account', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, {
      id: 3,
      tipo: 'admin',
      documento_real: '900',
    });
    const response = await request(app)
      .post('/enrolar')
      .type('form')
      .send({ user_id: '20', ual_ids: ['4'] });

    assert.equal(response.status, 200);
    assert.equal(
      loaded.clientCalls.some((call) => /FROM\s+ual\b/i.test(call.sql)),
      false
    );
    assert.equal(
      loaded.clientCalls.some((call) =>
        /INSERT\s+INTO\s+usuario_ual_rol_operativo/i.test(call.sql)
      ),
      false
    );
  } finally {
    loaded.restore();
  }
});

test('gestores_laboratorio does not assign a manager role to an account with privileged roles', async () => {
  const loaded = loadRoute({
    clientQueryImpl: async (sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('SELECT id FROM rol WHERE nombre')) return { rows: [{ id: 8 }] };
      if (sql.includes('SELECT id, documento FROM usuario')) {
        return { rows: [{ id: 20, documento: '12345' }] };
      }
      if (sql.includes('SELECT r.nombre')) return { rows: [{ nombre: 'coordinador' }] };
      return { rows: [] };
    },
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'admin' });
    const response = await request(app)
      .post('/enrolar')
      .type('form')
      .send({ user_id: '20', ual_ids: ['4'] });

    assert.equal(response.status, 400);
    assert.match(response.body.locals.error, /permisos administrativos o de laboratorista/i);
    assert.equal(
      loaded.clientCalls.some((call) => call.sql.includes('INSERT INTO usuario_rol')),
      false
    );
  } finally {
    loaded.restore();
  }
});

test('gestores_laboratorio edits an enrolled account profile and audits the change', async () => {
  const loaded = loadRoute({
    clientQueryImpl: async (sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('SELECT id FROM rol WHERE nombre')) return { rows: [{ id: 8 }] };
      if (sql.includes('SELECT id, documento FROM usuario')) {
        return { rows: [{ id: 20, documento: '12345' }] };
      }
      if (sql.includes('SELECT activo FROM usuario_rol')) return { rows: [{ activo: true }] };
      if (sql.includes('SELECT id') && sql.includes('LOWER(correo)')) return { rows: [] };
      return { rows: [] };
    },
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', documento: '900' });
    const response = await request(app).post('/editar').type('form').send({
      user_id: '20',
      nombre: 'Gestora Editada',
      documento: '54321',
      correo: 'gestora@udistrital.edu.co',
    });

    assert.equal(response.status, 200);
    assert.match(response.body.locals.success, /54321/);
    const update = loaded.clientCalls.find((call) => call.sql.includes('UPDATE usuario'));
    assert.deepEqual(update.params, ['Gestora Editada', '54321', 'gestora@udistrital.edu.co', 20]);
    assert.equal(
      loaded.clientCalls.some((call) => call.sql.includes('UPDATE perfil_estudiante')),
      true
    );
    assert.equal(
      loaded.clientCalls.some((call) => call.sql.includes('UPDATE perfil_docente')),
      true
    );
    assert.equal(
      loaded.clientCalls.some((call) => call.sql.includes('INSERT INTO log')),
      true
    );
  } finally {
    loaded.restore();
  }
});

test('gestores_laboratorio re-enrols an inactive gestor without UAL assignments', async () => {
  const loaded = loadRoute({
    clientQueryImpl: async (sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('SELECT id FROM rol WHERE nombre')) return { rows: [{ id: 8 }] };
      if (sql.includes('SELECT ur.activo, u.documento, u.activo')) {
        return {
          rows: [{ activo: false, documento: '12345', cuenta_activa: true }],
        };
      }
      if (sql.includes('to_regclass')) {
        return { rows: [{ tabla: 'usuario_ual_rol_operativo' }] };
      }
      return { rows: [] };
    },
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', documento: '900' });
    const response = await request(app).post('/20/enrolar');

    assert.equal(response.status, 200);
    assert.match(response.body.locals.success, /Se enroló nuevamente/);
    assert.equal(
      loaded.clientCalls.some((call) => call.sql.includes('UPDATE usuario_rol')),
      true
    );
    assert.equal(
      loaded.clientCalls.some((call) => call.sql.includes('UPDATE usuario_ual_rol_operativo')),
      true
    );
    assert.equal(
      loaded.clientCalls.some((call) =>
        /INSERT\s+INTO\s+usuario_ual_rol_operativo/i.test(call.sql)
      ),
      false
    );
    assert.equal(
      loaded.clientCalls.some((call) => call.sql.includes('INSERT INTO log')),
      true
    );
  } finally {
    loaded.restore();
  }
});

test('gestores_laboratorio deactivation disables access and legacy UAL assignments', async () => {
  const loaded = loadRoute({
    clientQueryImpl: async (sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('SELECT id FROM rol WHERE nombre')) return { rows: [{ id: 8 }] };
      if (sql.includes('SELECT ur.activo, u.documento')) {
        return { rows: [{ activo: true, documento: '12345' }] };
      }
      if (sql.includes('to_regclass')) {
        return { rows: [{ tabla: 'usuario_ual_rol_operativo' }] };
      }
      return { rows: [] };
    },
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'admin', documento: '900' });
    const response = await request(app).post('/20/desactivar');

    assert.equal(response.status, 200);
    assert.equal(
      loaded.clientCalls.some((call) => call.sql.includes('UPDATE usuario_rol')),
      true
    );
    assert.equal(
      loaded.clientCalls.some((call) => call.sql.includes('UPDATE usuario_ual_rol_operativo')),
      true
    );
    assert.equal(
      loaded.clientCalls.some((call) => /DELETE\s+FROM/i.test(call.sql)),
      false
    );
    assert.equal(
      loaded.clientCalls.some((call) => call.sql.includes('INSERT INTO log')),
      true
    );
  } finally {
    loaded.restore();
  }
});
