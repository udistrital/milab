const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const { SgaDebtService } = require('../../../src/libs/oati-debts');

const routePath = path.resolve(
  __dirname,
  '../../../src/routes/api/generate_cert_estudiante_lab.js'
);
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const appUrlPath = path.resolve(__dirname, '../../../src/libs/app-url.js');
const generatePathPath = path.resolve(__dirname, '../../../src/libs/generate-path.js');
const oatiClientPath = path.resolve(__dirname, '../../../src/libs/oati-client.js');
const oatiDebtsPath = path.resolve(__dirname, '../../../src/libs/oati-debts.js');
const certificateEmailPath = path.resolve(__dirname, '../../../src/libs/certificate-email.js');
const userIdentityPath = path.resolve(__dirname, '../../../src/libs/user-identity.js');
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

const defaultStudentRecord = {
  codigo: '2024100001',
  nombre: 'Estudiante Prueba',
  carrera: '1',
  estado: 'A',
  documento: '1000694178',
};

function buildOatiResponse(servicePath, studentRecord) {
  if (servicePath.startsWith('estados_codigo/')) {
    return { estado: { nombre: 'ACTIVO' } };
  }
  if (servicePath.startsWith('carrera/')) {
    return { carrerasCollection: { carrera: [{ nombre: 'Ingeniería de Prueba' }] } };
  }
  return {
    datosEstudianteCollection: {
      datosBasicosEstudiante: studentRecord ? [studentRecord] : [],
    },
  };
}

function loadRoute({
  studentRecord = null,
  multaRows = [],
  sgaServiceConfigured = true,
  sgaDebtsImpl = async () => [],
} = {}) {
  const originals = new Map();
  const requestOatiCalls = [];
  const sgaRequests = [];
  const generateDir = os.tmpdir();
  const queryResult = (sql) => ({ rows: String(sql).includes('FROM multa m') ? multaRows : [] });
  const stubs = [
    [
      dbPath,
      {
        query(sql, params, callback) {
          if (typeof callback === 'function') {
            callback(null, queryResult(sql));
            return undefined;
          }
          return Promise.resolve(queryResult(sql));
        },
      },
    ],
    [appUrlPath, { buildAppUrl: (value) => value }],
    [generatePathPath, { buildGeneratePath: (value) => path.join(generateDir, value) }],
    [
      oatiClientPath,
      {
        getAcademicServicePath: (value) => value,
        requestOati: async (value) => {
          requestOatiCalls.push(value);
          return buildOatiResponse(value, studentRecord);
        },
      },
    ],
    [
      oatiDebtsPath,
      {
        sgaDebtService: {
          isConfigured: () => sgaServiceConfigured,
          getActiveDebts: async (payload) => {
            sgaRequests.push(payload);
            return sgaDebtsImpl(payload);
          },
        },
      },
    ],
    [
      certificateEmailPath,
      {
        buildCertificateEmailFailureFeedback: () => null,
        buildCertificateEmailFeedback: () => null,
        sendCertificateEmail: async () => null,
      },
    ],
    [userIdentityPath, { ensurePerfilEstudiante: async () => 1 }],
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
    requestOatiCalls,
    sgaRequests,
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

test('generate_cert_estudiante_lab parses form submissions before querying OATI', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/').type('form').send({
      numero_documento_identificacion: '1000694178',
      con_codigo: '2024100001',
      motivo_exp: 'Grado',
      correo: 'estudiante@udistrital.edu.co',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.deepEqual(loaded.requestOatiCalls, ['datos_basicos_activos_cedula/1000694178']);
    assert.notEqual(response.body.locals.message, 'No fue posible procesar la solicitud.');
  } finally {
    loaded.restore();
  }
});

test('generate_cert_estudiante_lab returns a controlled error when the form data is missing', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/').type('form').send({});

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.equal(response.body.locals.message, 'No fue posible procesar la solicitud.');
    assert.equal(
      response.body.locals.message2,
      'Verifica los datos del formulario e inténtalo nuevamente.'
    );
    assert.deepEqual(loaded.requestOatiCalls, []);
  } finally {
    loaded.restore();
  }
});

