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

function loadReservationApp({ queryImpl, transactionClient, user, validateCertificates } = {}) {
  const sessionHarness = createSessionHarness({
    user: createUser({
      tipo: 'estudiante',
      roles: ['estudiante'],
      id: 22,
      documento: '20241001',
      ...user,
    }),
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
        {
          getPrestamosModuleAccess: async () => ({
            blocked: false,
            role: user?.roles?.[0] || user?.tipo || 'estudiante',
          }),
        },
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
          validarCertificacionesParaReserva: async (...args) => validateCertificates?.(...args),
        },
      ],
    ],
    purgePaths: [routePath],
  });
}

function createLoanReservationDatabase({
  failOnInsert = false,
  slotBusy = false,
  activeSanctions = 0,
  maxMonthlyHours = 0,
  usedMonthlyHours = 0,
  scheduleStartTime = '10:00',
  scheduleEndTime = '11:00',
} = {}) {
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
      if (sql.includes('FROM multa')) return { rows: [{ total: activeSanctions }] };
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
              hora_inicio: scheduleStartTime,
              hora_fin: scheduleEndTime,
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
      if (sql.includes('SUM(EXTRACT(EPOCH') && sql.includes('FROM solicitud_prestamo')) {
        return { rows: [{ horas: usedMonthlyHours }] };
      }
      if (sql.includes('FROM parametrizacion')) {
        return { rows: [{ max_horas_mes_prestamos: maxMonthlyHours }] };
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

function createLoanLifecycleDatabase({
  initialLoanState = 'pendiente',
  initialEquipmentState = 'disponible',
  activeIncident = false,
  overlappingRequest = false,
} = {}) {
  const events = [];
  let loanState = initialLoanState;
  let equipmentState = initialEquipmentState;
  let releaseCount = 0;

  function requestRow(includeDeliveryFields = false) {
    return {
      id: 901,
      usuario_id: 22,
      equipo_id: 5,
      fecha_inicio: '2999-12-31T15:00:00Z',
      fecha_fin: '2999-12-31T16:00:00Z',
      justificacion_academica: 'Practica de laboratorio de ciencias',
      categoria_practica: 'academica',
      estado: loanState,
      tipo_aprobacion: 'manual',
      firma_digital: 'Acepto el reglamento',
      equipo_codigo: 'EQ-5',
      equipo_nombre: 'Microscopio',
      laboratorio: 'Lab. Ciencias',
      facultad: 'Facultad de Ciencias',
      facultad_id: 1,
      ...(includeDeliveryFields
        ? {
            equipo_estado: equipmentState,
            incidencia_activa: activeIncident,
            entrega_id: 501,
            fecha_entrega: '2999-12-31T15:00:00Z',
            fecha_devolucion_esperada: '2999-12-31T16:00:00Z',
            condicion_entrega: 'Equipo en buen estado',
          }
        : {}),
    };
  }

  const queryImpl = async (sql) => {
    const normalizedSql = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    events.push({ source: 'pool', sql: normalizedSql });

    if (normalizedSql.includes('from usuario u')) {
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
    if (normalizedSql.includes('from usuario where id = $1')) {
      return {
        rows: [
          {
            id: 22,
            documento: '20241001',
            nombre: 'Estudiante Demo',
            correo: 'estudiante@udistrital.edu.co',
          },
        ],
      };
    }
    return { rows: [] };
  };

  const transactionClient = {
    async query(sql) {
      const normalizedSql = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      events.push({ source: 'transaction', sql: normalizedSql });

      if (normalizedSql === 'begin' || normalizedSql === 'commit' || normalizedSql === 'rollback') {
        return { rows: [] };
      }
      if (normalizedSql.startsWith('select 1 from solicitud_prestamo')) {
        return { rows: overlappingRequest ? [{ exists: 1 }] : [] };
      }
      if (normalizedSql.includes('from solicitud_prestamo sp')) {
        return {
          rows: [requestRow(normalizedSql.includes('from incidencia i'))],
        };
      }
      if (normalizedSql.includes('update solicitud_prestamo')) {
        if (normalizedSql.includes("set estado = 'aprobado'")) loanState = 'aprobado';
        if (normalizedSql.includes("set estado = 'activo'")) loanState = 'activo';
        if (normalizedSql.includes("set estado = 'finalizado'")) loanState = 'finalizado';
        return { rows: [{ id: 901 }] };
      }
      if (normalizedSql.includes('insert into entrega_equipo')) {
        return { rows: [{ id: 501, solicitud_prestamo_id: 901 }] };
      }
      if (normalizedSql.includes('update equipo')) {
        equipmentState = normalizedSql.includes("set estado = 'prestado'")
          ? 'prestado'
          : 'disponible';
        return { rows: [] };
      }
      return { rows: [] };
    },
    release() {
      releaseCount += 1;
    },
  };

  return {
    events,
    getLoanState: () => loanState,
    getEquipmentState: () => equipmentState,
    getReleaseCount: () => releaseCount,
    queryImpl,
    transactionClient,
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

test('prestamos completes the approval, delivery, and return lifecycle transactionally', async () => {
  const database = createLoanLifecycleDatabase();
  const loaded = loadReservationApp({
    queryImpl: database.queryImpl,
    transactionClient: database.transactionClient,
    user: { tipo: 'admin', roles: ['admin'], documento: 'admin-1' },
  });

  try {
    const approval = await request(loaded.app).post('/gestion-solicitudes/901/aprobar').send({});
    assert.equal(approval.status, 200);
    assert.equal(approval.body.success, true);
    assert.equal(database.getLoanState(), 'aprobado');

    const delivery = await request(loaded.app)
      .post('/entrega-equipos/901/marcar-prestado')
      .send({ condicion_entrega: 'Equipo entregado en buen estado' });
    assert.equal(delivery.status, 200);
    assert.equal(delivery.body.success, true);
    assert.equal(database.getLoanState(), 'activo');
    assert.equal(database.getEquipmentState(), 'prestado');

    const returned = await request(loaded.app)
      .post('/entrega-equipos/901/recibir')
      .send({
        condicion_devolucion: 'Equipo recibido en buen estado',
        lista_componentes: ['Cable de poder', 'Manual'],
      });
    assert.equal(returned.status, 200);
    assert.equal(returned.body.success, true);
    assert.equal(database.getLoanState(), 'finalizado');
    assert.equal(database.getEquipmentState(), 'disponible');

    const transactions = database.events
      .filter(
        ({ source, sql }) => source === 'transaction' && (sql === 'begin' || sql === 'commit')
      )
      .map(({ sql }) => sql);
    assert.deepEqual(transactions, ['begin', 'commit', 'begin', 'commit', 'begin', 'commit']);
    assert.equal(database.getReleaseCount(), 3);
  } finally {
    loaded.restore();
  }
});

test('prestamos denies a reservation request when the student has active sanctions', async () => {
  const database = createLoanReservationDatabase({ activeSanctions: 1 });
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

    assert.equal(response.status, 400);
    assert.equal(response.body.success, false);
    assert.match(response.body.message, /sanciones activas/i);
    assert.ok(!database.poolCalls.some((sql) => sql.includes('FROM equipo_catalogo')));
    assert.equal(database.transactionCalls.length, 0);
  } finally {
    loaded.restore();
  }
});

test('prestamos blocks a reservation when required training certifications are pending', async () => {
  const database = createLoanReservationDatabase();
  const loaded = loadReservationApp({
    ...database,
    validateCertificates: async () => {
      const error = new Error('Training is incomplete');
      error.bloqueoCert = {
        tipo: 'pendientes',
        mensaje: 'Debes completar los cursos requeridos.',
        cursos: [{ codigo_curso: 'COURSE-1', nombre_curso: 'Seguridad de laboratorio' }],
        cursos_todos: [{ codigo_curso: 'COURSE-1', nombre_curso: 'Seguridad de laboratorio' }],
      };
      throw error;
    },
  });

  try {
    const response = await request(loaded.app).post('/solicitudes/crear').send({
      equipo_id: '5',
      fecha_inicio: '2999-12-31T10:00',
      fecha_fin: '2999-12-31T11:00',
      justificacion_academica: 'Practica de laboratorio de ciencias',
      categoria_practica: 'academica',
      firma_digital: 'Acepto el reglamento',
    });

    assert.equal(response.status, 403);
    assert.equal(response.body.success, false);
    assert.equal(response.body.bloqueo_cert.tipo, 'pendientes');
    assert.equal(response.body.bloqueo_cert.cursos_pendientes.length, 1);
    assert.equal(database.transactionCalls.length, 0);
    assert.ok(!database.poolCalls.some((sql) => sql.includes('FROM equipo_catalogo')));
  } finally {
    loaded.restore();
  }
});

test('prestamos rejects a reservation that exceeds the monthly loan-hour limit', async () => {
  const database = createLoanReservationDatabase({
    maxMonthlyHours: 2,
    usedMonthlyHours: 2,
  });
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

    assert.equal(response.status, 400);
    assert.match(response.body.message, /limite mensual/i);
    assert.ok(database.poolCalls.some((sql) => sql.includes('SUM(EXTRACT(EPOCH')));
    assert.equal(database.transactionCalls.length, 0);
  } finally {
    loaded.restore();
  }
});

test('prestamos rejects a valid date that does not match an available equipment slot', async () => {
  const database = createLoanReservationDatabase({
    scheduleStartTime: '11:00',
    scheduleEndTime: '12:00',
  });
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

    assert.equal(response.status, 400);
    assert.match(response.body.message, /horario seleccionado no coincide/i);
    assert.ok(database.poolCalls.some((sql) => sql.includes('FROM horario_equipo')));
    assert.equal(database.transactionCalls.length, 0);
  } finally {
    loaded.restore();
  }
});

test('prestamos cannot receive a return while an equipment incident is active', async () => {
  const database = createLoanLifecycleDatabase({
    initialLoanState: 'activo',
    initialEquipmentState: 'mantenimiento',
    activeIncident: true,
  });
  const loaded = loadReservationApp({
    queryImpl: database.queryImpl,
    transactionClient: database.transactionClient,
    user: { tipo: 'admin', roles: ['admin'], documento: 'admin-1' },
  });

  try {
    const response = await request(loaded.app)
      .post('/entrega-equipos/901/recibir')
      .send({ condicion_devolucion: 'Equipo recibido' });

    assert.equal(response.status, 409);
    assert.equal(response.body.success, false);
    assert.match(response.body.message, /incidencia activa/i);
    assert.equal(database.getLoanState(), 'activo');
    assert.equal(database.getEquipmentState(), 'mantenimiento');
    assert.ok(database.events.some(({ sql }) => sql === 'rollback'));
    assert.equal(database.getReleaseCount(), 1);
  } finally {
    loaded.restore();
  }
});

test('prestamos releases the approval connection when an overlapping request blocks approval', async () => {
  const database = createLoanLifecycleDatabase({ overlappingRequest: true });
  const loaded = loadReservationApp({
    queryImpl: database.queryImpl,
    transactionClient: database.transactionClient,
    user: { tipo: 'admin', roles: ['admin'], documento: 'admin-1' },
  });

  try {
    const response = await request(loaded.app).post('/gestion-solicitudes/901/aprobar').send({});

    assert.equal(response.status, 409);
    assert.match(response.body.message, /otra solicitud aprobada o activa/i);
    assert.equal(database.getReleaseCount(), 1);
    assert.equal(
      database.events.some(({ source, sql }) => source === 'transaction' && sql === 'begin'),
      false
    );
  } finally {
    loaded.restore();
  }
});

test('prestamos releases the rejection connection when a request was already processed', async () => {
  const database = createLoanLifecycleDatabase({ initialLoanState: 'finalizado' });
  const loaded = loadReservationApp({
    queryImpl: database.queryImpl,
    transactionClient: database.transactionClient,
    user: { tipo: 'admin', roles: ['admin'], documento: 'admin-1' },
  });

  try {
    const response = await request(loaded.app)
      .post('/gestion-solicitudes/901/rechazar')
      .send({ motivo_rechazo: 'Ya se resolvió' });

    assert.equal(response.status, 409);
    assert.match(response.body.message, /ya fue procesada/i);
    assert.equal(database.getReleaseCount(), 1);
    assert.equal(
      database.events.some(({ source, sql }) => source === 'transaction' && sql === 'begin'),
      false
    );
  } finally {
    loaded.restore();
  }
});
