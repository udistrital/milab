const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/aprobacion_multa.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const mailPath = path.resolve(__dirname, '../../../src/libs/mail.js');
const emailLayoutPath = path.resolve(__dirname, '../../../src/libs/email-layout.js');
const facultyScopePath = path.resolve(__dirname, '../../../src/libs/faculty-scope.js');
const authPath = path.resolve(__dirname, '../../../src/routes/middlewares/auth.js');
const multaConfigPath = path.resolve(__dirname, '../../../src/libs/multa-config.js');
const sanctionEmailPath = path.resolve(__dirname, '../../../src/libs/sanction-email.js');

function buildApp(route, userOverrides = {}) {
  const app = express();

  app.use((req, res, next) => {
    req.session = {
      user: {
        tipo: 'coordinador',
        documento: 'coord-user',
        nombre: 'Coordinador Prueba',
        ...userOverrides,
      },
    };
    res.render = (view, locals) => res.status(res.statusCode || 200).json({ view, locals });
    next();
  });
  app.use('/', route);

  return app;
}

function loadRoute({
  scopeImpl,
  queryImpl,
  resolveStudentContactImpl,
  sendSanctionEmailImpl,
} = {}) {
  const originals = new Map();

  const stubs = [
    [
      dbPath,
      {
        query: async (sql, params = []) => {
          if (typeof queryImpl === 'function') {
            return queryImpl(sql, params);
          }

          if (sql.includes('WHERE m.con_estado_multa IN')) {
            return { rows: [{ id: 1, con_estado_multa: 'Pendiente' }] };
          }

          return { rows: [], rowCount: 1 };
        },
      },
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
        resolveStudentContactByUsuarioId:
          resolveStudentContactImpl ||
          (async () => ({
            nombre: 'Estudiante',
            documento: '123',
            codigo: '2024',
            correo: '',
          })),
        sendSanctionActivationEmail: sendSanctionEmailImpl || (async () => ({ ok: true })),
      },
    ],
    [
      emailLayoutPath,
      {
        buildBrandedEmailAttachments: () => [],
        buildEmailFooterHtml: () => '',
        buildEmailHeaderHtml: () => '',
        escapeHtml: (value) => value,
      },
    ],
    [
      facultyScopePath,
      {
        resolveCoordinatorAuthorizationScope:
          scopeImpl || (async () => ({ coordinatorDocument: '900', facultyIds: [10], ualIds: [] })),
        hasCoordinatorScope: (scope) =>
          (scope?.ualIds?.length || 0) > 0 || (scope?.facultyIds?.length || 0) > 0,
        buildMultaScopeFilter: (scope, paramIndex) =>
          scope.ualIds?.length
            ? { sql: `u.ual_id = ANY($${paramIndex}::int[])`, value: scope.ualIds }
            : { sql: `u.facultad_id = ANY($${paramIndex}::int[])`, value: scope.facultyIds },
      },
    ],
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

test('aprobacion_multa redirects coordinators to the sanctions list', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).get('/');

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/milab/api/get_list_multas');
  } finally {
    loaded.restore();
  }
});

test('aprobacion_multa rejects disabled faculty authorization settings', async () => {
  const loaded = loadRoute();

  try {
    const response = await request(buildApp(loaded.route))
      .post('/configuracion/10/toggle-crear-directa')
      .type('form')
      .set('Accept', 'text/html');

    assert.equal(response.status, 410);
    assert.equal(response.body.view, 'home/message_error');
    assert.match(response.body.locals.message, /Funcionalidad desactivada/i);
  } finally {
    loaded.restore();
  }
});

test('aprobacion_multa activar rejects invalid sanction type', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/activar').type('form').send({
      multa_id: '1',
      tipo_sancion: 'sancion-invalida',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.match(response.body.locals.message, /Tipo de sanción inválido/i);
  } finally {
    loaded.restore();
  }
});

