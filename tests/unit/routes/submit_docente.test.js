const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/submit_docente.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const userIdentityPath = path.resolve(__dirname, '../../../src/libs/user-identity.js');
const authPath = path.resolve(__dirname, '../../../src/routes/middlewares/auth.js');

function buildApp(route) {
  const app = express();

  app.use((req, res, next) => {
    req.session = {
      user: {
        tipo: 'laboratorista',
        documento: '1024467835',
      },
    };
    res.render = (view, locals) => res.status(res.statusCode || 200).json({ view, locals });
    next();
  });

  app.use('/', route);
  return app;
}

function loadRoute({ resolveUsuarioId = async () => 88, queryImpl } = {}) {
  const originals = new Map();
  const executedQueries = [];
  const stubs = [
    [
      dbPath,
      {
        query: async (sql, params) => {
          executedQueries.push({ sql, params });
          if (typeof queryImpl === 'function') {
            return queryImpl(sql, params);
          }

          if (sql.includes('FROM laboratorista WHERE documento = $1 OR n_usuario = $1')) {
            return { rows: [{ documento: '1024467835' }] };
          }

          if (
            sql.includes(
              'SELECT 1 FROM laboratorista_ual WHERE laboratorista_documento_id = $1 AND ual_id = $2'
            )
          ) {
            return { rows: [{ '?column?': 1 }] };
          }

          return { rows: [] };
        },
      },
    ],
    [
      userIdentityPath,
      {
        resolveUsuarioIdForDocente: resolveUsuarioId,
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
    getExecutedQueries: () => executedQueries,
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

test('submit_docente rejects future fine date', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/').type('form').send({
      con_documento: '79520182',
      ual_id: '21',
      fecha_multa: '2999-12-31',
      con_estado_multa: 'Pendiente',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.match(response.body.locals.message, /no puede ser futura/i);
    assert.equal(loaded.getExecutedQueries().length, 0);
  } finally {
    loaded.restore();
  }
});

test('submit_docente rejects unauthorized UAL', async () => {
  const loaded = loadRoute({
    queryImpl: async (sql) => {
      if (sql.includes('FROM laboratorista WHERE documento = $1 OR n_usuario = $1')) {
        return { rows: [{ documento: '1024467835' }] };
      }

      if (
        sql.includes(
          'SELECT 1 FROM laboratorista_ual WHERE laboratorista_documento_id = $1 AND ual_id = $2'
        )
      ) {
        return { rows: [] };
      }

      return { rows: [] };
    },
  });

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/').type('form').send({
      con_documento: '79520182',
      ual_id: '21',
      fecha_multa: '2026-01-01',
      con_estado_multa: 'Pendiente',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.match(response.body.locals.message, /UAL no autorizada/i);
  } finally {
    loaded.restore();
  }
});

test('submit_docente rejects when sanctioned user is not found', async () => {
  const loaded = loadRoute({
    resolveUsuarioId: async () => null,
  });

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/').type('form').send({
      con_documento: '79520182',
      ual_id: '21',
      fecha_multa: '2026-01-01',
      con_estado_multa: 'Pendiente',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.match(response.body.locals.message, /No se encontró el docente/i);
    assert.equal(loaded.getExecutedQueries().length, 0);
  } finally {
    loaded.restore();
  }
});

test('submit_docente inserts fine and log when request is valid', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/').type('form').send({
      cat_multa: 'Uso indebido',
      con_documento: '79520182',
      ual_id: '21',
      fecha_multa: '2026-01-01',
      con_estado_multa: 'Pendiente',
      obs_multa: 'Observacion de prueba',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_success');
    assert.match(response.body.locals.message, /Multa registrada correctamente/i);

    const queries = loaded.getExecutedQueries().map((item) => item.sql);
    assert.equal(
      queries.some((sql) => sql.includes('INSERT INTO multa')),
      true,
      'debe insertar en multa'
    );
    assert.equal(
      queries.some((sql) => sql.includes('INSERT INTO log')),
      true,
      'debe insertar en log'
    );
  } finally {
    loaded.restore();
  }
});
