const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

const {
  loadModuleWithStubs,
  resolveRepoPath,
} = require('../../integration/helpers/build-test-app');

const routePath = resolveRepoPath('src/routes/api/certificacion-edx.js');
const edxClientPath = resolveRepoPath('src/libs/edx-cert-client.js');

function buildApp(clientStub) {
  const loaded = loadModuleWithStubs({
    entryPath: routePath,
    stubs: [[edxClientPath, clientStub]],
    purgePaths: [routePath],
  });
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use('/', loaded.loaded);

  return {
    app,
    restore: loaded.restore,
  };
}

test('EDX course endpoint validates both required identifiers', async () => {
  const loaded = buildApp({
    consultarCurso: async () => ({ completado: true }),
    consultarCursosUsuario: async () => ({ cursos: [] }),
    healthCheck: async () => true,
    USE_MOCK: true,
    BASE_URL: 'http://edx.test',
  });

  try {
    const response = await request(loaded.app).post('/curso').send({});

    assert.equal(response.status, 400);
    assert.deepEqual(response.body.errores.map((error) => error.path).sort(), [
      'codigo_curso',
      'codigo_usuario',
    ]);
  } finally {
    loaded.restore();
  }
});

test('EDX course endpoint returns the input and certification result', async () => {
  const calls = [];
  const loaded = buildApp({
    consultarCurso: async (...args) => {
      calls.push(args);
      return { completado: true, nota: 95 };
    },
    consultarCursosUsuario: async () => ({ cursos: [] }),
    healthCheck: async () => true,
    USE_MOCK: true,
    BASE_URL: 'http://edx.test',
  });

  try {
    const response = await request(loaded.app)
      .post('/curso')
      .send({ codigo_usuario: '100001', codigo_curso: 'COURSE-1' });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.entrada, {
      codigo_usuario: '100001',
      codigo_curso: 'COURSE-1',
    });
    assert.deepEqual(response.body.respuesta_edx, { completado: true, nota: 95 });
    assert.deepEqual(calls, [['100001', 'COURSE-1']]);
    assert.equal(typeof response.body.timestamp, 'string');
  } finally {
    loaded.restore();
  }
});

test('EDX user endpoint reports completed and pending course totals', async () => {
  const loaded = buildApp({
    consultarCurso: async () => ({ completado: false }),
    consultarCursosUsuario: async () => ({
      cursos: [
        { codigo_curso: 'COURSE-1', completado: true },
        { codigo_curso: 'COURSE-2', completado: false },
        { codigo_curso: 'COURSE-3', completado: true },
      ],
    }),
    healthCheck: async () => true,
    USE_MOCK: false,
    BASE_URL: 'https://edx.test',
  });

  try {
    const response = await request(loaded.app).post('/usuario').send({ codigo_usuario: '200001' });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.resumen, {
      total_cursos: 3,
      completados: 2,
      pendientes: 1,
    });
    assert.equal(response.body.entrada.codigo_usuario, '200001');
    assert.equal(response.body.respuesta_edx.cursos.length, 3);
  } finally {
    loaded.restore();
  }
});

test('EDX service errors are translated to a gateway response', async () => {
  const loaded = buildApp({
    consultarCurso: async () => {
      throw new Error('upstream unavailable');
    },
    consultarCursosUsuario: async () => {
      throw new Error('upstream unavailable');
    },
    healthCheck: async () => false,
    USE_MOCK: false,
    BASE_URL: 'https://edx.test',
  });

  try {
    const response = await request(loaded.app)
      .post('/curso')
      .send({ codigo_usuario: '100001', codigo_curso: 'COURSE-1' });

    assert.equal(response.status, 502);
    assert.equal(response.body.error, 'Fallo la comunicación con el servicio EDX');
    assert.match(response.body.detalle, /upstream unavailable/);
  } finally {
    loaded.restore();
  }
});

test('EDX health endpoint reports an unavailable service without failing the diagnostics request', async () => {
  const loaded = buildApp({
    consultarCurso: async () => ({ completado: false }),
    consultarCursosUsuario: async () => ({ cursos: [] }),
    healthCheck: async () => false,
    USE_MOCK: false,
    BASE_URL: 'https://edx.test',
  });

  try {
    const response = await request(loaded.app).get('/estado');

    assert.equal(response.status, 200);
    assert.equal(response.body.configuracion.modo, 'PRODUCCION (EDX real)');
    assert.equal(response.body.servicio.disponible, false);
    assert.equal(response.body.servicio.health_check_url, 'https://edx.test/health');
  } finally {
    loaded.restore();
  }
});
