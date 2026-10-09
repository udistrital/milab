const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const ejs = require('ejs');

const routePath = path.resolve(__dirname, '../../../src/routes/api/sanciones.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const notificationPath = path.resolve(__dirname, '../../../src/libs/email-notifications.js');
const student = { tipo: 'estudiante', documento: '123' };
const lab = { tipo: 'laboratorista', documento: '456' };

function setup({
  user = student,
  duplicate = false,
  ownSanction = true,
  auditFailure = false,
  notificationFailure = false,
  inactiveResponsible = false,
  updateAllowed = true,
} = {}) {
  const originals = new Map();
  const calls = [];
  const notifications = [];
  let releases = 0;
  const session = { user };
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('SELECT id FROM usuario')) return { rows: [{ id: 7 }] };
    if (sql.includes('SELECT documento FROM laboratorista'))
      return { rows: [{ documento: '456' }] };
    if (sql.includes('FROM multa WHERE'))
      return {
        rows: ownSanction
          ? [{ id: 9, laboratorista_documento_id: '456', con_estado_multa: 'ACTIVA' }]
          : [],
      };
    if (sql.includes('INSERT INTO reclamacion_sancion'))
      return { rows: duplicate ? [] : [{ id: 11 }] };
    if (sql.includes('UPDATE reclamacion_sancion'))
      return { rows: updateAllowed ? [{ id: 11 }] : [] };
    if (sql.includes('INSERT INTO log') && auditFailure) throw new Error('audit unavailable');
    if (sql.includes('correo_laboratorista'))
      return {
        rows: [
          {
            id: 11,
            multa_id: 9,
            correo_laboratorista: 'laboratorista@example.test',
            correo_estudiante: 'estudiante@example.test',
            responsable_activo: !inactiveResponsible,
          },
        ],
      };
    return { rows: [] };
  };
  const stubs = [
    [
      dbPath,
      {
        query,
        connect: async () => ({
          query,
          release: () => {
            releases++;
          },
        }),
      },
    ],
    [
      notificationPath,
      {
        sendEmailNotification: async (notification) => {
          notifications.push(notification);
          return notificationFailure
            ? { status: 'FAILED', error: 'SMTP unavailable' }
            : { status: 'SENT' };
        },
      },
    ],
  ];
  for (const [modulePath, exports] of stubs) {
    originals.set(modulePath, require.cache[modulePath]);
    require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports };
  }
  delete require.cache[routePath];
  const app = express();
  app.use((req, res, next) => {
    req.session = session;
    res.render = (view, locals) => res.json({ view, locals });
    next();
  });
  app.use('/', require(routePath));
  return {
    app,
    session,
    calls,
    notifications,
    getReleases: () => releases,
    restore() {
      for (const [modulePath, original] of originals) {
        if (original) require.cache[modulePath] = original;
        else delete require.cache[modulePath];
      }
      delete require.cache[routePath];
    },
  };
}

test('student submits once to the creator and sees success; claim is committed before notification', async () => {
  const fixture = setup();
  try {
    const response = await request(fixture.app)
      .post('/mis-sanciones/9/reclamar')
      .type('form')
      .send({
        texto: 'Solicito una revisión',
        usuario_id: 888,
        responsable_documento: 'forged',
      });
    assert.equal(response.status, 303);
    assert.equal(response.headers.location, '/milab/api/sanciones/mis-sanciones');
    assert.equal(fixture.calls.at(-2).sql, 'COMMIT');
    assert.equal(fixture.getReleases(), 1);
    assert.deepEqual(
      fixture.calls.find((call) => call.sql.includes('INSERT INTO reclamacion')).params,
      [9, '456', 'Solicito una revisión']
    );
    assert.equal(fixture.notifications[0].recipient, 'laboratorista@example.test');
    assert.match(fixture.notifications[0].variables.actionUrl, /\/sanciones\/reclamaciones$/);
    const page = await request(fixture.app).get('/mis-sanciones');
    assert.equal(page.body.locals.feedback.type, 'success');
    assert.equal(fixture.session.sanctionClaimFeedback, undefined);
  } finally {
    fixture.restore();
  }
});

