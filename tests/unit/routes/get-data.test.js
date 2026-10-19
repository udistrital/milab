const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

test('get-data exports an Express router with handlers', () => {
  const modulePath = path.resolve(__dirname, '../../../src/routes/api/get-data.js');
  delete require.cache[modulePath];
  const router = require(modulePath);

  assert.equal(typeof router, 'function');
  assert.equal(typeof router.use, 'function');
  assert.equal(Array.isArray(router.stack), true);
  assert.equal(router.stack.length > 0, true);
});

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

function loadGetDataRoute({
  studentRecords,
  usuarioCodigoRows = [],
  multaRows = [],
  poolQueryImpl,
  sendCertificateEmailImpl = async () => null,
  sessionUser = { documento: '1001219870', documento_real: '1001219870', roles: ['estudiante'] },
}) {
  const originals = new Map();
  const ensuredProfiles = [];
  const queries = [];
  const emailCalls = [];
  const generateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'milab-get-data-'));
  const stubs = {
    db: {
      query(sql, params = [], callback) {
        queries.push({ sql, params });
        const result = poolQueryImpl
          ? poolQueryImpl(sql, params)
          : String(sql).includes('FROM multa m')
            ? { rows: multaRows }
            : String(sql).includes('FROM usuario WHERE documento')
              ? { rows: usuarioCodigoRows }
              : { rows: [] };
        if (typeof callback === 'function') {
          Promise.resolve(result).then(
            (rows) => callback(null, rows),
            (error) => callback(error)
          );
          return undefined;
        }
        return Promise.resolve(result);
      },
    },
    appUrl: { buildAppUrl: (value) => value },
    generatePath: { buildGeneratePath: (value) => path.join(generateDir, value) },
    oatiClient: {
      getAcademicServicePath: (value) => value,
      async requestOati(servicePath) {
        const cedula = String(servicePath).match(/datos_basicos_activos_cedula\/(\w+)/);
        if (cedula) requestedDocumentos.push(cedula[1]);
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
      sendCertificateEmail: async (payload) => {
        emailCalls.push(payload);
        return sendCertificateEmailImpl(payload);
      },
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
  const requestedDocumentos = [];
  app.use((req, res, next) => {
    req.session = { user: sessionUser };
    res.render = (view, locals) => res.status(200).json({ view, locals });
    next();
  });
  app.use('/', require(getDataRoutePath));

  return {
    app,
    ensuredProfiles,
    queries,
    emailCalls,
    generateDir,
    requestedDocumentos,
    restore() {
      for (const [modulePath, original] of originals.entries()) {
        if (original) require.cache[modulePath] = original;
        else delete require.cache[modulePath];
      }
      delete require.cache[getDataRoutePath];
      delete require.cache[getDataStudentRecordPath];
      fs.rmSync(generateDir, { recursive: true, force: true });
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

test('get-data ignora la cédula del formulario y usa la del estudiante en sesión', async () => {
  const loaded = loadGetDataRoute({
    studentRecords: [getDataActivo],
    usuarioCodigoRows: [{ codigo: '20242583011' }],
    multaRows: [{ id: 1 }],
  });

  try {
    await request(loaded.app).post('/').type('form').send({
      numero_documento_identificacion: '99999999',
      motivo_exp: 'Grado',
      correo: 'otro@udistrital.edu.co',
    });

    assert.deepEqual(loaded.requestedDocumentos, ['1001219870']);
    assert.equal(loaded.ensuredProfiles[0].documento, '1001219870');
  } finally {
    loaded.restore();
  }
});

test('get-data usa la cédula del estudiante impersonado aunque tenga rol admin', async () => {
  const loaded = loadGetDataRoute({
    studentRecords: [getDataActivo],
    multaRows: [{ id: 1 }],
    sessionUser: {
      documento: '1001219870',
      roles: ['admin', 'estudiante'],
      __impersonating: true,
    },
  });

  try {
    await request(loaded.app)
      .post('/')
      .type('form')
      .send({ numero_documento_identificacion: '99999999', motivo_exp: 'Grado' });

    assert.deepEqual(loaded.requestedDocumentos, ['1001219870']);
  } finally {
    loaded.restore();
  }
});

test('get-data permite a un admin real consultar la cédula indicada', async () => {
  const loaded = loadGetDataRoute({
    studentRecords: [getDataActivo],
    multaRows: [{ id: 1 }],
    sessionUser: { documento: '80000000', roles: ['admin'] },
  });

  try {
    await request(loaded.app)
      .post('/')
      .type('form')
      .send({ numero_documento_identificacion: '1001219870', motivo_exp: 'Grado' });

    assert.deepEqual(loaded.requestedDocumentos, ['1001219870']);
  } finally {
    loaded.restore();
  }
});

test('get-data rechaza la solicitud si la sesión no tiene documento', async () => {
  const loaded = loadGetDataRoute({
    studentRecords: [getDataActivo],
    sessionUser: { roles: ['estudiante'] },
  });

  try {
    const response = await request(loaded.app)
      .post('/')
      .type('form')
      .send({ numero_documento_identificacion: '1001219870', motivo_exp: 'Grado' });

    assert.equal(response.body.view, 'home/message_error');
    assert.deepEqual(loaded.requestedDocumentos, []);
  } finally {
    loaded.restore();
  }
});

test('get-data rejects an egresado before creating a certificate or database record', async () => {
  const loaded = loadGetDataRoute({
    studentRecords: [{ ...getDataEgresado, documento: '1001219870' }],
    sessionUser: { documento: '80000000', roles: ['admin'] },
  });

  try {
    const response = await request(loaded.app).post('/').type('form').send({
      numero_documento_identificacion: '1001219870',
      motivo_exp: 'Grado',
      correo: 'estudiante@udistrital.edu.co',
    });

    assert.equal(response.body.view, 'home/message_error');
    assert.equal(loaded.ensuredProfiles.length, 0);
    assert.equal(
      loaded.queries.some(({ sql }) => sql.includes('INSERT INTO certificado_estudiante')),
      false
    );
    assert.equal(
      fs.existsSync(path.join(loaded.generateDir, `${getDataEgresado.codigo}.png`)),
      false
    );
    assert.equal(loaded.emailCalls.length, 0);
  } finally {
    loaded.restore();
  }
});

test('get-data creates a PDF and sends the certificate email after a clear active-student lookup', async () => {
  let persistenceComplete = false;
  const loaded = loadGetDataRoute({
    studentRecords: [getDataActivo],
    poolQueryImpl: async (sql) => {
      if (sql.includes('INSERT INTO certificado_estudiante')) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        persistenceComplete = true;
        return { rows: [{ id: 901 }] };
      }
      if (sql.includes('FROM multa m')) return { rows: [] };
      if (sql.includes('FROM usuario WHERE documento')) return { rows: [] };
      return { rows: [] };
    },
    sendCertificateEmailImpl: async () => {
      assert.equal(persistenceComplete, true);
      return { status: 'sent' };
    },
  });

  try {
    const response = await request(loaded.app).post('/').type('form').send({
      numero_documento_identificacion: '1001219870',
      motivo_exp: 'Grado',
      correo: 'estudiante@udistrital.edu.co',
    });
    const pdfPath = path.join(loaded.generateDir, `certificado_${getDataActivo.codigo}.pdf`);
    const pdfBytes = fs.readFileSync(pdfPath);

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_success');
    assert.equal(loaded.emailCalls.length, 1);
    assert.equal(loaded.emailCalls[0].pdfPath, pdfPath);
    assert.equal(pdfBytes.subarray(0, 5).toString(), '%PDF-');
    assert.ok(loaded.queries.some(({ sql }) => sql.includes('INSERT INTO certificado_estudiante')));
    assert.equal(persistenceComplete, true);
  } finally {
    loaded.restore();
  }
});

test('get-data does not create a PDF or send email when certificate persistence fails', async () => {
  let emailCallCount = 0;
  const loaded = loadGetDataRoute({
    studentRecords: [getDataActivo],
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
    const response = await request(loaded.app).post('/').type('form').send({
      numero_documento_identificacion: '1001219870',
      motivo_exp: 'Grado',
      correo: 'estudiante@udistrital.edu.co',
    });

    assert.equal(response.body.view, 'home/message_error');
    assert.equal(emailCallCount, 0);
    assert.equal(
      fs.existsSync(path.join(loaded.generateDir, `certificado_${getDataActivo.codigo}.pdf`)),
      false
    );
  } finally {
    loaded.restore();
  }
});
