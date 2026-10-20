const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const root = path.resolve(__dirname, '../../..');
const routePath = path.join(root, 'src/routes/api/encuentros.js');
const poolPath = path.join(root, 'src/libs/db.js');

function buildTestApp(query) {
  const originalPool = require.cache[poolPath];
  delete require.cache[routePath];
  require.cache[poolPath] = {
    id: poolPath,
    filename: poolPath,
    loaded: true,
    exports: { query },
  };
  const router = require(routePath);
  const app = express();
  app.set('views', path.join(root, 'src/views'));
  app.set('view engine', 'ejs');
  app.use((req, _res, next) => {
    const role = req.get('x-test-role');
    req.session = role
      ? { user: { id: 12, documento: '12345', nombre: 'Operador', roles: [role], tipo: role } }
      : {};
    next();
  });
  app.use('/encuentros', router);
  return {
    app,
    restore() {
      delete require.cache[routePath];
      if (originalPool) require.cache[poolPath] = originalPool;
      else delete require.cache[poolPath];
    },
  };
}

test('Encuentros management endpoints reject unauthenticated and unauthorized users', async () => {
  let queries = 0;
  const setup = buildTestApp(async () => {
    queries += 1;
    return { rows: [] };
  });

  try {
    const unauthenticated = await request(setup.app).get('/encuentros/api/eventos');
    assert.equal(unauthenticated.status, 401);
    const student = await request(setup.app)
      .get('/encuentros/api/eventos')
      .set('x-test-role', 'estudiante');
    assert.equal(student.status, 403);
    assert.equal(queries, 0);
  } finally {
    setup.restore();
  }
});

test('authorized manager can list events with database-backed pagination', async () => {
  const setup = buildTestApp(async (sql) => {
    if (sql.includes('COUNT(*)::int AS total')) return { rows: [{ total: 1 }] };
    return {
      rows: [
        {
          id: 3,
          nombre: 'Encuentro de prueba',
          fecha: '2026-10-20',
          hora_inicio: '09:00',
          hora_fin: '10:00',
          lugar: 'Sede',
          organizador: 'MiLab',
          estado: 'programado',
          participantes: 0,
        },
      ],
    };
  });

  try {
    const response = await request(setup.app)
      .get('/encuentros/api/eventos')
      .set('x-test-role', 'admin');
    assert.equal(response.status, 200);
    assert.equal(response.body.eventos[0].nombre, 'Encuentro de prueba');
    assert.equal(response.body.paginacion.total, 1);
  } finally {
    setup.restore();
  }
});

test('public certificate verification exposes only required certificate data', async () => {
  let queryCount = 0;
  const setup = buildTestApp(async () => {
    queryCount += 1;
    return {
      rows: [
        {
          codigo: 'CERTIFICADO-123',
          estado: 'valido',
          fecha_emision: '2026-10-20T10:00:00.000Z',
          evento: 'Encuentro institucional',
          fecha_evento: '2026-10-20',
          participante: 'Participante de prueba',
        },
      ],
    };
  });

  try {
    const response = await request(setup.app).get(`/encuentros/verificar/${'a'.repeat(64)}`);
    assert.equal(response.status, 200);
    assert.match(response.text, /Encuentro institucional/);
    assert.match(response.text, /Participante de prueba/);
    assert.doesNotMatch(response.text, /documento|correo/i);
    assert.equal(queryCount, 1);

    const invalid = await request(setup.app).get('/encuentros/verificar/not-a-token');
    assert.equal(invalid.status, 200);
    assert.match(invalid.text, /no existe o no es válido/);
    assert.equal(queryCount, 1);
  } finally {
    setup.restore();
  }
});

test('personal achievements are scoped to the authenticated MiLab user', async () => {
  let queryValues;
  const setup = buildTestApp(async (sql, values) => {
    assert.match(sql, /WHERE l\.usuario_id = \$1/);
    queryValues = values;
    return {
      rows: [{ id: 4, evento: 'Encuentro institucional', codigo_certificado: 'CERT-123' }],
    };
  });

  try {
    const response = await request(setup.app)
      .get('/encuentros/api/mis-logros')
      .set('x-test-role', 'estudiante');
    assert.equal(response.status, 200);
    assert.equal(response.body.logros[0].codigo_certificado, 'CERT-123');
    assert.deepEqual(queryValues, [12]);
  } finally {
    setup.restore();
  }
});
