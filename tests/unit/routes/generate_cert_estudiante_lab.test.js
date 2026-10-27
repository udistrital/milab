const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
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
const oatiStudentRecordPath = path.resolve(__dirname, '../../../src/libs/oati-student-record.js');

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

function buildOatiResponse(servicePath, studentRecord, studentRecords) {
  if (servicePath.startsWith('estados_codigo/')) {
    return { estado: { nombre: servicePath === 'estados_codigo/E' ? 'EGRESADO' : 'ACTIVO' } };
  }
  if (servicePath.startsWith('carrera/')) {
    return { carrerasCollection: { carrera: [{ nombre: 'Ingeniería de Prueba' }] } };
  }
  return {
    datosEstudianteCollection: {
      datosBasicosEstudiante: studentRecords || (studentRecord ? [studentRecord] : []),
    },
  };
}

function loadRoute({
  studentRecord = null,
  studentRecords = null,
  usuarioCodigoRows = [],
  multaRows = [],
  sgaServiceConfigured = true,
  sgaDebtsImpl = async () => [],
  poolQueryImpl,
  sendCertificateEmailImpl = async () => null,
} = {}) {
  const originals = new Map();
  const requestOatiCalls = [];
  const sgaRequests = [];
  const queryCalls = [];
  const generateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'milab-student-certificate-'));
  const queryResult = (sql) => {
    if (String(sql).includes('FROM multa m')) return { rows: multaRows };
    if (String(sql).includes('FROM usuario WHERE documento')) return { rows: usuarioCodigoRows };
    return { rows: [] };
  };
  const executePoolQuery = (sql, params = []) => {
    queryCalls.push({ sql, params });
    return poolQueryImpl ? poolQueryImpl(sql, params) : queryResult(sql);
  };
  const stubs = [
    [
      dbPath,
      {
        query(sql, params, callback) {
          const result = executePoolQuery(sql, params);
          if (typeof callback === 'function') {
            if (result && typeof result.then === 'function') {
              result.then(
                (rows) => callback(null, rows),
                (error) => callback(error)
              );
              return undefined;
            }
            callback(null, result);
            return undefined;
          }
          return Promise.resolve(result);
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
          return buildOatiResponse(value, studentRecord, studentRecords);
        },
      },
    ],
    [
      oatiDebtsPath,
      {
        sgaDebtService: {
          isConfigured: () => sgaServiceConfigured,
          queryStudent: async (payload) => {
            sgaRequests.push(payload);
            const codes = [
              ...new Set([payload.codigo, ...(payload.codigos || [])].filter(Boolean)),
            ];
            const debtsByCode = await Promise.all(
              codes.map((codigo) => sgaDebtsImpl({ ...payload, codigo }))
            );
            const uniqueDebts = new Map();
            debtsByCode.flat().forEach((debt, index) => {
              const key = debt.DEU_ID
                ? `id:${debt.DEU_ID}`
                : JSON.stringify([debt.DEU_EST_COD, debt.DEU_CPTO_COD, debt.DEU_FECHA, index]);
              if (!uniqueDebts.has(key)) uniqueDebts.set(key, debt);
            });
            const debts = [...uniqueDebts.values()];
            return {
              status: debts.length ? 'found' : 'clear',
              debts,
              codes,
              document: payload.documento || null,
              nonLaboratoryCount: 0,
              unclassifiedCount: 0,
              message: '',
              errors: [],
            };
          },
        },
      },
    ],
    [
      certificateEmailPath,
      {
        buildCertificateEmailFailureFeedback: () => null,
        buildCertificateEmailFeedback: () => null,
        sendCertificateEmail: async (payload) => sendCertificateEmailImpl(payload),
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
  delete require.cache[oatiStudentRecordPath];

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
    queryCalls,
    generateDir,
    restore() {
      for (const [modulePath, original] of originals.entries()) {
        if (original) {
          require.cache[modulePath] = original;
        } else {
          delete require.cache[modulePath];
        }
      }

      delete require.cache[routePath];
      delete require.cache[oatiStudentRecordPath];
      fs.rmSync(generateDir, { recursive: true, force: true });
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
  const sgaDebt = {
    DEU_ID: '75806',
    DEU_ESTADO: '2',
    DEU_EST_COD: '2024100001',
    DEU_CPTO_COD: '4',
  };
  const loaded = loadRoute({
    studentRecord: defaultStudentRecord,
    sgaDebtsImpl: async () => [sgaDebt],
  });

  test('generate_cert_estudiante_lab blocks the certificate for a state-1 SGA debt', async () => {
    const sgaDebt = {
      DEU_ID: '111951',
      DEU_ESTADO: 1,
      DEU_EST_COD: defaultStudentRecord.codigo,
      DEU_CPTO_COD: '4',
      DEU_MATERIAL: 'Tubo de ensayo omsons 15x150mm',
      DEU_MULTA: 1,
      DEU_FECHA_PAGO: null,
    };
    const service = new SgaDebtService({
      serviceConfig: { oatiDebtorsServiceName: 'servicios_academicos_produccion' },
      requestAcademicData: async () => ({
        datosEstudianteCollection: {
          datosBasicosEstudiante: [defaultStudentRecord],
        },
      }),
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
      assert.deepEqual(response.body.locals.sgaMultaInfo, [
        { ...sgaDebt, DEU_CPTO_NOMBRE: 'LABORATORIO DE QUIMICA' },
      ]);
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
    assert.deepEqual(loaded.sgaRequests, [
      {
        codigo: '2024100001',
        codigos: ['2024100001'],
        documento: '1000694178',
      },
    ]);
  } finally {
    loaded.restore();
  }
});

test('generate_cert_estudiante_lab shows MILab and SGA debts together', async () => {
  const localFine = { id: 10, con_estado_multa: 'ACTIVA' };
  const sgaDebt = { DEU_ID: '78741', DEU_ESTADO: '2', DEU_CPTO_COD: '4' };
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

const egresadoRecord = {
  codigo: '20151234',
  nombre: 'Estudiante Prueba',
  carrera: '578',
  estado: 'E',
  documento: '1000694178',
};
const activoRecord = { ...egresadoRecord, codigo: '20242583011', carrera: '383', estado: 'A' };

test('generate_cert_estudiante_lab uses the code associated in MILab instead of the last OATI record', async () => {
  const loaded = loadRoute({
    studentRecords: [activoRecord, egresadoRecord],
    usuarioCodigoRows: [{ codigo: '20242583011' }],
    sgaDebtsImpl: async (student) =>
      student.codigo === '20151234' ? [{ DEU_ID: '1', DEU_EST_COD: '20151234' }] : [],
  });

  try {
    const response = await request(buildApp(loaded.route))
      .post('/')
      .type('form')
      .send({ ...validCertificateForm, con_codigo: '20242583011' });

    assert.equal(response.body.view, 'home/alerta-multado');
    assert.deepEqual(response.body.locals.sgaMultaInfo, [{ DEU_ID: '1', DEU_EST_COD: '20151234' }]);
    assert.deepEqual(loaded.sgaRequests, [
      {
        codigo: '20242583011',
        codigos: ['20242583011', '20151234'],
        documento: '1000694178',
      },
    ]);
  } finally {
    loaded.restore();
  }
});

test('generate_cert_estudiante_lab blocks when the code associated in MILab is EGRESADO', async () => {
  const loaded = loadRoute({
    studentRecords: [egresadoRecord, activoRecord],
    usuarioCodigoRows: [{ codigo: '20151234' }],
  });

  try {
    const response = await request(buildApp(loaded.route))
      .post('/')
      .type('form')
      .send(validCertificateForm);

    assert.equal(response.body.view, 'home/message_error');
    assert.equal(response.body.locals.message, 'Estudiante egresado');
    assert.deepEqual(loaded.sgaRequests, []);
  } finally {
    loaded.restore();
  }
});

test('generate_cert_estudiante_lab keeps the last OATI record when MILab has no associated code', async () => {
  const loaded = loadRoute({
    studentRecords: [activoRecord, egresadoRecord],
    usuarioCodigoRows: [],
  });

  try {
    const response = await request(buildApp(loaded.route))
      .post('/')
      .type('form')
      .send(validCertificateForm);

    assert.equal(response.body.view, 'home/message_error');
    assert.equal(response.body.locals.message, 'Estudiante egresado');
  } finally {
    loaded.restore();
  }
});

test('generate_cert_estudiante_lab creates a PDF and requests email after all checks pass', async () => {
  let emailPayload;
  const loaded = loadRoute({
    studentRecord: defaultStudentRecord,
    sendCertificateEmailImpl: async (payload) => {
      emailPayload = payload;
      return { status: 'sent', recipient: payload.correo };
    },
  });

  try {
    const response = await request(buildApp(loaded.route))
      .post('/')
      .type('form')
      .send(validCertificateForm);

    const pdfPath = path.join(loaded.generateDir, 'certificado_2024100001.pdf');
    const pdfBytes = fs.readFileSync(pdfPath);
    const certificateInsert = loaded.queryCalls.find(({ sql }) =>
      sql.includes('INSERT INTO certificado_estudiante')
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_success');
    assert.equal(response.body.locals.autoDownloadAction, '/milab/api/download-pdf');
    assert.equal(emailPayload.pdfPath, pdfPath);
    assert.equal(emailPayload.correo, validCertificateForm.correo);
    assert.equal(pdfBytes.subarray(0, 5).toString(), '%PDF-');
    assert.ok(certificateInsert);
    assert.equal(certificateInsert.params[4], validCertificateForm.correo);
    assert.equal(certificateInsert.params[5], validCertificateForm.motivo_exp);
    assert.equal(loaded.sgaRequests.length, 1);
  } finally {
    loaded.restore();
  }
});

test('generate_cert_estudiante_lab does not issue a PDF or email when certificate persistence fails', async () => {
  let emailCallCount = 0;
  const loaded = loadRoute({
    studentRecord: defaultStudentRecord,
    poolQueryImpl: async (sql) => {
      if (sql.includes('INSERT INTO certificado_estudiante')) {
        throw new Error('Certificate database unavailable');
      }
      if (sql.includes('FROM multa m')) return { rows: [] };
      if (sql.includes('FROM usuario WHERE documento')) return { rows: [] };
      return { rows: [] };
    },
    sendCertificateEmailImpl: async () => {
      emailCallCount += 1;
      return { status: 'sent' };
    },
  });

  try {
    const response = await request(buildApp(loaded.route))
      .post('/')
      .type('form')
      .send(validCertificateForm);

    assert.equal(response.body.view, 'home/message_error');
    assert.equal(emailCallCount, 0);
    assert.ok(
      loaded.queryCalls.some(({ sql }) => sql.includes('INSERT INTO certificado_estudiante'))
    );
    assert.equal(fs.existsSync(path.join(loaded.generateDir, 'certificado_2024100001.pdf')), false);
  } finally {
    loaded.restore();
  }
});
