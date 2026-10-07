const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('get-data exports an Express router with handlers', () => {
  const modulePath = path.resolve(__dirname, '../../../src/routes/api/get-data.js');
  delete require.cache[modulePath];
  const router = require(modulePath);

  assert.equal(typeof router, 'function');
  assert.equal(typeof router.use, 'function');
  assert.equal(Array.isArray(router.stack), true);
  assert.equal(router.stack.length > 0, true);
});

const os = require('node:os');
const express = require('express');
const request = require('supertest');

const getDataRoutePath = path.resolve(__dirname, '../../../src/routes/api/get-data.js');
const getDataStubPaths = {
  db: path.resolve(__dirname, '../../../src/libs/db.js'),
  appUrl: path.resolve(__dirname, '../../../src/libs/app-url.js'),
  generatePath: path.resolve(__dirname, '../../../src/libs/generate-path.js'),
  oatiClient: path.resolve(__dirname, '../../../src/libs/oati-client.js'),
  certificateEmail: path.resolve(__dirname, '../../../src/libs/certificate-email.js'),
  userIdentity: path.resolve(__dirname, '../../../src/libs/user-identity.js'),
  auth: path.resolve(__dirname, '../../../src/routes/middlewares/auth.js'),
};
const getDataStudentRecordPath = path.resolve(
  __dirname,
  '../../../src/libs/oati-student-record.js'
);

function loadGetDataRoute({ studentRecords, usuarioCodigoRows = [], multaRows = [] }) {
  const originals = new Map();
  const ensuredProfiles = [];
  const queries = [];
  const stubs = {
    db: {
      async query(sql, params) {
        queries.push({ sql, params });
        if (String(sql).includes('FROM multa m')) return { rows: multaRows };
        if (String(sql).includes('FROM usuario WHERE documento')) {
          return { rows: usuarioCodigoRows };
        }
        return { rows: [] };
      },
    },
    appUrl: { buildAppUrl: (value) => value },
    generatePath: { buildGeneratePath: (value) => path.join(os.tmpdir(), value) },
    oatiClient: {
      getAcademicServicePath: (value) => value,
      async requestOati(servicePath) {
        if (servicePath.startsWith('estados_codigo/')) {
          return { estado: { nombre: servicePath === 'estados_codigo/E' ? 'EGRESADO' : 'ACTIVO' } };
        }
        if (servicePath.startsWith('carrera/')) {
          return { carrerasCollection: { carrera: [{ nombre: 'Programa de prueba' }] } };
        }
        return { datosEstudianteCollection: { datosBasicosEstudiante: studentRecords } };
      },
    },
    certificateEmail: {
      buildCertificateEmailFailureFeedback: () => null,
      buildCertificateEmailFeedback: () => null,
      sendCertificateEmail: async () => null,
    },
    userIdentity: {
      async ensurePerfilEstudiante(profile) {
        ensuredProfiles.push(profile);
        return 7;
      },
    },
    auth: { requireRoles: () => (req, res, next) => next() },
  };

  delete require.cache[getDataRoutePath];
  delete require.cache[getDataStudentRecordPath];
  for (const [key, modulePath] of Object.entries(getDataStubPaths)) {
    originals.set(modulePath, require.cache[modulePath]);
    require.cache[modulePath] = {
      id: modulePath,
      filename: modulePath,
      loaded: true,
      exports: stubs[key],
    };
  }

  const app = express();
  app.use((req, res, next) => {
    res.render = (view, locals) => res.status(200).json({ view, locals });
    next();
  });
  app.use('/', require(getDataRoutePath));

  return {
    app,
    ensuredProfiles,
    queries,
    restore() {
      for (const [modulePath, original] of originals.entries()) {
        if (original) require.cache[modulePath] = original;
        else delete require.cache[modulePath];
      }
      delete require.cache[getDataRoutePath];
      delete require.cache[getDataStudentRecordPath];
    },
  };
}

const getDataEgresado = {
  codigo: '20151234',
  nombre: 'Estudiante Prueba',
  carrera: '578',
  estado: 'E',
};
const getDataActivo = { ...getDataEgresado, codigo: '20242583011', carrera: '383', estado: 'A' };

test('get-data uses the code associated in MILab and blocks on sanctions of the same person', async () => {
  const multa = { id: 3, con_estado_multa: 'ACTIVA' };
  const loaded = loadGetDataRoute({
    studentRecords: [getDataActivo, getDataEgresado],
    usuarioCodigoRows: [{ codigo: '20242583011' }],
    multaRows: [multa],
  });

  try {
    const response = await request(loaded.app).post('/').type('form').send({
      numero_documento_identificacion: '1001219870',
      motivo_exp: 'Grado',
      correo: 'estudiante@udistrital.edu.co',
    });

    assert.equal(response.body.view, 'home/alerta-multado');
    assert.deepEqual(response.body.locals.multaInfo, [multa]);
    assert.equal(loaded.ensuredProfiles[0].codigo, '20242583011');
    const multaQuery = loaded.queries.find((item) => item.sql.includes('FROM multa m'));
    assert.deepEqual(multaQuery.params, [7]);
    assert.match(multaQuery.sql, /'ACTIVA','Pendiente','POR SALDAR'/);
    assert.equal(
      loaded.queries.some((item) => item.sql.includes('INSERT INTO certificado')),
      false
    );
  } finally {
    loaded.restore();
  }
});
