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
        ...require(emailLayoutPath),
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
  const sentMessages = [];
  const stubs = [
    [dbPath, { query: dbQueryImpl }],
    [mailPath, { sendMail: async (message) => sentMessages.push(message) }],
    [
      emailLayoutPath,
      {
        ...require(emailLayoutPath),
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
    sentMessages,
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
    assert.match(response.body.locals.message, /Debe seleccionar una facultad válida/);
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
    assert.match(response.body.locals.message, /Debe seleccionar una facultad válida/);
    assert.doesNotMatch(response.body.locals.message, /Invalid value/);
  } finally {
    loaded.restore();
  }
});

test('registro_coordinador loads faculties separately from their dependencies', async () => {
  const loaded = loadRouteWithDbQuery(async (sql, params = []) => {
    const statement = String(sql || '');
    if (statement.includes('information_schema.columns')) {
      return {
        rows: [
          {
            column_name: params[1].includes('padre_id') ? 'padre_id' : 'dependencia_facultad_id',
          },
        ],
      };
    }
    if (statement.includes('FROM dependencia_facultad') && statement.includes('IS NULL')) {
      return { rows: [{ facultad_id: 10, nombre: 'Facultad A' }] };
    }
    if (statement.includes('FROM dependencia_facultad') && statement.includes('IS NOT NULL')) {
      return {
        rows: [{ dependencia_id: 101, facultad_id: 10, nombre: 'Dependencia A' }],
      };
    }
    return { rows: [] };
  });

  try {
    const response = await request(buildApp(loaded.route)).get('/load_info');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/registro_coordinador');
    assert.deepEqual(response.body.locals.facultades, [{ facultad_id: 10, nombre: 'Facultad A' }]);
    assert.deepEqual(response.body.locals.dependencias, [
      { dependencia_id: 101, facultad_id: 10, nombre: 'Dependencia A' },
    ]);
  } finally {
    loaded.restore();
  }
});