test('aprobacion_multa activar redirects on successful update', async () => {
  const loaded = loadRoute({
    queryImpl: async (sql) => {
      if (sql.includes('UPDATE multa AS m')) {
        return { rowCount: 1, rows: [] };
      }

      if (sql.includes('SELECT m.usuario_sancionado_id')) {
        return {
          rows: [
            { usuario_sancionado_id: 77, fecha_multa: '2026-01-01', ual: 'Lab', obs_multa: '' },
          ],
        };
      }

      if (sql.includes('SELECT u.nombre, u.documento, u.codigo, u.correo')) {
        return { rows: [{ nombre: 'Estudiante', documento: '123', codigo: '2024', correo: '' }] };
      }

      return { rows: [], rowCount: 1 };
    },
  });

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/activar').type('form').send({
      multa_id: '1',
      tipo_sancion: 'Firma de compromiso de buen uso',
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/milab/api/aprobacion_multa');
  } finally {
    loaded.restore();
  }
});

test('aprobacion_multa activation includes faculty and dependency in the notice payload', async () => {
  let emailPayload;
  const loaded = loadRoute({
    resolveStudentContactImpl: async () => ({
      nombre: 'Estudiante',
      documento: '123',
      codigo: '2024',
      correo: 'estudiante@udistrital.edu.co',
    }),
    sendSanctionEmailImpl: async (payload) => {
      emailPayload = payload;
      return { ok: true };
    },
    queryImpl: async (sql) => {
      if (sql.includes('UPDATE multa AS m')) return { rowCount: 1, rows: [] };
      if (sql.includes('SELECT m.usuario_sancionado_id')) {
        return {
          rows: [
            {
              usuario_sancionado_id: 77,
              fecha_multa: '2026-01-01',
              ual: 'Lab',
              obs_multa: '',
              laboratorio_facultad: 'Facultad de Ingeniería',
              laboratorio_dependencia: 'Departamento de Física',
            },
          ],
        };
      }
      return { rows: [], rowCount: 1 };
    },
  });

  try {
    const response = await request(buildApp(loaded.route)).post('/activar').type('form').send({
      multa_id: '1',
      tipo_sancion: 'Firma de compromiso de buen uso',
    });
    assert.equal(response.status, 302);
    assert.equal(emailPayload.facultad, 'Facultad de Ingeniería');
    assert.equal(emailPayload.dependencia, 'Departamento de Física');
  } finally {
    loaded.restore();
  }
});

test('aprobacion_multa activar from listado redirects to sanctions list', async () => {
  const loaded = loadRoute({
    queryImpl: async (sql) => {
      if (sql.includes('UPDATE multa AS m')) {
        return { rowCount: 1, rows: [] };
      }

      if (sql.includes('SELECT m.usuario_sancionado_id')) {
        return {
          rows: [
            { usuario_sancionado_id: 77, fecha_multa: '2026-01-01', ual: 'Lab', obs_multa: '' },
          ],
        };
      }

      return { rows: [], rowCount: 1 };
    },
  });

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/activar').type('form').send({
      multa_id: '1',
      tipo_sancion: 'Firma de compromiso de buen uso',
      source: 'listado',
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/milab/api/get_list_multas?success=activada');
  } finally {
    loaded.restore();
  }
});

test('aprobacion_multa saldar from listado redirects to sanctions list', async () => {
  const loaded = loadRoute({
    queryImpl: async (sql) => {
      if (sql.includes("SET con_estado_multa = 'SALDADA'")) {
        return { rowCount: 1, rows: [] };
      }

      if (sql.includes('SELECT u.documento FROM multa')) {
        return { rows: [{ documento: '20241001' }] };
      }

      return { rows: [], rowCount: 1 };
    },
  });

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/saldar').type('form').send({
      multa_id: '33',
      source: 'listado',
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/milab/api/get_list_multas?success=saldada');
  } finally {
    loaded.restore();
  }
});

test('laboratorista can mark POR SALDAR sanctions as SALDADA without faculty authorization', async () => {
  const loaded = loadRoute({
    queryImpl: async (sql) => {
      if (sql.includes('SELECT documento FROM laboratorista')) {
        return { rows: [{ documento: 'lab-1' }] };
      }
      if (sql.includes('SELECT m.id, u.ual_id, u.facultad_id')) {
        return { rows: [{ id: 33, ual_id: 12, facultad_id: 7 }] };
      }
      if (sql.includes('FROM laboratorista_ual')) {
        return { rows: [{ '?column?': 1 }] };
      }
      if (sql.includes("SET con_estado_multa = 'SALDADA'")) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('SELECT u.documento FROM multa')) {
        return { rows: [{ documento: '20241001' }] };
      }
      return { rows: [], rowCount: 1 };
    },
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'laboratorista', documento: 'lab-user' });
    const response = await request(app).post('/saldar').type('form').send({
      multa_id: '33',
      source: 'listado',
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/milab/api/get_list_multas?success=saldada');
  } finally {
    loaded.restore();
  }
});

