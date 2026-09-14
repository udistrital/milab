const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/get-data1.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const recaptchaPath = path.resolve(__dirname, '../../../src/libs/recaptcha.js');
const userIdentityPath = path.resolve(__dirname, '../../../src/libs/user-identity.js');
const limiterPath = path.resolve(__dirname, '../../../src/routes/middlewares/limiter.js');
const authPath = path.resolve(__dirname, '../../../src/routes/middlewares/auth.js');
const oatiPath = path.resolve(__dirname, '../../../src/libs/oati-client.js');

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

function loadGetDataRoute({ poolQueryImpl } = {}) {
  const originals = new Map();

  const poolStub = {
    async query(sql, params = []) {
      if (typeof poolQueryImpl === 'function') {
        return poolQueryImpl(sql, params);
      }
      return { rows: [] };
    },
  };

  const stubs = [
    [dbPath, poolStub],
    [
      recaptchaPath,
      {
        verifyRecaptchaToken: async () => ({ success: true }),
      },
    ],
    [
      userIdentityPath,
      {
        ensurePerfilEstudiante: async () => 261,
        isPlaceholderEmail: (email) =>
          String(email || '')
            .trim()
            .toLowerCase()
            .endsWith('@placeholder.milab.local'),
        resolveUsuarioIdForStudent: async () => 261,
      },
    ],
    [limiterPath, (req, res, next) => next()],
    [authPath, { requireRoles: () => (req, res, next) => next() }],
    [
      oatiPath,
      {
        getAcademicServicePath: (value) => value,
        requestOati: async () => ({}),
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

test('get-data1 exports an Express router with handlers', () => {
  delete require.cache[routePath];
  const router = require(routePath);

  assert.equal(typeof router, 'function');
  assert.equal(typeof router.use, 'function');
  assert.equal(Array.isArray(router.stack), true);
  assert.equal(router.stack.length > 0, true);
});

test('student self-service does not block placeholder-email account even with active sanctions', async () => {
  const loaded = loadGetDataRoute({
    poolQueryImpl: async (sql) => {
      if (sql.includes('SELECT documento, nombre, codigo, estado, carrera, correo FROM usuario')) {
        return {
          rows: [
            {
              documento: '1000586756',
              nombre: 'GUTIERREZ ALVAREZ MICHAEL STIVEN',
              codigo: '20251377015',
              estado: 'ACTIVO',
              carrera: 'INGENIERIA DE PRODUCCION (CICLOS PROPEDEUTICOS)',
              correo: 'no-email+1000586756@placeholder.milab.local',
            },
          ],
        };
      }

      if (sql.includes('SELECT COUNT(*) AS multado FROM multa')) {
        return { rows: [{ multado: '1' }] };
      }

      if (sql.includes('SELECT m.*, us.documento AS documento_sancionado')) {
        return {
          rows: [
            {
              id: 999,
              documento_sancionado: '1000586756',
            },
          ],
        };
      }

      if (sql.includes('SELECT correo') && sql.includes('FROM (')) {
        return { rows: [] };
      }

      return { rows: [] };
    },
  });

  try {
    const app = buildApp(loaded.route, {
      documento: '1000586756',
      documento_real: '1000586756',
      tipo: 'estudiante',
      nombre: 'Michael',
      roles: ['estudiante'],
    });

    const response = await request(app).get('/verificacion');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/get-info2');
    assert.equal(response.body.locals.documento, '1000586756');
  } finally {
    loaded.restore();
  }
});