test('claim uniqueness, ownership and malformed input fail without notification or commit', async () => {
  for (const [options, payload, status] of [
    [{ duplicate: true }, { texto: 'Revisión' }, 409],
    [{ ownSanction: false }, { texto: 'Revisión' }, 404],
    [{}, { texto: 'a'.repeat(501) }, 400],
    [{}, { texto: ' ' }, 400],
  ]) {
    const fixture = setup(options);
    try {
      const response = await request(fixture.app).post('/mis-sanciones/9/reclamar').send(payload);
      assert.equal(response.status, status);
      assert.ok(fixture.calls.some((call) => call.sql === 'ROLLBACK'));
      assert.ok(!fixture.calls.some((call) => call.sql === 'COMMIT'));
      assert.equal(fixture.notifications.length, 0);
      assert.equal(fixture.getReleases(), 1);
    } finally {
      fixture.restore();
    }
  }
});

test('non-student and impersonated sessions cannot submit a claim', async () => {
  for (const user of [
    null,
    lab,
    { tipo: 'admin' },
    { tipo: 'coordinador_general' },
    { ...student, __impersonating: true },
  ]) {
    const fixture = setup({ user });
    try {
      const response = await request(fixture.app)
        .post('/mis-sanciones/9/reclamar')
        .send({ texto: 'Revisión' });
      assert.equal(response.body.view, 'home/message_error');
      assert.ok(!fixture.calls.some((call) => call.sql.includes('INSERT INTO reclamacion')));
      assert.equal(fixture.notifications.length, 0);
    } finally {
      fixture.restore();
    }
  }
});

test('responsible laboratorista submits a final response and the student is notified', async () => {
  const fixture = setup({ user: lab });
  try {
    const response = await request(fixture.app).post('/reclamaciones/11/responder').send({
      respuesta: 'Procede revisar el registro',
      decision: 'PROCEDE',
    });
    assert.equal(response.status, 303);
    assert.equal(fixture.notifications[0].recipient, 'estudiante@example.test');
    assert.equal(fixture.notifications[0].variables.answered, true);
    assert.ok(fixture.calls.some((call) => call.sql === 'COMMIT'));
    assert.ok(!fixture.calls.some((call) => call.sql.includes('UPDATE multa')));
    assert.match(fixture.session.sanctionClaimFeedback.message, /no se modificó/);
  } finally {
    fixture.restore();
  }
});

test('unassigned or already answered claims cannot be answered again', async () => {
  const fixture = setup({ user: lab, updateAllowed: false });
  try {
    assert.equal(
      (
        await request(fixture.app).post('/reclamaciones/11/responder').send({
          respuesta: 'Respuesta',
          decision: 'NO_PROCEDE',
        })
      ).status,
      409
    );
    assert.equal(fixture.notifications.length, 0);
    assert.ok(!fixture.calls.some((call) => call.sql === 'COMMIT'));
  } finally {
    fixture.restore();
  }
});

test('SMTP failure and inactive creator keep the committed claim visible and explicitly warn', async () => {
  for (const options of [{ notificationFailure: true }, { inactiveResponsible: true }]) {
    const fixture = setup(options);
    try {
      assert.equal(
        (await request(fixture.app).post('/mis-sanciones/9/reclamar').send({ texto: 'Revisión' }))
          .status,
        303
      );
      assert.ok(fixture.calls.some((call) => call.sql === 'COMMIT'));
      assert.ok(!fixture.calls.some((call) => call.sql === 'ROLLBACK'));
      assert.equal(fixture.session.sanctionClaimFeedback.type, 'warning');
      assert.match(
        fixture.session.sanctionClaimFeedback.message,
        options.inactiveResponsible ? /inactivo/ : /correo/
      );
    } finally {
      fixture.restore();
    }
  }
});

test('failed audit rolls back and never sends the claim notice', async () => {
  const fixture = setup({ auditFailure: true });
  try {
    assert.equal(
      (await request(fixture.app).post('/mis-sanciones/9/reclamar').send({ texto: 'Revisión' }))
        .status,
      500
    );
    assert.ok(fixture.calls.some((call) => call.sql === 'ROLLBACK'));
    assert.ok(!fixture.calls.some((call) => call.sql === 'COMMIT'));
    assert.equal(fixture.notifications.length, 0);
  } finally {
    fixture.restore();
  }
});

