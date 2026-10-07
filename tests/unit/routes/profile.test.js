const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/profile.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const oatiClientPath = path.resolve(__dirname, '../../../src/libs/oati-client.js');
const userIdentityPath = path.resolve(__dirname, '../../../src/libs/user-identity.js');
const studentRecordPath = path.resolve(__dirname, '../../../src/libs/oati-student-record.js');

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
  delete require.cache[studentRecordPath];
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
      delete require.cache[studentRecordPath];
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

const DOC = '1001219870';
const CORREO = 'est@udistrital.edu.co';
const NOMBRE = 'ESTUDIANTE PRUEBA';

function buildRegistrationStubs({
  records = [],
  docentes = [],
  estadoNames = { A: 'ACTIVO', E: 'EGRESADO' },
  milabTables = {},
  assignedRoles = [],
  assignedRolesCorreo = `no-email+${DOC}@placeholder.milab.local`,
  usuarioRow = null,
} = {}) {
  const executed = [];
  return {
    executed,
    options: {
      poolQueryImpl: async (sql, params) => {
        executed.push({ sql, params });
        for (const table of ['laboratorista', 'coordinador', 'monitor']) {
          if (sql.includes(`FROM ${table}`) && sql.includes('COALESCE(activo, TRUE)')) {
            return { rows: milabTables[table] ? [milabTables[table]] : [] };
          }
        }
        if (sql.includes('JOIN usuario_rol ur') && sql.includes('u.documento = $1')) {
          return {
            rows: assignedRoles.map((rol) => ({
              rol,
              nombre: NOMBRE,
              correo: assignedRolesCorreo,
            })),
          };
        }
        if (sql.includes('FROM usuario') && sql.includes('WHERE documento = $1')) {
          return { rows: usuarioRow ? [usuarioRow] : [] };
        }
        if (sql.includes('SELECT id FROM usuario WHERE LOWER(correo) = LOWER($1)')) {
          return { rows: [{ id: 25 }] };
        }
        if (sql.includes('INSERT INTO usuario (correo, documento, nombre)')) {
          return { rows: [{ id: 25 }] };
        }
        return { rows: [] };
      },
      requestOatiImpl: async (servicePath) => {
        const value = String(servicePath);
        if (value.includes(`datos_basicos_activos_cedula/${DOC}`)) {
          return { datosEstudianteCollection: { datosBasicosEstudiante: records } };
        }
        if (value.includes(`consultar_estado_docente/${DOC}`)) {
          return { docentesCollection: { docente: docentes } };
        }
        const estado = value.match(/estados_codigo\/(\w+)/);
        if (estado) return { estado: { nombre: estadoNames[estado[1]] || estado[1] } };
        const carrera = value.match(/carrera\/(\w+)/);
        if (carrera) {
          return { carrerasCollection: { carrera: [{ nombre: `PROGRAMA ${carrera[1]}` }] } };
        }
        return {};
      },
      fetchUserByEmailImpl: async (correo) => ({
        id: 25,
        correo,
        documento: DOC,
        nombre: NOMBRE,
        roles: [],
      }),
    },
  };
}

const record = (codigo, estado, carrera) => ({ nombre: NOMBRE, codigo, estado, carrera });

function roleWrites(executed) {
  return executed
    .filter(({ sql }) => sql.includes('INSERT INTO usuario_rol'))
    .map(({ params }) => params[1]);
}

function deactivatedRoles(executed) {
  return executed
    .filter(({ sql }) => sql.includes('SET activo = FALSE'))
    .map(({ params }) => params[1]);
}

async function postIdentify(stubs, session = {}) {
  const loaded = loadRoute(stubs.options);
  try {
    const app = buildApp(loaded.route, {
      microsoftProfile: { correo: CORREO, nombre: NOMBRE },
      ...session,
    });
    const response = await request(app).post('/identify').type('form').send({ documento: DOC });
    return response;
  } finally {
    loaded.restore();
  }
}