test('aprobacion_multa aplazar from listado redirects to sanctions list', async () => {
  const loaded = loadRoute({
    queryImpl: async (sql) => {
      if (sql.includes("SET con_estado_multa = 'APLAZADA'")) {
        return { rowCount: 1, rows: [] };
      }

      if (sql.includes('SELECT u.documento FROM multa')) {
        return { rows: [{ documento: '20241001' }] };
      }

      return { rows: [], rowCount: 1 };
    },
  });

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/aplazar').type('form').send({
      multa_id: '33',
      source: 'listado',
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/milab/api/get_list_multas?success=aplazada');
  } finally {
    loaded.restore();
  }
});

test('aprobacion_multa reactivar from listado redirects to sanctions list', async () => {
  const loaded = loadRoute({
    queryImpl: async (sql) => {
      if (sql.includes("SET con_estado_multa = 'ACTIVA'")) {
        return { rowCount: 1, rows: [] };
      }

      if (sql.includes('SELECT u.documento FROM multa')) {
        return { rows: [{ documento: '20241001' }] };
      }

      return { rows: [], rowCount: 1 };
    },
  });

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/reactivar').type('form').send({
      multa_id: '33',
      source: 'listado',
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/milab/api/get_list_multas?success=reactivada');
  } finally {
    loaded.restore();
  }
});

test('aprobacion_multa aplazar from docente source redirects to teacher management page', async () => {
  const loaded = loadRoute({
    queryImpl: async (sql) => {
      if (sql.includes("SET con_estado_multa = 'APLAZADA'")) {
        return { rowCount: 1, rows: [] };
      }

      if (sql.includes('SELECT u.documento FROM multa')) {
        return { rows: [{ documento: '20241001' }] };
      }

      return { rows: [], rowCount: 1 };
    },
  });

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/aplazar').type('form').send({
      multa_id: '33',
      source: 'docente',
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/milab/api/get-info-multa-docente/get');
  } finally {
    loaded.restore();
  }
});

test('aprobacion_multa reactivar from estudiante source redirects to student management page', async () => {
  const loaded = loadRoute({
    queryImpl: async (sql) => {
      if (sql.includes("SET con_estado_multa = 'ACTIVA'")) {
        return { rowCount: 1, rows: [] };
      }

      if (sql.includes('SELECT u.documento FROM multa')) {
        return { rows: [{ documento: '20241001' }] };
      }

      return { rows: [], rowCount: 1 };
    },
  });

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/reactivar').type('form').send({
      multa_id: '33',
      source: 'estudiante',
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/milab/api/get-info-multa/get');
  } finally {
    loaded.restore();
  }
});

test('aprobacion_multa activar fails when sanction email cannot be sent', async () => {
  const loaded = loadRoute({
    queryImpl: async (sql) => {
      if (sql.includes('UPDATE multa AS m')) {
        return { rowCount: 1, rows: [] };
      }

      if (sql.includes('SELECT m.usuario_sancionado_id')) {
        return {
          rows: [
            { usuario_sancionado_id: 77, fecha_multa: '2026-01-01', ual: 'Lab', obs_multa: '' },
          ],
        };
      }

      return { rows: [], rowCount: 1 };
    },
    resolveStudentContactImpl: async () => ({
      nombre: 'Estudiante',
      documento: '123',
      codigo: '2024',
      correo: 'estudiante@udistrital.edu.co',
    }),
    sendSanctionEmailImpl: async () => ({ ok: false, reason: 'send-mail-error' }),
  });

  try {
    const app = buildApp(loaded.route);
    const response = await request(app).post('/activar').type('form').send({
      multa_id: '1',
      tipo_sancion: 'Firma de compromiso de buen uso',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/message_error');
    assert.match(response.body.locals.message, /Error al activar la sanción/i);
  } finally {
    loaded.restore();
  }
});