test('inbox is restricted to assigned claims; admin and general coordinator can read all', async () => {
  for (const [user, document] of [
    [lab, '456'],
    [{ tipo: 'admin' }, null],
    [{ tipo: 'coordinador_general' }, null],
  ]) {
    const fixture = setup({ user });
    try {
      const response = await request(fixture.app).get('/reclamaciones');
      assert.equal(response.body.view, 'home/reclamaciones_sanciones');
      const query = fixture.calls.find((call) => call.sql.includes('SELECT r.*'));
      assert.deepEqual(query.params, [document]);
      assert.equal(response.body.locals.readOnly, user.tipo === 'coordinador_general');
    } finally {
      fixture.restore();
    }
  }
});

test('only admin can reassign; admin and coordinator general cannot issue responses', async () => {
  const fixture = setup({ user: { tipo: 'admin', documento: '999' } });
  try {
    assert.equal(
      (
        await request(fixture.app)
          .post('/reclamaciones/11/reasignar')
          .send({ responsable_documento: '456' })
      ).status,
      303
    );
    assert.equal(fixture.notifications[0].recipient, 'laboratorista@example.test');
    assert.equal(
      (
        await request(fixture.app)
          .post('/reclamaciones/11/responder')
          .send({ respuesta: 'Respuesta', decision: 'PROCEDE' })
      ).status,
      403
    );
  } finally {
    fixture.restore();
  }
  for (const user of [lab, { tipo: 'coordinador_general' }]) {
    const restricted = setup({ user });
    try {
      const response = await request(restricted.app)
        .post('/reclamaciones/11/reasignar')
        .send({ responsable_documento: '456' });
      assert.equal(response.body.view, 'home/message_error');
      assert.ok(!restricted.calls.some((call) => call.sql.includes('UPDATE reclamacion')));
    } finally {
      restricted.restore();
    }
  }
});

test('marking a response read is constrained to the authenticated student and is idempotent', async () => {
  const fixture = setup();
  try {
    assert.equal((await request(fixture.app).post('/mis-sanciones/11/leida')).status, 303);
    const update = fixture.calls.find((call) => call.sql.includes('UPDATE reclamacion_sancion'));
    assert.deepEqual(update.params, [7, 11]);
    assert.match(update.sql, /m.usuario_sancionado_id = \$1/);
    assert.match(update.sql, /COALESCE\(r.fecha_lectura/);
  } finally {
    fixture.restore();
  }
});

test('student UI exposes a claim icon only for unclaimed active sanctions and escapes texts', async () => {
  const rows = [
    {
      id: 1,
      cat_multa: '<script>Equipos</script>',
      con_estado_multa: 'ACTIVA',
      fecha_multa: '2026-10-08',
    },
    {
      id: 2,
      cat_multa: 'Ya reclamada',
      con_estado_multa: 'ACTIVA',
      reclamacion_id: 8,
      texto: 'Consulta',
    },
    {
      id: 3,
      cat_multa: 'Saldada con respuesta',
      con_estado_multa: 'SALDADA',
      reclamacion_id: 9,
      fecha_respuesta: '2026-10-08T12:00:00Z',
      respuesta: 'Respuesta',
      decision: 'PROCEDE',
    },
  ];
  const html = await ejs.renderFile(
    path.resolve(__dirname, '../../../src/views/home/mis_sanciones.ejs'),
    {
      tipo: 'estudiante',
      cspNonce: 'test',
      csrfToken: 'token',
      feedback: null,
      sanctions: rows,
    }
  );
  assert.equal((html.match(/data-claim-action="claim"/g) || []).length, 1);
  assert.equal((html.match(/data-claim-action="view"/g) || []).length, 3);
  assert.match(html, /maxlength="500"/);
  assert.match(html, /&lt;script&gt;Equipos&lt;\/script&gt;/);
  assert.match(html, /Marcar respuesta como leída/);
  assert.match(html, /Historial de reclamación/);
  assert.match(html, /8\/10\/2026/);
});
