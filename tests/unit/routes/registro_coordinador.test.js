const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/registro_coordinador.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const mailPath = path.resolve(__dirname, '../../../src/libs/mail.js');
const emailLayoutPath = path.resolve(__dirname, '../../../src/libs/email-layout.js');
const accountEmailPath = path.resolve(__dirname, '../../../src/libs/account-email.js');
const appUrlPath = path.resolve(__dirname, '../../../src/libs/app-url.js');
const registrationTokenPath = path.resolve(__dirname, '../../../src/libs/registration-token.js');
const limiterPath = path.resolve(__dirname, '../../../src/routes/middlewares/limiter.js');
const securityLoggerPath = path.resolve(
  __dirname,
  '../../../src/routes/middlewares/security-logger.js'
);
const authPath = path.resolve(__dirname, '../../../src/routes/middlewares/auth.js');

function buildApp(route) {
  const app = express();

  app.use((req, res, next) => {
    req.session = {
      user: {
        tipo: 'admin',
        documento: '1024467835',
      },
    };
    res.render = (view, locals) => res.status(res.statusCode || 200).json({ view, locals });
    next();
  });
  app.use('/', route);

  return app;
}

function loadRoute() {
  const originals = new Map();
  const stubs = [
    [dbPath, { query: async () => ({ rows: [] }) }],
    [mailPath, { sendMail: async () => {} }],
    [
      emailLayoutPath,
      {
        buildBrandedEmailAttachments: () => [],
        buildEmailFooterHtml: () => '',
        buildEmailHeaderHtml: () => '',
      },
    ],
    [accountEmailPath, { normalizeLogDocument: (value) => value }],
    [
      appUrlPath,
      {
        appBaseUrl: 'https://labs.udistrital.edu.co/milab',
        buildAppUrl: (value) => value,
      },
    ],
    [registrationTokenPath, { getRegistrationTokenSecret: () => 'test-secret' }],
    [limiterPath, (req, res, next) => next()],
    [securityLoggerPath, { securityLogger: (req, res, next) => next() }],
    [
      authPath,
      {
        requireRoles: () => (req, res, next) => next(),
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

function loadRouteWithDbQuery(dbQueryImpl) {
  const originals = new Map();
  const stubs = [
    [dbPath, { query: dbQueryImpl }],
    [mailPath, { sendMail: async () => {} }],
    [
      emailLayoutPath,
      {
        buildBrandedEmailAttachments: () => [],
        buildEmailFooterHtml: () => '',
        buildEmailHeaderHtml: () => '',
        escapeHtml: (value) => String(value ?? ''),
      },
    ],
    [accountEmailPath, { normalizeLogDocument: (value) => value }],
    [
      appUrlPath,
      {
        appBaseUrl: 'https://labs.udistrital.edu.co/milab',
        buildAppUrl: (value) => value,
      },
    ],
    [registrationTokenPath, { getRegistrationTokenSecret: () => 'test-secret' }],
    [limiterPath, (req, res, next) => next()],
    [securityLoggerPath, { securityLogger: (req, res, next) => next() }],
    [
      authPath,
      {
        requireRoles: () => (req, res, next) => next(),
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

test('registro_coordinador parses form bodies before validating the request', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/').type('form').send({
      nombre: 'Coordinador Prueba',
      documento: '79520182',
      correo: 'coordinador@udistrital.edu.co',
      numero_resolucion_coordinador: 'Resolucion 123 de 2026',
      soporte_resolucion: 'https://example.test/resolucion.pdf',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.match(response.body.locals.message, /Debe seleccionar al menos una facultad/);
    assert.doesNotMatch(response.body.locals.message, /Invalid value/);
  } finally {
    loaded.restore();
  }
});

test('registro_coordinador returns specific validation messages instead of generic invalid value errors', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/').type('form').send({
      documento: '79520182',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.match(response.body.locals.message, /El correo institucional es obligatorio/);
    assert.match(response.body.locals.message, /El nombre es obligatorio/);
    assert.match(response.body.locals.message, /Debe seleccionar al menos una facultad/);
    assert.doesNotMatch(response.body.locals.message, /Invalid value/);
  } finally {
    loaded.restore();
  }
});

test('registro_coordinador does not require facultad_ids for coordinador_general', async () => {
  const loaded = loadRouteWithDbQuery(async (sql) => {
    const statement = String(sql || '');

    if (statement.includes('FROM coordinador WHERE documento = $1')) {
      return { rows: [] };
    }

    if (statement.includes('existing_emails')) {
      return { rows: [] };
    }

    if (
      statement.includes('SELECT id FROM usuario WHERE LOWER(correo) = LOWER($1) OR documento = $2')
    ) {
      return { rows: [] };
    }

    if (statement.includes('INSERT INTO usuario (correo, documento, nombre)')) {
      return { rows: [{ id: 654 }] };
    }

    if (
      statement.includes('INSERT INTO usuario_rol (usuario_id, rol_id)') ||
      statement.includes('INSERT INTO coordinador') ||
      statement.includes('UPDATE coordinador SET usuario_id = $1 WHERE documento = $2') ||
      statement.includes('INSERT INTO log (nombre, documento, accion, persona)')
    ) {
      return { rows: [] };
    }

    return { rows: [] };
  });

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/').type('form').send({
      role_name: 'coordinador_general',
      nombre: 'Coordinador General Prueba',
      documento: '79520183',
      correo: 'coordinador.general@udistrital.edu.co',
      numero_resolucion_coordinador: 'Resolucion 999 de 2026',
      soporte_resolucion: 'https://example.test/resolucion-general.pdf',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_success');
  } finally {
    loaded.restore();
  }
});

test('registro_coordinador creates coordinador_general successfully without facultad assignments', async () => {
  const calls = [];
  const loaded = loadRouteWithDbQuery(async (sql, params = []) => {
    const statement = String(sql || '');
    calls.push({ sql: statement, params });

    if (statement.includes('FROM coordinador WHERE documento = $1')) {
      return { rows: [] };
    }

    if (statement.includes('existing_emails')) {
      return { rows: [] };
    }

    if (
      statement.includes('SELECT id FROM usuario WHERE LOWER(correo) = LOWER($1) OR documento = $2')
    ) {
      return { rows: [] };
    }

    if (statement.includes('INSERT INTO usuario (correo, documento, nombre)')) {
      return { rows: [{ id: 321 }] };
    }

    if (statement.includes('INSERT INTO usuario_rol (usuario_id, rol_id)')) {
      return { rows: [] };
    }

    if (statement.includes('INSERT INTO coordinador')) {
      return { rows: [] };
    }

    if (statement.includes('UPDATE coordinador SET usuario_id = $1 WHERE documento = $2')) {
      return { rows: [] };
    }

    if (statement.includes('INSERT INTO log (nombre, documento, accion, persona)')) {
      return { rows: [] };
    }

    if (statement.includes('information_schema.columns')) {
      return { rows: [{ column_name: 'facultad_id' }] };
    }

    return { rows: [] };
  });

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/').type('form').send({
      role_name: 'coordinador_general',
      nombre: 'Coordinador General Exitoso',
      documento: '79520184',
      correo: 'coordinador.general.exitoso@udistrital.edu.co',
      numero_resolucion_coordinador: 'Resolucion 1000 de 2026',
      soporte_resolucion: 'https://example.test/resolucion-general-exitosa.pdf',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_success');
    assert.match(response.body.locals.message2, /Coordinador General/);

    const hasCoordinatorFacultyInsert = calls.some((entry) =>
      entry.sql.includes('INSERT INTO coordinador_facultad')
    );
    assert.equal(hasCoordinatorFacultyInsert, false);

    const hasGeneralRoleAssignment = calls.some(
      (entry) =>
        entry.sql.includes('INSERT INTO usuario_rol (usuario_id, rol_id)') &&
        entry.params[1] === 'coordinador_general'
    );
    assert.equal(hasGeneralRoleAssignment, true);
  } finally {
    loaded.restore();
  }
});
