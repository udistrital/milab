const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');

const { buildApp, resolveRepoPath } = require('../../integration/helpers/build-test-app');
const { createSessionHarness, createUser } = require('../../integration/helpers/session-fixtures');

const routePath = resolveRepoPath('src/routes/api/capacitacion-gestion.js');
const dbPath = resolveRepoPath('src/libs/db.js');
const authPath = resolveRepoPath('src/routes/middlewares/auth.js');
const scopePath = resolveRepoPath('src/libs/capacitacion-scope.js');
const notificationsPath = resolveRepoPath('src/libs/email-notifications.js');

const allowJsonRoles = () => (req, res, next) => next();

function loadRoute({
  query,
  connect,
  scope = { isAdmin: true },
  user = {},
  authModule = { requireJsonRoles: allowJsonRoles },
} = {}) {
  const sessionHarness = createSessionHarness({
    user: createUser({
      tipo: 'estudiante',
      roles: ['estudiante'],
      id: 55,
      documento: 'student-1',
      nombre: 'Estudiante Prueba',
      ...user,
      documento_real: user.documento_real || user.documento || 'student-1',
    }),
  });
  return buildApp({
    entryPath: routePath,
    sessionHarness,
    stubs: [
      [dbPath, { query: query || (async () => ({ rows: [] })), connect }],
      [authPath, authModule],
      [scopePath, { resolveLaboratoristaScope: async () => scope }],
      [notificationsPath, { sendEmailNotification: async () => ({ ok: true }) }],
    ],
    purgePaths: [routePath],
  });
}

test('active sanctions block a training request before querying the course catalog', async () => {
  const queries = [];
  const loaded = loadRoute({
    query: async (sql) => {
      queries.push(sql);
      return { rows: [{ total: 1 }] };
    },
  });

  try {
    const response = await request(loaded.app)
      .post('/solicitar')
      .send({ codigo_curso: 'COURSE-1' });

    assert.equal(response.status, 403);
    assert.match(response.body.message, /sanciones activas/i);
    assert.equal(queries.length, 1);
    assert.match(queries[0], /FROM multa/);
  } finally {
    loaded.restore();
  }
});

test('sanction-query failures fail closed for both requests and enrollments', async () => {
  for (const path of ['/solicitar', '/inscribirme/8']) {
    let connectCalls = 0;
    const loaded = loadRoute({
      query: async () => {
        throw new Error('sanction database unavailable');
      },
      connect: async () => {
        connectCalls += 1;
        throw new Error('enrollment database should not be reached');
      },
    });

    try {
      const response = await request(loaded.app).post(path).send({ codigo_curso: 'COURSE-1' });

      assert.equal(response.status, 500);
      assert.equal(connectCalls, 0);
    } finally {
      loaded.restore();
    }
  }
});

test('a duplicate pending request returns a conflict without inserting another request', async () => {
  const queries = [];
  const loaded = loadRoute({
    query: async (sql) => {
      queries.push(sql);
      if (sql.includes('FROM multa')) return { rows: [{ total: 0 }] };
      if (sql.includes('FROM cursos')) {
        return {
          rows: [{ codigo_curso: 'COURSE-1', nombre_curso: 'Curso uno', id_facultad: 2 }],
        };
      }
      if (sql.includes('FROM solicitud_capacitacion')) return { rows: [{ ok: 1 }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  });

  try {
    const response = await request(loaded.app)
      .post('/solicitar')
      .send({ codigo_curso: 'COURSE-1' });

    assert.equal(response.status, 409);
    assert.match(response.body.message, /solicitud pendiente/i);
    assert.equal(queries.length, 3);
    assert.equal(
      queries.some((sql) => sql.includes('INSERT INTO solicitud_capacitacion')),
      false
    );
  } finally {
    loaded.restore();
  }
});

test('full sessions retain the enrollment as cupo_excedido and commit it', async () => {
  const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const calls = [];
  let released = false;
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM sesion_capacitacion s')) {
        return {
          rows: [
            {
              id: 8,
              codigo_curso: 'COURSE-1',
              nombre_curso_snapshot: 'Curso uno',
              cupo_maximo: 1,
              estado: 'programada',
              fecha_fin: futureDate,
              facultad_id: 2,
              ual_id: 4,
            },
          ],
        };
      }
      if (sql.includes('SELECT estado FROM inscripcion_sesion_capacitacion')) {
        return { rows: [] };
      }
      if (sql.includes('SELECT COUNT(*)::int AS total FROM inscripcion_sesion_capacitacion')) {
        return { rows: [{ total: 1 }] };
      }
      if (sql.includes('INSERT INTO inscripcion_sesion_capacitacion')) {
        return {
          rows: [
            {
              id: 99,
              sesion_capacitacion_id: 8,
              usuario_documento: 'student-1',
              estado: params[4],
              origen: params[5],
            },
          ],
        };
      }
      return { rows: [] };
    },
    release() {
      released = true;
    },
  };
  const loaded = loadRoute({
    query: async (sql) => {
      assert.match(sql, /FROM multa/);
      return { rows: [{ total: 0 }] };
    },
    connect: async () => client,
  });

  try {
    const response = await request(loaded.app).post('/inscribirme/8').send({});

    assert.equal(response.status, 201);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.inscripcion.estado, 'cupo_excedido');
    assert.equal(response.body.cupo_disponible, 0);
    assert.match(response.body.message, /cupo se ha excedido/i);
    const sessionReadIndex = calls.findIndex(({ sql }) =>
      sql.includes('FROM sesion_capacitacion s')
    );
    const occupiedCountIndex = calls.findIndex(({ sql }) =>
      sql.includes('SELECT COUNT(*)::int AS total FROM inscripcion_sesion_capacitacion')
    );
    assert.match(calls[sessionReadIndex].sql, /FOR UPDATE/);
    assert.ok(sessionReadIndex < occupiedCountIndex);
    assert.ok(calls.some(({ sql }) => sql === 'COMMIT'));
    assert.equal(released, true);
  } finally {
    loaded.restore();
  }
});

