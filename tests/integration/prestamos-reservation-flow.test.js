const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { buildApp, resolveRepoPath } = require('./helpers/build-test-app');
const { createSessionHarness, createUser } = require('./helpers/session-fixtures');

const routePath = resolveRepoPath('src/routes/api/prestamos.js');
const authPath = resolveRepoPath('src/routes/middlewares/auth.js');
const dbPath = resolveRepoPath('src/libs/db.js');
const permissionsPath = resolveRepoPath('src/libs/permissions.js');
const prestamosModuleAccessPath = resolveRepoPath('src/libs/prestamos-module-access.js');
const operationalRolesPath = resolveRepoPath('src/libs/operational-role-assignments.js');
const emailNotificationsPath = resolveRepoPath('src/libs/email-notifications.js');
const certificationValidationPath = resolveRepoPath('src/libs/capacitacion-cert-validation.js');

function loadReservationApp({ queryImpl, transactionClient } = {}) {
  const sessionHarness = createSessionHarness({
    user: createUser({ tipo: 'estudiante', roles: ['estudiante'], id: 22, documento: '20241001' }),
  });

  return buildApp({
    entryPath: routePath,
    sessionHarness,
    stubs: [
      [
        authPath,
        {
          requirePermissions: () => (req, res, next) => next(),
          requireRoles: () => (req, res, next) => next(),
          renderAuthError: (res, payload) => res.render('home/message_error', payload),
        },
      ],
      [
        dbPath,
        {
          query: async (sql, params = []) => {
            if (typeof queryImpl === 'function') {
              const result = await queryImpl(sql, params);
              if (result !== undefined) return result;
            }

            if (sql.includes('FROM usuario u')) {
              return {
                rows: [
                  {
                    id: 22,
                    documento: '20241001',
                    nombre: 'Estudiante Demo',
                    correo: 'estudiante@udistrital.edu.co',
                    roles: ['estudiante'],
                  },
                ],
              };
            }

            if (sql.includes('SELECT COUNT(*)::int AS total')) {
              return { rows: [{ total: 2 }] };
            }

            return { rows: [] };
          },
          connect: async () =>
            transactionClient || { query: async () => ({ rows: [] }), release() {} },
        },
      ],
      [
        permissionsPath,
        {
          APP_PERMISSIONS: new Proxy({}, { get: (_, key) => String(key) }),
          hasPermission: () => true,
        },
      ],
      [
        prestamosModuleAccessPath,
        { getPrestamosModuleAccess: async () => ({ blocked: false, role: 'estudiante' }) },
      ],
      [
        operationalRolesPath,
        { fetchOperationalRoleScopeByUser: async () => ({ facultyIds: [], ualIds: [] }) },
      ],
      [emailNotificationsPath, { sendEmailNotification: async () => {} }],
      [
        certificationValidationPath,
        {
          getCursosActivosDeEquipo: async () => [],
          validarCertificacionesParaReserva: async () => {},
        },
      ],
    ],
    purgePaths: [routePath],
  });
}

function createLoanReservationDatabase({ failOnInsert = false, slotBusy = false } = {}) {
  const poolCalls = [];
  const transactionCalls = [];
  let released = false;

  return {
    poolCalls,
    transactionCalls,
    isReleased: () => released,
    queryImpl: async (sql) => {
      poolCalls.push(sql);
      if (sql.includes('FROM usuario u')) {
        return {
          rows: [
            {
              id: 22,
              documento: '20241001',
              nombre: 'Estudiante Demo',
              correo: 'estudiante@udistrital.edu.co',
              roles: ['estudiante'],
            },
          ],
        };
      }
      if (sql.includes('FROM multa')) return { rows: [{ total: 0 }] };
      if (sql.includes('FROM equipo_catalogo')) {
        return {
          rows: [
            {
              id: 5,
              codigo: 'EQ-5',
              nombre: 'Microscopio',
              laboratorio: 'Lab. Ciencias',
            },
          ],
        };
      }
      if (sql.includes('FROM horario_equipo')) {
        return {
          rows: [
            {
              fecha: '2999-12-31',
              hora_inicio: '10:00',
              hora_fin: '11:00',
              activo: true,
            },
          ],
        };
      }
      if (sql.includes('SELECT fecha_inicio, fecha_fin, estado')) {
        return {
          rows: slotBusy
            ? [
                {
                  fecha_inicio: '2999-12-31T15:30:00Z',
                  fecha_fin: '2999-12-31T16:30:00Z',
                  estado: 'aprobado',
                },
              ]
            : [],
        };
      }
      if (sql.includes('FROM parametrizacion')) {
        return { rows: [{ max_horas_mes_prestamos: 0 }] };
      }
      return undefined;
    },
    transactionClient: {
      async query(sql, params) {
        transactionCalls.push({ sql, params });
        if (sql.includes('FROM equipo_catalogo')) {
          return {
            rows: [
              {
                id: 5,
                codigo: 'EQ-5',
                nombre: 'Microscopio',
                laboratorio: 'Lab. Ciencias',
              },
            ],
          };
        }
        if (sql.includes('INSERT INTO solicitud_prestamo')) {
          if (failOnInsert) throw new Error('Database insert failed');
          return { rows: [{ id: 901, fecha_creacion: '2999-01-01T00:00:00Z' }] };
        }
        return { rows: [] };
      },
      release() {
        released = true;
      },
    },
  };
}

