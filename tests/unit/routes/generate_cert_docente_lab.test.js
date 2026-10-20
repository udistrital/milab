const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { buildApp, resolveRepoPath } = require('../../integration/helpers/build-test-app');
const { createSessionHarness, createUser } = require('../../integration/helpers/session-fixtures');

const routePath = resolveRepoPath('src/routes/api/generate_cert_docente_lab.js');
const dbPath = resolveRepoPath('src/libs/db.js');
const oatiClientPath = resolveRepoPath('src/libs/oati-client.js');
const appUrlPath = resolveRepoPath('src/libs/app-url.js');
const generatePathPath = resolveRepoPath('src/libs/generate-path.js');
const certificateEmailPath = resolveRepoPath('src/libs/certificate-email.js');
const userIdentityPath = resolveRepoPath('src/libs/user-identity.js');
const authPath = resolveRepoPath('src/routes/middlewares/auth.js');

function loadTeacherCertificateApp({
  teacherState = 'Activo',
  insertCertificate = async () => ({ rows: [{ id: 1 }] }),
  sendCertificateEmail = async () => ({ status: 'sent' }),
} = {}) {
  const generateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'milab-docente-certificate-'));
  const queryCalls = [];
  const emailCalls = [];
  const oatiCalls = [];
  const sessionHarness = createSessionHarness({
    user: createUser({ tipo: 'admin', roles: ['admin'], documento: 'admin-test' }),
  });
  const loaded = buildApp({
    entryPath: routePath,
    sessionHarness,
    stubs: [
      [
        dbPath,
        {
          async query(sql, params = []) {
            queryCalls.push({ sql, params });
            if (sql.includes('FROM multa')) return { rows: [] };
            if (sql.includes('INSERT INTO certificado_docente')) {
              return insertCertificate(sql, params);
            }
            return { rows: [] };
          },
        },
      ],
      [
        oatiClientPath,
        {
          getAcademicServicePath: (value) => value,
          requestOati: async (value) => {
            oatiCalls.push(value);
            return {
              docentesCollection: {
                docente: [{ estado_docente: teacherState, nombre: 'Docente de Prueba' }],
              },
            };
          },
        },
      ],
      [appUrlPath, { buildAppUrl: (value) => value }],
      [generatePathPath, { buildGeneratePath: (value) => path.join(generateDir, value) }],
      [
        certificateEmailPath,
        {
          buildCertificateEmailFailureFeedback: () => ({ message: 'No se pudo enviar el correo.' }),
          buildCertificateEmailFeedback: () => ({ message: 'Certificado enviado por correo.' }),
          sendCertificateEmail: async (payload) => {
            emailCalls.push(payload);
            return sendCertificateEmail(payload);
          },
        },
      ],
      [userIdentityPath, { ensurePerfilDocente: async () => 77 }],
      [authPath, { requireRoles: () => (req, res, next) => next() }],
    ],
    purgePaths: [routePath],
  });

  return {
    app: loaded.app,
    queryCalls,
    emailCalls,
    oatiCalls,
    generateDir,
    restore() {
      loaded.restore();
      fs.rmSync(generateDir, { recursive: true, force: true });
    },
  };
}

test('generate_cert_docente_lab exports an Express router with handlers', () => {
  const loaded = loadTeacherCertificateApp();

  try {
    assert.equal(typeof loaded.app, 'function');
  } finally {
    loaded.restore();
  }
});

test('generate_cert_docente_lab renders a controlled error for missing form data', async () => {
  const loaded = loadTeacherCertificateApp({
    insertCertificate: async () => {
      throw new Error('Persistence must not run for invalid input.');
    },
  });

  try {
    const response = await request(loaded.app).post('/').send({});

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.equal(loaded.queryCalls.length, 0);
    assert.equal(loaded.emailCalls.length, 0);
    assert.equal(loaded.oatiCalls.length, 0);
  } finally {
    loaded.restore();
  }
});

test('generate_cert_docente_lab does not persist or issue a certificate for an inactive docente', async () => {
  const loaded = loadTeacherCertificateApp({ teacherState: 'Inactivo' });

  try {
    const response = await request(loaded.app).post('/').send({
      numero_documento_identificacion: 'docente-test-1001',
      motivo_exp: 'Trámite académico',
      correo: 'docente-test@udistrital.edu.co',
    });

    assert.equal(response.body.view, 'home/message_error');
    assert.equal(loaded.emailCalls.length, 0);
    assert.equal(
      loaded.queryCalls.some(({ sql }) => sql.includes('INSERT INTO certificado_docente')),
      false
    );
    assert.equal(
      fs.existsSync(path.join(loaded.generateDir, 'certificado_docente-test-1001.pdf')),
      false
    );
  } finally {
    loaded.restore();
  }
});

test('generate_cert_docente_lab persists before sending the certificate email', async () => {
  let persistenceComplete = false;
  const loaded = loadTeacherCertificateApp({
    insertCertificate: async (sql, params) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      persistenceComplete = true;
      return { rows: [{ id: 1 }], params };
    },
    sendCertificateEmail: async (payload) => {
      assert.equal(persistenceComplete, true);
      return { status: 'sent', recipient: payload.correo };
    },
  });

  try {
    const response = await request(loaded.app).post('/').send({
      numero_documento_identificacion: 'docente-test-1001',
      motivo_exp: 'Trámite académico',
      correo: 'docente-test@udistrital.edu.co',
    });
    const pdfPath = path.join(loaded.generateDir, 'certificado_docente-test-1001.pdf');
    const pdfBytes = fs.readFileSync(pdfPath);
    const certificateInsert = loaded.queryCalls.find(({ sql }) =>
      sql.includes('INSERT INTO certificado_docente')
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_success');
    assert.equal(persistenceComplete, true);
    assert.equal(loaded.emailCalls.length, 1);
    assert.equal(loaded.emailCalls[0].pdfPath, pdfPath);
    assert.equal(pdfBytes.subarray(0, 5).toString(), '%PDF-');
    assert.ok(certificateInsert);
    assert.equal(certificateInsert.params[0], 77);
    assert.equal(certificateInsert.params[3], 'docente-test@udistrital.edu.co');
  } finally {
    loaded.restore();
  }
});

test('generate_cert_docente_lab does not send or generate a certificate when persistence fails', async () => {
  const loaded = loadTeacherCertificateApp({
    insertCertificate: async () => {
      throw new Error('Database unavailable');
    },
  });

  try {
    const response = await request(loaded.app).post('/').send({
      numero_documento_identificacion: 'docente-test-1001',
      motivo_exp: 'Trámite académico',
      correo: 'docente-test@udistrital.edu.co',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.equal(loaded.emailCalls.length, 0);
    assert.equal(
      fs.existsSync(path.join(loaded.generateDir, 'certificado_docente-test-1001.pdf')),
      false
    );
  } finally {
    loaded.restore();
  }
});