test('an existing active enrollment returns conflict and rolls back', async () => {
  let insertCalls = 0;
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);
      if (sql.includes('FROM sesion_capacitacion s')) {
        return {
          rows: [
            {
              id: 8,
              codigo_curso: 'COURSE-1',
              nombre_curso_snapshot: 'Curso uno',
              cupo_maximo: 4,
              estado: 'programada',
              fecha_fin: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
              facultad_id: 2,
              ual_id: 4,
            },
          ],
        };
      }
      if (sql.includes('SELECT estado FROM inscripcion_sesion_capacitacion')) {
        return { rows: [{ estado: 'inscrito' }] };
      }
      if (sql.includes('INSERT INTO inscripcion_sesion_capacitacion')) {
        insertCalls += 1;
      }
      return { rows: [] };
    },
    release() {},
  };
  const loaded = loadRoute({
    query: async () => ({ rows: [{ total: 0 }] }),
    connect: async () => client,
  });

  try {
    const response = await request(loaded.app).post('/inscribirme/8').send({});

    assert.equal(response.status, 409);
    assert.match(response.body.message, /ya estás inscrito/i);
    assert.ok(calls.includes('ROLLBACK'));
    assert.equal(insertCalls, 0);
  } finally {
    loaded.restore();
  }
});

test('current-certification filter returns only non-expired active certificates', async () => {
  let queryParams;
  let querySql;
  const loaded = loadRoute({
    query: async (sql, params) => {
      querySql = sql;
      queryParams = params;
      return {
        rows: [
          { id: 1, vigente: true, codigo_curso: 'CURRENT' },
          { id: 2, vigente: false, codigo_curso: 'EXPIRED' },
        ],
      };
    },
  });

  try {
    const response = await request(loaded.app).get('/mis-certificaciones?vigente=true');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.certificaciones, [
      { id: 1, vigente: true, codigo_curso: 'CURRENT' },
    ]);
    assert.deepEqual(queryParams, ['student-1']);
    assert.match(querySql, /c\.fecha_vencimiento > CURRENT_TIMESTAMP/);
  } finally {
    loaded.restore();
  }
});

test('expired certificates appear only in the expired-certification filter', async () => {
  const loaded = loadRoute({
    query: async () => ({
      rows: [
        { id: 1, vigente: true, codigo_curso: 'CURRENT' },
        { id: 2, vigente: false, codigo_curso: 'EXPIRED' },
      ],
    }),
  });

  try {
    const response = await request(loaded.app).get('/mis-certificaciones?vigente=false');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.certificaciones, [
      { id: 2, vigente: false, codigo_curso: 'EXPIRED' },
    ]);
  } finally {
    loaded.restore();
  }
});

test('a laboratorista cannot mark attendance for a session outside their UAL scope', async () => {
  const queries = [];
  const loaded = loadRoute({
    query: async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    },
    scope: { isAdmin: false, ualIds: [11], facultyIds: [2] },
    user: { tipo: 'laboratorista', roles: ['laboratorista'], documento: 'lab-1' },
  });

  try {
    const response = await request(loaded.app)
      .post('/gestion/asistencia/marcar')
      .send({ sesion_id: 8, usuario_documento: 'student-1' });

    assert.equal(response.status, 404);
    assert.match(response.body.message, /fuera de su scope/i);
    assert.equal(queries.length, 1);
    assert.deepEqual(queries[0].params, [8, [11]]);
    assert.match(queries[0].sql, /s\.ual_id = ANY\(\$2::int\[\]\)/);
  } finally {
    loaded.restore();
  }
});