test('registro solo ofrece registros de estudiante activos y descarta egresados', async () => {
  const stubs = buildRegistrationStubs({
    records: [
      record('20242583011', 'A', '383'),
      record('20151234', 'E', '578'),
      record('2023999', 'A', '20'),
    ],
  });
  const response = await postIdentify(stubs);

  assert.equal(response.status, 200);
  assert.equal(response.body.view, 'home/profile');
  assert.equal(response.body.locals.tipo_usuario, 'estudiante');
  assert.deepEqual(
    response.body.locals.opcionesCodigo.map((item) => item.codigo),
    ['20242583011', '2023999']
  );
  assert.equal(response.body.locals.codigo, '');
});

test('registro descarta un registro con estado A que OATI resuelve como EGRESADO', async () => {
  const stubs = buildRegistrationStubs({
    records: [record('20151234', 'A', '578')],
    estadoNames: { A: 'EGRESADO' },
  });

  const response = await postIdentify(stubs);

  assert.equal(response.body.view, 'home/message_error');
  assert.match(response.body.locals.message2, /no esta asociado para ingresar/i);
});

test('registro niega acceso a egresado sin docencia activa ni roles en MILab', async () => {
  const stubs = buildRegistrationStubs({
    records: [record('20151234', 'E', '578')],
    docentes: [{ nombre: NOMBRE, estado_docente: 'I' }],
  });

  const response = await postIdentify(stubs);

  assert.equal(response.body.view, 'home/message_error');
  assert.equal(roleWrites(stubs.executed).length, 0);
});

test('registro de egresado con docencia activa se presenta como docente', async () => {
  const stubs = buildRegistrationStubs({
    records: [record('20151234', 'E', '578')],
    docentes: [{ nombre: NOMBRE, estado_docente: 'A' }],
  });

  const response = await postIdentify(stubs);

  assert.equal(response.body.view, 'home/profile');
  assert.equal(response.body.locals.tipo_usuario, 'docente');
  assert.equal(response.body.locals.codigo, '');
});

test('registro sin perfil OATI activo ingresa solo con roles registrados en MILab', async () => {
  const stubs = buildRegistrationStubs({
    records: [record('20151234', 'E', '578')],
    milabTables: { monitor: { documento: DOC, nombre: NOMBRE, correo: CORREO } },
    assignedRoles: ['admin', 'estudiante'],
  });

  const response = await postIdentify(stubs);

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/milab/inicio');
  assert.deepEqual(roleWrites(stubs.executed).sort(), ['admin', 'monitor']);
  assert.deepEqual(deactivatedRoles(stubs.executed).sort(), ['docente', 'estudiante']);
  assert.equal(
    stubs.executed.some(({ sql }) => sql.includes('UPDATE monitor')),
    true
  );
});

test('registro asigna estudiante, docente y roles de MILab en un solo paso', async () => {
  const stubs = buildRegistrationStubs({
    records: [record('20242583011', 'A', '383')],
    docentes: [{ nombre: NOMBRE, estado_docente: 'A' }],
    milabTables: { laboratorista: { documento: DOC, nombre: NOMBRE, correo: CORREO } },
    usuarioRow: { id: 25, documento: DOC, correo: `no-email+${DOC}@placeholder.milab.local` },
  });

  const response = await postIdentify(stubs);

  assert.equal(response.status, 302);
  assert.deepEqual(roleWrites(stubs.executed).sort(), ['docente', 'estudiante', 'laboratorista']);
  const perfil = stubs.executed.find(({ sql }) => sql.includes('INSERT INTO perfil_estudiante'));
  assert.equal(perfil.params[2], '20242583011');
});

async function postRegistro(stubs, registroPendiente, body) {
  const loaded = loadRoute(stubs.options);
  try {
    const app = buildApp(loaded.route, {
      microsoftProfile: { correo: CORREO, nombre: NOMBRE },
      registroPendiente,
    });
    return await request(app)
      .post('/')
      .type('form')
      .send({ modo: 'crear', correo: CORREO, documento: DOC, nombre: NOMBRE, ...body });
  } finally {
    loaded.restore();
  }
}