test('prestamos reservation form loads visible sanctions count for the current student', async () => {
  const loaded = loadReservationApp();

  try {
    const response = await request(loaded.app).get('/solicitar');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/prestamos/solicitudes/solicitar');
    assert.equal(response.body.locals.sancionesActivas, 2);
  } finally {
    loaded.restore();
  }
});

test('prestamos reservation lookup redirects when faculty or lab filters are missing', async () => {
  const loaded = loadReservationApp();

  try {
    const response = await request(loaded.app).get('/solicitar/consultar');

    assert.equal(response.status, 302);
    assert.match(
      response.headers.location,
      /Debes%20seleccionar%20una%20facultad%20y%20un%20laboratorio/
    );
  } finally {
    loaded.restore();
  }
});

test('prestamos creates an available equipment reservation transactionally', async () => {
  const database = createLoanReservationDatabase();
  const loaded = loadReservationApp(database);

  try {
    const response = await request(loaded.app).post('/solicitudes/crear').send({
      equipo_id: '5',
      fecha_inicio: '2999-12-31T10:00',
      fecha_fin: '2999-12-31T11:00',
      justificacion_academica: 'Practica de laboratorio de ciencias',
      categoria_practica: 'academica',
      firma_digital: 'Acepto el reglamento',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.en_cola, false);
    assert.equal(response.body.solicitud.id, 901);
    assert.equal(database.transactionCalls[0].sql, 'BEGIN');
    assert.ok(
      database.transactionCalls.some(({ sql }) => sql.includes('INSERT INTO solicitud_prestamo'))
    );
    assert.equal(database.transactionCalls.at(-1).sql, 'COMMIT');
    assert.equal(database.isReleased(), true);
    assert.ok(database.poolCalls.some((sql) => sql.includes('FROM horario_equipo')));
  } finally {
    loaded.restore();
  }
});

test('prestamos rolls back a reservation when its database insert fails', async () => {
  const database = createLoanReservationDatabase({ failOnInsert: true });
  const loaded = loadReservationApp(database);

  try {
    const response = await request(loaded.app).post('/solicitudes/crear').send({
      equipo_id: '5',
      fecha_inicio: '2999-12-31T10:00',
      fecha_fin: '2999-12-31T11:00',
      justificacion_academica: 'Practica de laboratorio de ciencias',
      categoria_practica: 'academica',
      firma_digital: 'Acepto el reglamento',
    });

    assert.equal(response.status, 500);
    assert.equal(response.body.success, false);
    assert.equal(database.transactionCalls[0].sql, 'BEGIN');
    assert.ok(
      database.transactionCalls.some(({ sql }) => sql.includes('ROLLBACK')),
      'a failed insert rolls back the request transaction'
    );
    assert.ok(!database.transactionCalls.some(({ sql }) => sql.includes('COMMIT')));
    assert.equal(database.isReleased(), true);
  } finally {
    loaded.restore();
  }
});

test('prestamos queues a reservation when the selected equipment slot is occupied', async () => {
  const database = createLoanReservationDatabase({ slotBusy: true });
  const loaded = loadReservationApp(database);

  try {
    const response = await request(loaded.app).post('/solicitudes/crear').send({
      equipo_id: '5',
      fecha_inicio: '2999-12-31T10:00',
      fecha_fin: '2999-12-31T11:00',
      justificacion_academica: 'Practica de laboratorio de ciencias',
      categoria_practica: 'academica',
      firma_digital: 'Acepto el reglamento',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.en_cola, true);
    assert.match(response.body.message, /cola de espera/i);
    assert.ok(
      database.transactionCalls.some(({ sql }) => sql.includes('INSERT INTO cola_solicitud'))
    );
    assert.equal(database.transactionCalls.at(-1).sql, 'COMMIT');
    assert.equal(database.isReleased(), true);
  } finally {
    loaded.restore();
  }
});