test('registro_coordinador does not require institutional scope for coordinador_general', async () => {
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
    assert.equal(loaded.sentMessages.length, 1);
    assert.equal(loaded.sentMessages[0].from.name, 'MILab — No responder');
    assert.match(loaded.sentMessages[0].text, /Por favor, no respondas a este correo/);
    assert.match(loaded.sentMessages[0].html, /Por favor, no respondas a este correo/);
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

test('registro_coordinador assigns a coordinator only to the selected dependencies', async () => {
  const calls = [];
  const loaded = loadRouteWithDbQuery(async (sql, params = []) => {
    const statement = String(sql || '');
    calls.push({ sql: statement, params });

    if (statement.includes('FROM coordinador WHERE documento = $1')) return { rows: [] };
    if (statement.includes('existing_emails')) return { rows: [] };
    if (
      statement.includes('SELECT id FROM usuario WHERE LOWER(correo) = LOWER($1) OR documento = $2')
    ) {
      return { rows: [] };
    }
    if (statement.includes('INSERT INTO usuario (correo, documento, nombre)')) {
      return { rows: [{ id: 321 }] };
    }
    if (statement.includes('information_schema.columns')) {
      return {
        rows: [
          {
            column_name: params[1].includes('padre_id') ? 'padre_id' : 'dependencia_facultad_id',
          },
        ],
      };
    }
    if (statement.includes('FROM dependencia_facultad') && statement.includes('IS NULL')) {
      return { rows: [{ facultad_id: 10, nombre: 'Facultad de prueba' }] };
    }
    if (statement.includes('FROM dependencia_facultad') && statement.includes('ANY($2::int[])')) {
      return {
        rows: [
          { dependencia_id: 101, nombre: 'Dependencia A' },
          { dependencia_id: 102, nombre: 'Dependencia B' },
        ],
      };
    }
    return { rows: [] };
  });

  try {
    const response = await request(buildApp(loaded.route))
      .post('/')
      .type('form')
      .send({
        nombre: 'Coordinador Prueba',
        documento: '79520185',
        correo: 'coordinador.prueba@udistrital.edu.co',
        role_name: 'coordinador',
        facultad_id: '10',
        alcance: 'dependencias',
        dependencia_ids: ['101', '102'],
        numero_resolucion_coordinador: 'Resolucion 1001 de 2026',
        soporte_resolucion: 'https://example.test/resolucion.pdf',
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_success');
    const assignment = calls.find((call) => call.sql.includes('INSERT INTO coordinador_facultad'));
    assert.deepEqual(assignment.params, ['79520185', [101, 102]]);
    assert.match(assignment.sql, /UNNEST\(\$2::int\[\]\)/);
    assert.match(loaded.sentMessages[0].text, /Dependencia A \(Facultad de prueba\)/);
  } finally {
    loaded.restore();
  }
});

test('registro_coordinador assigns the faculty itself for whole-faculty scope', async () => {
  const calls = [];
  const loaded = loadRouteWithDbQuery(async (sql, params = []) => {
    const statement = String(sql || '');
    calls.push({ sql: statement, params });
    if (statement.includes('FROM coordinador WHERE documento = $1')) return { rows: [] };
    if (statement.includes('existing_emails')) return { rows: [] };
    if (
      statement.includes('SELECT id FROM usuario WHERE LOWER(correo) = LOWER($1) OR documento = $2')
    ) {
      return { rows: [] };
    }
    if (statement.includes('INSERT INTO usuario (correo, documento, nombre)')) {
      return { rows: [{ id: 322 }] };
    }
    if (statement.includes('information_schema.columns')) {
      return {
        rows: [
          {
            column_name: params[1].includes('padre_id') ? 'padre_id' : 'dependencia_facultad_id',
          },
        ],
      };
    }
    if (statement.includes('FROM dependencia_facultad') && statement.includes('IS NULL')) {
      return { rows: [{ facultad_id: 10, nombre: 'Facultad completa' }] };
    }
    return { rows: [] };
  });

  try {
    const response = await request(buildApp(loaded.route)).post('/').type('form').send({
      nombre: 'Coordinador Prueba',
      documento: '79520187',
      correo: 'coordinador.facultad@udistrital.edu.co',
      role_name: 'coordinador',
      facultad_id: '10',
      alcance: 'facultad',
      numero_resolucion_coordinador: 'Resolucion 1003 de 2026',
      soporte_resolucion: 'https://example.test/resolucion.pdf',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_success');
    const assignment = calls.find((call) => call.sql.includes('INSERT INTO coordinador_facultad'));
    assert.deepEqual(assignment.params, ['79520187', [10]]);
    assert.equal(
      calls.some((call) => call.sql.includes('ANY($2::int[])')),
      false
    );
  } finally {
    loaded.restore();
  }
});

test('registro_coordinador rejects dependencies outside the selected faculty', async () => {
  const loaded = loadRouteWithDbQuery(async (sql, params = []) => {
    const statement = String(sql || '');
    if (statement.includes('FROM coordinador WHERE documento = $1')) return { rows: [] };
    if (statement.includes('existing_emails')) return { rows: [] };
    if (statement.includes('information_schema.columns')) {
      return {
        rows: [
          {
            column_name: params[1].includes('padre_id') ? 'padre_id' : 'dependencia_facultad_id',
          },
        ],
      };
    }
    if (statement.includes('FROM dependencia_facultad') && statement.includes('IS NULL')) {
      return { rows: [{ facultad_id: 10, nombre: 'Facultad de prueba' }] };
    }
    if (statement.includes('FROM dependencia_facultad') && statement.includes('ANY($2::int[])')) {
      return { rows: [{ dependencia_id: 101, nombre: 'Dependencia A' }] };
    }
    return { rows: [] };
  });

  try {
    const response = await request(buildApp(loaded.route))
      .post('/')
      .type('form')
      .send({
        nombre: 'Coordinador Prueba',
        documento: '79520186',
        correo: 'coordinador.prueba@udistrital.edu.co',
        role_name: 'coordinador',
        facultad_id: '10',
        alcance: 'dependencias',
        dependencia_ids: ['101', '999'],
        numero_resolucion_coordinador: 'Resolucion 1002 de 2026',
        soporte_resolucion: 'https://example.test/resolucion.pdf',
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.match(response.body.locals.message, /no pertenecen a la facultad seleccionada/i);
    assert.equal(loaded.sentMessages.length, 0);
  } finally {
    loaded.restore();
  }
});