const pendienteDosProgramas = {
  correo: CORREO,
  documento: DOC,
  estudiantes: [
    { codigo: '20242583011', estado: 'ACTIVO', carrera: 'PROGRAMA 383', nombre: NOMBRE },
    { codigo: '2023999', estado: 'ACTIVO', carrera: 'PROGRAMA 20', nombre: NOMBRE },
  ],
  docente: null,
  milabRoles: ['monitor'],
};

test('registro rechaza un código que no está entre los registros activos validados', async () => {
  const stubs = buildRegistrationStubs();

  const response = await postRegistro(stubs, pendienteDosProgramas, {
    tipo_usuario: 'estudiante',
    codigo: '20151234',
    estado: 'EGRESADO',
    carrera: 'X',
  });

  assert.equal(response.body.view, 'home/profile');
  assert.match(response.body.locals.error, /Seleccione el código/);
  assert.equal(response.body.locals.opcionesCodigo.length, 2);
  assert.equal(roleWrites(stubs.executed).length, 0);
});

test('registro guarda el código elegido con datos validados en el servidor', async () => {
  const stubs = buildRegistrationStubs();

  const response = await postRegistro(stubs, pendienteDosProgramas, {
    tipo_usuario: 'estudiante',
    codigo: '2023999',
    estado: 'MANIPULADO',
    carrera: 'MANIPULADA',
  });

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/milab/inicio');
  assert.deepEqual(roleWrites(stubs.executed).sort(), ['estudiante', 'monitor']);
  const perfil = stubs.executed.find(({ sql }) => sql.includes('INSERT INTO perfil_estudiante'));
  assert.deepEqual(perfil.params.slice(2), ['2023999', 'PROGRAMA 20', 'ACTIVO']);
});

test('registro sin validación previa en identify redirige a identify', async () => {
  const stubs = buildRegistrationStubs();

  const response = await postRegistro(stubs, null, {
    tipo_usuario: 'estudiante',
    codigo: '2023999',
    estado: 'ACTIVO',
    carrera: 'X',
  });

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/milab/api/profile/identify');
});

test('registro ignora roles asignados a una cuenta con correo real del mismo documento', async () => {
  const stubs = buildRegistrationStubs({
    records: [record('20151234', 'E', '578')],
    assignedRoles: ['admin'],
    assignedRolesCorreo: 'otra.persona@udistrital.edu.co',
  });

  const response = await postIdentify(stubs);

  assert.equal(response.body.view, 'home/message_error');
  assert.equal(roleWrites(stubs.executed).length, 0);
});

for (const roles of [['estudiante'], ['docente'], ['admin']]) {
  test(`perfil rechaza modificaciones de un usuario con sesión (${roles[0]})`, async () => {
    const executed = [];
    const loaded = loadRoute({
      poolQueryImpl: async (sql, params) => {
        executed.push({ sql, params });
        return { rows: [] };
      },
    });

    try {
      const app = buildApp(loaded.route, {
        user: { id: 25, documento: DOC, correo: CORREO, roles, tipo: roles[0] },
      });
      const response = await request(app).post('/').type('form').send({
        nombre: 'Otro Nombre',
        correo: 'otra@udistrital.edu.co',
        documento: '99999999',
        codigo: '20151234',
        estado: 'ACTIVO',
        carrera: 'X',
        tipo_usuario: 'estudiante',
      });

      assert.equal(response.status, 403);
      assert.equal(response.body.locals.readonly, true);
      assert.match(response.body.locals.error, /no se puede modificar/);
      assert.equal(
        executed.some(({ sql }) => /UPDATE|INSERT/.test(sql)),
        false
      );
    } finally {
      loaded.restore();
    }
  });
}