const validCertificateForm = {
  numero_documento_identificacion: '1000694178',
  con_codigo: '2024100001',
  motivo_exp: 'Grado',
  correo: 'estudiante@udistrital.edu.co',
};

test('generate_cert_estudiante_lab blocks the certificate when SGA reports active debts', async () => {
  const sgaDebt = { DEU_ID: '75806', DEU_ESTADO: '2', DEU_EST_COD: '2024100001' };
  const loaded = loadRoute({
    studentRecord: defaultStudentRecord,
    sgaDebtsImpl: async () => [sgaDebt],
  });

  test('generate_cert_estudiante_lab blocks the certificate for a state-1 SGA debt', async () => {
    const sgaDebt = {
      DEU_ID: '111951',
      DEU_ESTADO: 1,
      DEU_EST_COD: defaultStudentRecord.codigo,
      DEU_MATERIAL: 'Tubo de ensayo omsons 15x150mm',
      DEU_MULTA: 1,
      DEU_FECHA_PAGO: null,
    };
    const service = new SgaDebtService({
      serviceConfig: { oatiDebtorsServiceName: 'servicios_academicos_produccion' },
      requestPost: async () => ({ deudas: { estudiantes: sgaDebt } }),
    });
    const loaded = loadRoute({
      studentRecord: defaultStudentRecord,
      sgaDebtsImpl: (student) => service.getActiveDebts(student),
    });

    try {
      const response = await request(buildApp(loaded.route))
        .post('/')
        .type('form')
        .send(validCertificateForm);

      assert.equal(response.status, 200);
      assert.equal(response.body.view, 'home/alerta-multado');
      assert.deepEqual(response.body.locals.multaInfo, []);
      assert.deepEqual(response.body.locals.sgaMultaInfo, [sgaDebt]);
    } finally {
      loaded.restore();
    }
  });

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/').type('form').send(validCertificateForm);

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/alerta-multado');
    assert.deepEqual(response.body.locals.multaInfo, []);
    assert.deepEqual(response.body.locals.sgaMultaInfo, [sgaDebt]);
    assert.deepEqual(loaded.sgaRequests, [{ codigo: '2024100001', documento: '1000694178' }]);
  } finally {
    loaded.restore();
  }
});

test('generate_cert_estudiante_lab shows MILab and SGA debts together', async () => {
  const localFine = { id: 10, con_estado_multa: 'ACTIVA' };
  const sgaDebt = { DEU_ID: '78741', DEU_ESTADO: '2' };
  const loaded = loadRoute({
    studentRecord: defaultStudentRecord,
    multaRows: [localFine],
    sgaDebtsImpl: async () => [sgaDebt],
  });

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/').type('form').send(validCertificateForm);

    assert.equal(response.body.view, 'home/alerta-multado');
    assert.deepEqual(response.body.locals.multaInfo, [localFine]);
    assert.deepEqual(response.body.locals.sgaMultaInfo, [sgaDebt]);
  } finally {
    loaded.restore();
  }
});

test('generate_cert_estudiante_lab blocks the certificate when SGA does not respond', async () => {
  const loaded = loadRoute({
    studentRecord: defaultStudentRecord,
    sgaDebtsImpl: async () => {
      throw new Error('SGA no disponible');
    },
  });

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/').type('form').send(validCertificateForm);

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.equal(
      response.body.locals.message,
      'No fue posible verificar las multas del estudiante en SGA.'
    );
    assert.match(response.body.locals.message2, /no se generó/);
    assert.equal(loaded.sgaRequests.length, 1);
  } finally {
    loaded.restore();
  }
});

test('generate_cert_estudiante_lab skips SGA when the service is not configured', async () => {
  const localFine = { id: 12, con_estado_multa: 'ACTIVA' };
  const loaded = loadRoute({
    studentRecord: defaultStudentRecord,
    multaRows: [localFine],
    sgaServiceConfigured: false,
  });

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/').type('form').send(validCertificateForm);

    assert.equal(response.body.view, 'home/alerta-multado');
    assert.deepEqual(response.body.locals.sgaMultaInfo, []);
    assert.equal(loaded.sgaRequests.length, 0);
  } finally {
    loaded.restore();
  }
});