test('JSON and CSV reports constrain laboratorista rows to their assigned scope', async () => {
  for (const endpoint of ['/gestion/reporte', '/gestion/reporte.csv']) {
    const queries = [];
    const loaded = loadRoute({
      query: async (sql, params) => {
        queries.push({ sql, params });
        return { rows: [] };
      },
      scope: { isAdmin: false, ualIds: [11], facultyIds: [2] },
      user: { tipo: 'laboratorista', roles: ['laboratorista'], documento: 'lab-1' },
    });

    try {
      const response = await request(loaded.app).get(endpoint);

      assert.equal(response.status, 200);
      assert.equal(queries.length, 1);
      assert.deepEqual(queries[0].params, [[11], [2]]);
      assert.match(queries[0].sql, /s\.ual_id = ANY\(\$1::int\[\]\)/);
      assert.match(queries[0].sql, /s\.facultad_id = ANY\(\$2::int\[\]\)/);
      if (endpoint.endsWith('.csv')) {
        assert.match(response.text, /Sesion ID/);
      } else {
        assert.equal(response.body.filas, 0);
      }
    } finally {
      loaded.restore();
    }
  }
});

test('evidence uploads outside a laboratorista scope are rejected and removed', async () => {
  const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'milab-capacitacion-evidence-'));
  const previousEvidenceDir = process.env.CAPACITACION_EVIDENCIA_DIR;
  process.env.CAPACITACION_EVIDENCIA_DIR = evidenceDir;
  let queryCalls = 0;
  const loaded = loadRoute({
    query: async () => {
      queryCalls += 1;
      return { rows: [] };
    },
    scope: { isAdmin: false, ualIds: [], facultyIds: [] },
    user: { tipo: 'laboratorista', roles: ['laboratorista'], documento: 'lab-1' },
  });

  try {
    const response = await request(loaded.app)
      .post('/gestion/sesiones/8/evidencia')
      .attach('evidencia', Buffer.from('%PDF-1.7\n'), {
        filename: 'evidence.pdf',
        contentType: 'application/pdf',
      });

    assert.equal(response.status, 403);
    assert.match(response.body.message, /no tiene permisos/i);
    assert.deepEqual(fs.readdirSync(evidenceDir), []);
    assert.equal(queryCalls, 0);
  } finally {
    loaded.restore();
    if (previousEvidenceDir === undefined) {
      delete process.env.CAPACITACION_EVIDENCIA_DIR;
    } else {
      process.env.CAPACITACION_EVIDENCIA_DIR = previousEvidenceDir;
    }
    fs.rmSync(evidenceDir, { recursive: true, force: true });
  }
});

test('management routes reject students using the real role middleware', async () => {
  let queryCalls = 0;
  const authModule = require(resolveRepoPath('src/routes/middlewares/auth.js'));
  const loaded = loadRoute({
    authModule,
    user: { tipo: 'estudiante', roles: ['estudiante'] },
    query: async () => {
      queryCalls += 1;
      return { rows: [] };
    },
  });

  try {
    const response = await request(loaded.app)
      .post('/gestion/sesiones/8/cambiar-estado')
      .send({ estado: 'cancelada' });

    assert.equal(response.status, 403);
    assert.equal(response.body.ok, false);
    assert.equal(queryCalls, 0);
  } finally {
    loaded.restore();
  }
});

test('empty management scope returns no sessions without querying the database', async () => {
  let queryCalls = 0;
  const loaded = loadRoute({
    scope: {
      isAdmin: false,
      ualIds: [],
      facultyIds: [],
      resolvedFrom: 'role_laboratorista_no_ual_rows',
    },
    query: async () => {
      queryCalls += 1;
      return { rows: [] };
    },
    user: { tipo: 'laboratorista', roles: ['laboratorista'], documento: 'lab-1' },
  });

  try {
    const response = await request(loaded.app).get('/gestion/sesiones');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.sesiones, []);
    assert.equal(response.body.scope_vacio, true);
    assert.equal(queryCalls, 0);
  } finally {
    loaded.restore();
  }
});

