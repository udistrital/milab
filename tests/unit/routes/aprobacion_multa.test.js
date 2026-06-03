const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/aprobacion_multa.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const mailPath = path.resolve(__dirname, '../../../src/libs/mail.js');
const emailLayoutPath = path.resolve(__dirname, '../../../src/libs/email-layout.js');
const facultyScopePath = path.resolve(__dirname, '../../../src/libs/faculty-scope.js');
const authPath = path.resolve(__dirname, '../../../src/routes/middlewares/auth.js');

function buildApp(route) {
  const app = express();

  app.use((req, res, next) => {
    req.session = {
      user: {
        tipo: 'coordinador',
        documento: 'coord-user',
        nombre: 'Coordinador Prueba',
      },
    };
    res.render = (view, locals) => res.status(res.statusCode || 200).json({ view, locals });
    next();
  });
  app.use('/', route);

  return app;
}

function loadRoute({ scopeImpl, queryImpl } = {}) {
  const originals = new Map();

  const stubs = [
    [
      dbPath,
      {
        query: async (sql, params = []) => {
          if (typeof queryImpl === 'function') {
            return queryImpl(sql, params);
          }

          if (sql.includes('WHERE m.con_estado_multa IN')) {
            return { rows: [{ id: 1, con_estado_multa: 'Pendiente' }] };
          }

          return { rows: [], rowCount: 1 };
        },
      },
    ],
    [mailPath, { sendMail: async () => {} }],
    [
      emailLayoutPath,
      {
        buildBrandedEmailAttachments: () => [],
        buildEmailFooterHtml: () => '',
        buildEmailHeaderHtml: () => '',
        escapeHtml: (value) => value,
      },
    ],
    [
      facultyScopePath,
      {
        resolveCoordinatorScope:
          scopeImpl || (async () => ({ coordinatorDocument: '900', facultyIds: [10] })),
      },
    ],
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

test('aprobacion_multa renders access error when coordinator has no document scope', async () => {
  const loaded = loadRoute({
    scopeImpl: async () => ({ coordinatorDocument: null, facultyIds: [10] }),
  });

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).get('/');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.match(response.body.locals.message, /No se encontró información del coordinador/i);
  } finally {
    loaded.restore();
  }
});

test('aprobacion_multa activar rejects invalid sanction type', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/activar').type('form').send({
      multa_id: '1',
      tipo_sancion: 'sancion-invalida',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.match(response.body.locals.message, /Tipo de sanción inválido/i);
  } finally {
    loaded.restore();
  }
});

test('aprobacion_multa activar redirects on successful update', async () => {
  const loaded = loadRoute({
    queryImpl: async (sql) => {
      if (sql.includes('UPDATE multa AS m')) {
        return { rowCount: 1, rows: [] };
      }

      if (sql.includes('SELECT m.usuario_id_sancionado')) {
        return {
          rows: [
            { usuario_id_sancionado: 77, fecha_multa: '2026-01-01', ual: 'Lab', obs_multa: '' },
          ],
        };
      }

      if (sql.includes('SELECT u.nombre, u.documento, u.codigo, u.correo')) {
        return { rows: [{ nombre: 'Estudiante', documento: '123', codigo: '2024', correo: '' }] };
      }

      return { rows: [], rowCount: 1 };
    },
  });

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/activar').type('form').send({
      multa_id: '1',
      tipo_sancion: 'Firma de compromiso de buen uso',
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, './');
  } finally {
    loaded.restore();
  }
});
