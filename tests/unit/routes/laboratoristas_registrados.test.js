const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/laboratoristas_registrados.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const accountEmailPath = path.resolve(__dirname, '../../../src/libs/account-email.js');
const authPath = path.resolve(__dirname, '../../../src/routes/middlewares/auth.js');

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

function loadRoute({ sessionRole = 'admin', findConflictImpl, clientQueryImpl } = {}) {
  const originals = new Map();
  const clientCalls = [];
  const poolCalls = [];
  const sessionUser =
    sessionRole === 'coordinador'
      ? { tipo: 'coordinador', documento: 'coord-user' }
      : { tipo: 'admin', documento: '1024467835' };

  const client = {
    released: false,
    async query(sql, params = []) {
      clientCalls.push({ sql, params });
      if (typeof clientQueryImpl === 'function') {
        return clientQueryImpl(sql, params);
      }

      if (sql.includes('SELECT documento, n_usuario, usuario_id FROM laboratorista')) {
        return {
          rows: [{ documento: '12345', n_usuario: '12345', usuario_id: 55 }],
        };
      }

      if (sql.includes('SELECT DISTINCT u.facultad_id')) {
        return { rows: [{ facultad_id: 2 }] };
      }

      if (sql.includes('SELECT ual_id FROM ual WHERE activo = TRUE AND facultad_id = $1')) {
        return { rows: [{ ual_id: 11 }, { ual_id: 12 }] };
      }

      if (sql.includes('SELECT documento FROM coordinador WHERE nombre_u = $1')) {
        return { rows: [{ documento: '900' }] };
      }

      if (
        sql.includes(
          'SELECT facultad_id FROM coordinador_facultad WHERE coordinador_documento_id = $1'
        )
      ) {
        return { rows: [{ facultad_id: 10 }, { facultad_id: 20 }] };
      }

      return { rows: [] };
    },
    release() {
      this.released = true;
    },
  };

  const stubs = [
    [
      dbPath,
      {
        async query(sql, params = []) {
          poolCalls.push({ sql, params });
          return { rows: [] };
        },
        async connect() {
          return client;
        },
      },
    ],
    [
      accountEmailPath,
      {
        findEmailConflict: findConflictImpl || (async () => null),
        isInstitutionalEmail: (correo) => /@udistrital\.edu\.co$/i.test(String(correo || '')),
        isUniqueViolation: () => false,
        normalizeInstitutionalEmail: (value) =>
          String(value || '')
            .trim()
            .toLowerCase(),
        normalizeLogDocument: (value) => value,
      },
    ],
    [
      authPath,
      {
        requireRoles: () => (req, res, next) => next(),
        requireJsonRoles: () => (req, res, next) => next(),
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
    sessionUser,
    getClientCalls: () => clientCalls,
    getPoolCalls: () => poolCalls,
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

test('laboratoristas_registrados /editar allows admin edit and updates assigned UALs', async () => {
  const loaded = loadRoute({ sessionRole: 'admin' });

  try {
    const app = buildApp(loaded.route, loaded.sessionUser);
    const response = await request(app)
      .post('/editar')
      .type('form')
      .send({
        documento: '12345',
        nombre: 'Laboratorista Editado',
        correo: 'lab.editado@udistrital.edu.co',
        facultad: '2',
        ual_ids: ['11', '12'],
        contrato: 'CPS',
      });

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/milab/api/laboratoristas_registrados?updated=1');

    const calls = loaded.getClientCalls();
    assert.equal(
      calls.some((call) => call.sql.includes('UPDATE laboratorista')),
      true
    );
    assert.equal(
      calls.some((call) =>
        call.sql.includes('DELETE FROM laboratorista_ual WHERE laboratorista_documento_id = $1')
      ),
      true
    );
    assert.equal(
      calls.some((call) =>
        call.sql.includes('INSERT INTO laboratorista_ual (laboratorista_documento_id, ual_id)')
      ),
      true
    );
  } finally {
    loaded.restore();
  }
});

test('laboratoristas_registrados /editar blocks coordinador when laboratorista faculty is outside scope', async () => {
  const loaded = loadRoute({
    sessionRole: 'coordinador',
    clientQueryImpl: async (sql) => {
      if (sql.includes('SELECT documento, n_usuario, usuario_id FROM laboratorista')) {
        return {
          rows: [{ documento: '12345', n_usuario: '12345', usuario_id: 55 }],
        };
      }

      if (sql.includes('SELECT DISTINCT u.facultad_id')) {
        return { rows: [{ facultad_id: 99 }] };
      }

      if (
        sql.includes(
          'SELECT facultad_id FROM coordinador_facultad WHERE coordinador_documento_id = $1'
        )
      ) {
        return { rows: [{ facultad_id: 10 }] };
      }

      return { rows: [] };
    },
  });

  try {
    const app = buildApp(loaded.route, loaded.sessionUser);
    const response = await request(app)
      .post('/editar')
      .type('form')
      .send({
        documento: '12345',
        nombre: 'Laboratorista Editado',
        correo: 'lab.editado@udistrital.edu.co',
        facultad: '10',
        ual_ids: ['11'],
        contrato: 'CPS',
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.match(response.body.locals.message, /Acceso denegado/i);

    const calls = loaded.getClientCalls();
    assert.equal(
      calls.some((call) => call.sql.includes('UPDATE laboratorista')),
      false
    );
  } finally {
    loaded.restore();
  }
});

test('laboratoristas_registrados /editar allows coordinador within scope and logs actor document', async () => {
  const loaded = loadRoute({
    sessionRole: 'coordinador',
    clientQueryImpl: async (sql) => {
      if (sql.includes('SELECT documento, n_usuario, usuario_id FROM laboratorista')) {
        return {
          rows: [{ documento: '12345', n_usuario: '12345', usuario_id: 55 }],
        };
      }

      if (sql.includes('SELECT DISTINCT u.facultad_id')) {
        return { rows: [{ facultad_id: 10 }] };
      }

      if (
        sql.includes(
          'SELECT facultad_id FROM coordinador_facultad WHERE coordinador_documento_id = $1'
        )
      ) {
        return { rows: [{ facultad_id: 10 }, { facultad_id: 20 }] };
      }

      if (sql.includes('SELECT ual_id FROM ual WHERE activo = TRUE AND facultad_id = $1')) {
        return { rows: [{ ual_id: 21 }, { ual_id: 22 }] };
      }

      if (sql.includes('SELECT documento FROM coordinador WHERE nombre_u = $1')) {
        return { rows: [{ documento: '900' }] };
      }

      return { rows: [] };
    },
  });

  try {
    const app = buildApp(loaded.route, loaded.sessionUser);
    const response = await request(app)
      .post('/editar')
      .type('form')
      .send({
        documento: '12345',
        nombre: 'Laboratorista Coord',
        correo: 'lab.coord@udistrital.edu.co',
        facultad: '20',
        ual_ids: ['21', '22'],
        contrato: 'Planta',
      });

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/milab/api/laboratoristas_registrados?updated=1');

    const calls = loaded.getClientCalls();
    const logCall = calls.find((call) =>
      call.sql.includes('INSERT INTO log (nombre, documento, accion, persona)')
    );

    assert.ok(logCall);
    assert.equal(logCall.params[1], '900');
  } finally {
    loaded.restore();
  }
});

test('laboratoristas_registrados /editar rejects institutional email conflict', async () => {
  const loaded = loadRoute({
    sessionRole: 'admin',
    findConflictImpl: async () => ({ source: 'usuario', documento: '99999' }),
  });

  try {
    const app = buildApp(loaded.route, loaded.sessionUser);
    const response = await request(app)
      .post('/editar')
      .type('form')
      .send({
        documento: '12345',
        nombre: 'Laboratorista Editado',
        correo: 'enconflicto@udistrital.edu.co',
        facultad: '2',
        ual_ids: ['11', '12'],
        contrato: 'CPS',
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.match(response.body.locals.message, /Correo en conflicto/i);

    const calls = loaded.getClientCalls();
    assert.equal(
      calls.some((call) => call.sql === 'BEGIN'),
      false
    );
  } finally {
    loaded.restore();
  }
});