test('a laboratorista cannot schedule a course in an unassigned UAL', async () => {
  const queries = [];
  const loaded = loadRoute({
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('FROM cursos')) {
        return {
          rows: [{ codigo_curso: 'COURSE-1', nombre_curso: 'Curso uno', id_facultad: 2 }],
        };
      }
      if (sql.includes('FROM ual')) {
        return { rows: [{ ual_id: 12, facultad_id: 2, nombre: 'Laboratorio externo' }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    scope: { isAdmin: false, ualIds: [11], facultyIds: [2] },
    user: { tipo: 'laboratorista', roles: ['laboratorista'], documento: 'lab-1' },
  });

  try {
    const response = await request(loaded.app).post('/gestion/sesiones/programar').send({
      codigo_curso: 'COURSE-1',
      ual_id: 12,
      fecha_inicio: '2030-05-01T09:00:00-05:00',
      fecha_fin: '2030-05-01T11:00:00-05:00',
      cupo: 10,
    });

    assert.equal(response.status, 403);
    assert.match(response.body.message, /no está asignado/i);
    assert.equal(queries.length, 2);
    assert.equal(
      queries.some(({ sql }) => sql.includes('INSERT INTO sesion_capacitacion')),
      false
    );
  } finally {
    loaded.restore();
  }
});

test('a session ending before it starts is rejected before database access', async () => {
  let queryCalls = 0;
  const loaded = loadRoute({
    query: async () => {
      queryCalls += 1;
      return { rows: [] };
    },
    scope: { isAdmin: true, ualIds: [], facultyIds: [] },
    user: { tipo: 'admin', roles: ['admin'], documento: 'admin-1' },
  });

  try {
    const response = await request(loaded.app).post('/gestion/sesiones/programar').send({
      codigo_curso: 'COURSE-1',
      fecha_inicio: '2030-05-01T11:00:00-05:00',
      fecha_fin: '2030-05-01T09:00:00-05:00',
      cupo: 10,
    });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /fecha_fin debe ser posterior/i);
    assert.equal(queryCalls, 0);
  } finally {
    loaded.restore();
  }
});

test('attendance must exist before a session can issue certifications', async () => {
  const calls = [];
  let released = false;
  const client = {
    async query(sql) {
      calls.push(sql);
      if (sql.includes('FROM sesion_capacitacion s')) {
        return {
          rows: [
            {
              id: 8,
              codigo_curso: 'COURSE-1',
              nombre_curso_snapshot: 'Curso uno',
              facultad_id: 2,
              ual_id: 4,
              estado: 'realizada',
              fecha_fin: new Date(Date.now() - 60_000).toISOString(),
            },
          ],
        };
      }
      if (sql.includes('FROM asistencia_capacitacion a')) return { rows: [] };
      return { rows: [] };
    },
    release() {
      released = true;
    },
  };
  const loaded = loadRoute({
    connect: async () => client,
    scope: { isAdmin: true, ualIds: [], facultyIds: [] },
    user: { tipo: 'admin', roles: ['admin'], documento: 'admin-1' },
  });

  try {
    const response = await request(loaded.app)
      .post('/gestion/sesiones/8/certificar-asistentes')
      .send({});

    assert.equal(response.status, 400);
    assert.match(response.body.message, /no hay usuarios con asistencia/i);
    assert.ok(calls.includes('ROLLBACK'));
    assert.equal(released, true);
  } finally {
    loaded.restore();
  }
});

test('only users with positive attendance are issued certificates', async () => {
  const calls = [];
  let released = false;
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM sesion_capacitacion s')) {
        return {
          rows: [
            {
              id: 8,
              codigo_curso: 'COURSE-1',
              nombre_curso_snapshot: 'Curso uno',
              facultad_id: 2,
              ual_id: 4,
              estado: 'realizada',
              fecha_fin: new Date(Date.now() - 60_000).toISOString(),
            },
          ],
        };
      }
      if (sql.includes('FROM asistencia_capacitacion a')) {
        assert.match(sql, /a\.asistio = TRUE/);
        return {
          rows: [{ usuario_documento: 'attendee-1', usuario_nombre: 'Asistente' }],
        };
      }
      if (sql.includes('FROM usuario WHERE documento = $1')) {
        return { rows: [{ id: 55, documento: 'attendee-1', tipo: 'Estudiante' }] };
      }
      if (sql.includes('INSERT INTO certificacion_usuario')) {
        return {
          rows: [
            {
              id: 101,
              codigo_curso: 'COURSE-1',
              usuario_documento: params[3],
              vigencia_meses: params[6],
            },
          ],
        };
      }
      return { rows: [] };
    },
    release() {
      released = true;
    },
  };
  const loaded = loadRoute({
    connect: async () => client,
    scope: { isAdmin: true, ualIds: [], facultyIds: [] },
    user: { tipo: 'admin', roles: ['admin'], documento: 'admin-1' },
  });

  try {
    const response = await request(loaded.app)
      .post('/gestion/sesiones/8/certificar-asistentes')
      .send({});

    assert.equal(response.status, 200);
    assert.equal(response.body.total_procesados, 1);
    assert.equal(response.body.total_certificados, 1);
    assert.deepEqual(
      calls
        .filter(({ sql }) => sql.includes('INSERT INTO certificacion_usuario'))
        .map(({ params }) => params[3]),
      ['attendee-1']
    );
    assert.ok(calls.some(({ sql }) => sql === 'COMMIT'));
    assert.equal(released, true);
  } finally {
    loaded.restore();
  }
});
