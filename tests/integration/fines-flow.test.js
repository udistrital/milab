const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { buildApp, resolveRepoPath } = require('./helpers/build-test-app');
const { createSessionHarness, createUser } = require('./helpers/session-fixtures');

const submitPath = resolveRepoPath('src/routes/api/submit.js');
const approvalPath = resolveRepoPath('src/routes/api/aprobacion_multa.js');
const removePath = resolveRepoPath('src/routes/api/quitar-multa.js');
const dbPath = resolveRepoPath('src/libs/db.js');
const authPath = resolveRepoPath('src/routes/middlewares/auth.js');
const facultyScopePath = resolveRepoPath('src/libs/faculty-scope.js');
const mailPath = resolveRepoPath('src/libs/mail.js');
const emailLayoutPath = resolveRepoPath('src/libs/email-layout.js');
const userIdentityPath = resolveRepoPath('src/libs/user-identity.js');
const multaConfigPath = resolveRepoPath('src/libs/multa-config.js');
const sanctionEmailPath = resolveRepoPath('src/libs/sanction-email.js');

function authStubs() {
  return [[authPath, { requireRoles: () => (req, res, next) => next() }]];
}

test('fine submission rejects requests without a sanction date', async () => {
  const sessionHarness = createSessionHarness({
    user: createUser({ tipo: 'laboratorista', roles: ['laboratorista'], documento: 'lab-1' }),
  });
  const loaded = buildApp({
    entryPath: submitPath,
    sessionHarness,
    stubs: [
      ...authStubs(),
      [dbPath, { query: async () => ({ rows: [] }) }],
      [userIdentityPath, { resolveUsuarioIdForStudent: async () => 15 }],
    ],
    purgePaths: [submitPath],
  });

  try {
    const response = await request(loaded.app)
      .post('/')
      .type('form')
      .send({ identificador: '20241001', tipo_busqueda: 'codigo', ual_id: '10' });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.match(response.body.locals.message, /fecha de sancion obligatoria/i);
  } finally {
    loaded.restore();
  }
});

test('fine approval rejects unsupported sanction types before touching coordinator scope', async () => {
  const sessionHarness = createSessionHarness({
    user: createUser({ tipo: 'coordinador', roles: ['coordinador'], documento: 'coord-1' }),
  });
  const loaded = buildApp({
    entryPath: approvalPath,
    sessionHarness,
    stubs: [
      ...authStubs(),
      [dbPath, { query: async () => ({ rows: [] }) }],
      [
        facultyScopePath,
        { resolveCoordinatorScope: async () => ({ coordinatorDocument: '900', facultyIds: [10] }) },
      ],
      [mailPath, { sendMail: async () => {} }],
      [
        multaConfigPath,
        {
          SANCTION_TYPES: ['Firma de compromiso de buen uso'],
          normalizeSanctionType: (value) => (value || '').toString().trim(),
          isValidSanctionType: (value) =>
            ['Firma de compromiso de buen uso'].includes((value || '').toString().trim()),
          fetchMultaConfigsForFacultyIds: async () => new Map(),
          upsertConfigForFacultyId: async () => ({}),
          logConfigChangeToAuditoria: async () => {},
        },
      ],
      [
        sanctionEmailPath,
        {
          resolveStudentContactByUsuarioId: async () => null,
          sendSanctionActivationEmail: async () => ({ ok: true }),
        },
      ],
      [
        emailLayoutPath,
        {
          buildBrandedEmailAttachments: () => [],
          buildEmailFooterHtml: () => '',
          buildEmailHeaderHtml: () => '',
          escapeHtml: (value) => String(value || ''),
        },
      ],
    ],
    purgePaths: [approvalPath, multaConfigPath, sanctionEmailPath],
  });

  try {
    const response = await request(loaded.app)
      .post('/activar')
      .type('form')
      .send({ multa_id: '8', tipo_sancion: 'Tipo inventado' });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.match(response.body.locals.message, /tipo de sanción inválido/i);
  } finally {
    loaded.restore();
  }
});

test('fine removal updates the sanction status and renders success feedback', async () => {
  const sessionHarness = createSessionHarness({
    user: createUser({ tipo: 'laboratorista', roles: ['laboratorista'], documento: 'lab-user' }),
  });
  const loaded = buildApp({
    entryPath: removePath,
    sessionHarness,
    stubs: [
      ...authStubs(),
      [
        dbPath,
        {
          query: async (sql) => {
            if (sql.includes('SELECT usuario_sancionado_id, con_estado_multa FROM multa')) {
              return { rows: [{ usuario_sancionado_id: 44, con_estado_multa: 'ACTIVA' }] };
            }

            if (sql.includes('SELECT documento FROM laboratorista')) {
              return { rows: [{ documento: '9001' }] };
            }

            return { rows: [] };
          },
        },
      ],
      [userIdentityPath, { fetchUserById: async () => ({ documento: '20241001' }) }],
    ],
    purgePaths: [removePath],
  });

  try {
    const response = await request(loaded.app).post('/').type('form').send({ con_id: '55' });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_success');
    assert.match(response.body.locals.message2, /20241001/);
  } finally {
    loaded.restore();
  }
});
