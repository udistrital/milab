const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/profile.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const oatiClientPath = path.resolve(__dirname, '../../../src/libs/oati-client.js');
const userIdentityPath = path.resolve(__dirname, '../../../src/libs/user-identity.js');

function buildApp(route, sessionData) {
  const app = express();

  app.use(express.urlencoded({ extended: true }));

  app.use((req, res, next) => {
    req.session = sessionData;
    if (typeof req.session.regenerate !== 'function') {
      req.session.regenerate = (callback) => {
        const preserved = {};
        Object.keys(req.session).forEach((key) => {
          if (key === 'regenerate' || key === 'destroy') return;
          preserved[key] = req.session[key];
          delete req.session[key];
        });
        Object.assign(req.session, preserved);
        callback(null);
      };
    }
    if (typeof req.session.destroy !== 'function') {
      req.session.destroy = (callback) => {
        Object.keys(req.session).forEach((key) => {
          if (key === 'regenerate' || key === 'destroy') return;
          delete req.session[key];
        });
        callback(null);
      };
    }
    res.render = (view, locals) => res.status(res.statusCode || 200).json({ view, locals });
    next();
  });
  app.use('/', route);

  return app;
}

function loadRoute({
  poolQueryImpl,
  requestOatiImpl,
  fetchUserByEmailImpl,
  buildSessionUserImpl,
} = {}) {
  const originals = new Map();
  const stubs = [
    [
      dbPath,
      {
        query: async (sql, params = []) => {
          if (typeof poolQueryImpl === 'function') {
            return poolQueryImpl(sql, params);
          }
          return { rows: [] };
        },
      },
    ],
    [
      oatiClientPath,
      {
        getAcademicServicePath: (v) => v,
        requestOati:
          requestOatiImpl ||
          (async () => ({ datosEstudianteCollection: { datosBasicosEstudiante: [] } })),
      },
    ],
    [
      userIdentityPath,
      {
        buildSessionUser: buildSessionUserImpl || ((u) => u),
        fetchUserByEmail: fetchUserByEmailImpl || (async () => null),
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

test('profile identify redirects to login when microsoftProfile is missing', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, {});
    const response = await request(app).get('/identify');

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/milab/auth/login');
  } finally {
    loaded.restore();
  }
});

test('profile identify renders validation error when documento is empty', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, {
      microsoftProfile: { correo: 'persona@udistrital.edu.co', nombre: 'Persona' },
    });
    const response = await request(app).post('/identify').type('form').send({ documento: '' });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/profile_identify');
    assert.match(response.body.locals.error, /numero de documento valido/i);
  } finally {
    loaded.restore();
  }
});

test('profile post rejects non institutional email', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, {
      microsoftProfile: { correo: 'no-institucional@gmail.com' },
    });
    const response = await request(app).post('/').type('form').send({
      modo: 'crear',
      nombre: 'Usuario Prueba',
      correo: 'no-institucional@gmail.com',
      documento: '12345',
      codigo: '2024123',
      estado: 'ACTIVO',
      carrera: 'Ingenieria',
      tipo_usuario: 'estudiante',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/profile');
    assert.match(response.body.locals.error, /Solo se permiten correos institucionales/i);
  } finally {
    loaded.restore();
  }
});

test('profile identify promotes placeholder account and enrolls estudiante', async () => {
  const executed = [];

  const loaded = loadRoute({
    poolQueryImpl: async (sql) => {
      executed.push(sql);

      if (
        sql.includes('FROM usuario') &&
        sql.includes('WHERE documento = $1') &&
        sql.includes('LIMIT 1')
      ) {
        return {
          rows: [
            {
              id: 25,
              documento: '1000586756',
              correo: 'no-email+1000586756@placeholder.milab.local',
              nombre: 'Placeholder Cuenta',
              codigo: null,
              estado: null,
              carrera: null,
            },
          ],
        };
      }

      if (
        sql.includes(
          'SELECT id FROM usuario WHERE LOWER(correo) = LOWER($1) OR documento = $2 LIMIT 1'
        )
      ) {
        return { rows: [{ id: 25 }] };
      }

      return { rows: [] };
    },
    requestOatiImpl: async (servicePath) => {
      if (String(servicePath).includes('datos_basicos_activos_cedula/1000586756')) {
        return {
          datosEstudianteCollection: {
            datosBasicosEstudiante: [
              {
                nombre: 'GUTIERREZ ALVAREZ MICHAEL STIVEN',
                codigo: '20251377015',
                estado: 'A',
                carrera: '31',
              },
            ],
          },
        };
      }

      if (String(servicePath).includes('estados_codigo/A')) {
        return { estado: { nombre: 'ACTIVO' } };
      }

      if (String(servicePath).includes('carrera/31')) {
        return { carrerasCollection: { carrera: [{ nombre: 'INGENIERIA DE PRODUCCION' }] } };
      }

      return {};
    },
    fetchUserByEmailImpl: async (correo) => ({
      id: 25,
      correo,
      documento: '1000586756',
      nombre: 'GUTIERREZ ALVAREZ MICHAEL STIVEN',
      roles: ['estudiante'],
      tipo: 'estudiante',
    }),
    buildSessionUserImpl: (u) => u,
  });

  try {
    const session = {
      microsoftProfile: {
        correo: 'michael.gutierrez@udistrital.edu.co',
        nombre: 'GUTIERREZ ALVAREZ MICHAEL STIVEN',
      },
    };

    const app = buildApp(loaded.route, session);
    const response = await request(app)
      .post('/identify')
      .type('form')
      .send({ documento: '1000586756' });

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/milab/inicio');
    assert.equal(session.user?.correo, 'michael.gutierrez@udistrital.edu.co');
    assert.equal(Array.isArray(session.user?.roles), true);
    assert.equal(
      executed.some((sql) => sql.includes('INSERT INTO usuario_rol')),
      true
    );
    assert.equal(
      executed.some((sql) => sql.includes('INSERT INTO perfil_estudiante')),
      true
    );
  } finally {
    loaded.restore();
  }
});
