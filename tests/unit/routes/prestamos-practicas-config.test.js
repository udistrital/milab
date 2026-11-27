const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { Writable } = require('node:stream');
const { pathToFileURL } = require('node:url');
const express = require('express');
const request = require('supertest');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

const routePath = path.resolve(__dirname, '../../../src/routes/api/prestamos.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const facultyScopePath = path.resolve(__dirname, '../../../src/libs/faculty-scope.js');
const emailNotificationsPath = path.resolve(__dirname, '../../../src/libs/email-notifications.js');
const prestamosModuleAccessPath = path.resolve(
  __dirname,
  '../../../src/libs/prestamos-module-access.js'
);
const authPath = path.resolve(__dirname, '../../../src/routes/middlewares/auth.js');

function loadRoute({
  spreadsheetRows = [],
  dbQuery = async () => ({ rows: [] }),
  pdfDocument = function PDFDocument() {},
} = {}) {
  const originals = new Map();
  const originalLoad = Module._load;
  const stubs = [
    [
      dbPath,
      {
        query: dbQuery,
        connect: async () => ({
          query: async () => ({ rows: [] }),
          release() {},
        }),
      },
    ],
    [
      facultyScopePath,
      {
        canonicalizeFacultyName: (value) => value,
        resolveCoordinatorScope: async () => ({
          coordinatorDocument: null,
          facultyIds: [],
        }),
      },
    ],
    [
      emailNotificationsPath,
      {
        sendEmailNotification: async () => ({ success: true }),
      },
    ],
    [
      prestamosModuleAccessPath,
      {
        getPrestamosModuleAccess: async () => ({
          blocked: false,
          role: null,
          allowedFacultyIds: [],
        }),
      },
    ],
    [
      authPath,
      {
        requirePermissions: () => (req, res, next) => next(),
        requireRoles: () => (req, res, next) => next(),
        renderAuthError: () => null,
      },
    ],
  ];
  const packageStubs = {
    multer: Object.assign(
      function multer() {
        return {
          single() {
            return function (_req, _res, next) {
              next();
            };
          },
        };
      },
      {
        memoryStorage() {
          return {};
        },
      }
    ),
    pdfkit: pdfDocument,
    'pdf-lib': {
      PDFDocument: class {},
      StandardFonts: {},
    },
    qrcode: {
      toDataURL: async () => 'data:image/png;base64,stub',
      toBuffer: async () => Buffer.from('stub'),
    },
    xlsx: {
      read: () =>
        spreadsheetRows.length
          ? { SheetNames: ['Guide'], Sheets: { Guide: {} } }
          : { SheetNames: [], Sheets: {} },
      write: () => Buffer.from(''),
      utils: {
        sheet_to_json: () => spreadsheetRows,
        aoa_to_sheet: () => ({}),
        book_new: () => ({}),
        book_append_sheet: () => {},
      },
    },
  };

  delete require.cache[routePath];

  Module._load = function patchedLoader(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(packageStubs, request)) {
      return packageStubs[request];
    }

    return originalLoad.call(this, request, parent, isMain);
  };

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
      Module._load = originalLoad;

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

function buildApp(route, sessionUser = null) {
  const app = express();

  app.use((req, res, next) => {
    req.session = { user: sessionUser };
    res.render = (view, locals) => res.status(res.statusCode || 200).json({ view, locals });
    next();
  });
  app.use('/', route);

  return app;
}

function loadRouteWithAccess(access) {
  const originals = new Map();
  const originalLoad = Module._load;
  const stubs = [
    [
      dbPath,
      {
        query: async () => ({ rows: [] }),
        connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
      },
    ],
    [
      facultyScopePath,
      {
        canonicalizeFacultyName: (value) => value,
        resolveCoordinatorScope: async () => ({ coordinatorDocument: null, facultyIds: [] }),
      },
    ],
    [emailNotificationsPath, { sendEmailNotification: async () => ({ success: true }) }],
    [prestamosModuleAccessPath, { getPrestamosModuleAccess: async () => access }],
    [
      authPath,
      {
        requirePermissions: () => (req, res, next) => next(),
        requireRoles: () => (req, res, next) => next(),
        renderAuthError: (res, payload) => res.status(403).json({ authError: true, payload }),
      },
    ],
  ];
  const packageStubs = {
    multer: Object.assign(
      function multer() {
        return {
          single() {
            return function (_req, _res, next) {
              next();
            };
          },
        };
      },
      {
        memoryStorage() {
          return {};
        },
      }
    ),
    pdfkit: function PDFDocument() {},
    'pdf-lib': { PDFDocument: class {}, StandardFonts: {} },
    qrcode: {
      toDataURL: async () => 'data:image/png;base64,stub',
      toBuffer: async () => Buffer.from('stub'),
    },
    xlsx: {
      read: () => ({ SheetNames: [], Sheets: {} }),
      write: () => Buffer.from(''),
      utils: {
        sheet_to_json: () => [],
        aoa_to_sheet: () => ({}),
        book_new: () => ({}),
        book_append_sheet: () => {},
      },
    },
  };

  delete require.cache[routePath];
  Module._load = function patchedLoader(requestName, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(packageStubs, requestName)) {
      return packageStubs[requestName];
    }

    return originalLoad.call(this, requestName, parent, isMain);
  };

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
      Module._load = originalLoad;
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

test('prestamos expone helpers privados para configuracion dinamica de practicas', () => {
  const loaded = loadRoute();

  try {
    assert.equal(typeof loaded.route.__private.buildPracticeReservationPayload, 'function');
    assert.equal(typeof loaded.route.__private.validatePracticeReservationPayload, 'function');
    assert.equal(typeof loaded.route.__private.normalizeDynamicPracticeSchema, 'function');
    assert.equal(typeof loaded.route.__private.validateDynamicPracticeSchema, 'function');
    assert.equal(typeof loaded.route.__private.validateAcademicPracticePayload, 'function');
    assert.equal(typeof loaded.route.__private.validateLoanRequestPayload, 'function');
    assert.equal(typeof loaded.route.__private.evaluateLoanModeConstraints, 'function');
    assert.equal(typeof loaded.route.__private.buildLoanJustificationWithMode, 'function');
    assert.equal(typeof loaded.route.__private.parseLoanModeAndJustification, 'function');
    assert.equal(typeof loaded.route.__private.resolveLoanModeLabel, 'function');
    assert.equal(typeof loaded.route.__private.normalizeLoanRecordForDisplay, 'function');
    assert.equal(typeof loaded.route.__private.normalizeScheduleDayValue, 'function');
    assert.equal(typeof loaded.route.__private.normalizeScheduleDateValue, 'function');
    assert.equal(typeof loaded.route.__private.normalizeScheduleTimeValue, 'function');
    assert.equal(typeof loaded.route.__private.hasSalaScheduleOverlap, 'function');
  } finally {
    loaded.restore();
  }
});

test('prestamos normaliza el esquema dinamico y genera llaves limpias', () => {
  const loaded = loadRoute();

  try {
    const schema = loaded.route.__private.normalizeDynamicPracticeSchema({
      campos_adicionales: [
        {
          nombre: 'Voltaje utilizado',
          tipo: 'number',
          obligatorio: true,
        },
        {
          nombre: 'Tipo de muestra',
          tipo: 'select',
          valores: ['Suelo', 'Agua'],
        },
      ],
    });

    assert.deepEqual(schema, {
      campos_adicionales: [
        {
          key: 'voltaje_utilizado',
          nombre: 'Voltaje utilizado',
          tipo: 'number',
          obligatorio: true,
          ayuda: null,
          placeholder: null,
          valores: [],
        },
        {
          key: 'tipo_de_muestra',
          nombre: 'Tipo de muestra',
          tipo: 'select',
          obligatorio: false,
          ayuda: null,
          placeholder: null,
          valores: ['Suelo', 'Agua'],
        },
      ],
    });
  } finally {
    loaded.restore();
  }
});

test('prestamos valida que una practica academica cumpla asignaturas y campos dinamicos requeridos', () => {
  const loaded = loadRoute();

  try {
    const schema = {
      campos_adicionales: [
        {
          key: 'voltaje_utilizado',
          nombre: 'Voltaje utilizado',
          tipo: 'number',
          obligatorio: true,
          valores: [],
        },
      ],
    };

    const invalidMessage = loaded.route.__private.validateAcademicPracticePayload(
      {
        ual_id: '10',
        nombre: 'Microscopia basica',
        tipo_practica: 'Experimental',
        estado: 'activa',
        asignaturas: [{ codigo: 'BIO101', nombre: 'Biologia General' }],
        documentos: [],
        duracion: '120',
        configuracion_dinamica: {},
      },
      schema
    );

    const validMessage = loaded.route.__private.validateAcademicPracticePayload(
      {
        ual_id: '10',
        nombre: 'Microscopia basica',
        tipo_practica: 'Experimental',
        estado: 'activa',
        asignaturas: [{ codigo: 'BIO101', nombre: 'Biologia General' }],
        documentos: [],
        duracion: '120',
        configuracion_dinamica: { voltaje_utilizado: 220 },
      },
      schema
    );

    assert.equal(invalidMessage, 'El campo dinamico "Voltaje utilizado" es obligatorio.');
    assert.equal(validMessage, '');
  } finally {
    loaded.restore();
  }
});

test('prestamos exige practica y asignatura configuradas para practicas docentes academicas', () => {
  const loaded = loadRoute();

  try {
    const payload = loaded.route.__private.buildPracticeReservationPayload({
      facultad: 'Ingenieria',
      laboratorio: 'Fisica',
      salaId: '8',
      fechaInicio: '2099-01-10T08:00',
      fechaFin: '2099-01-10T10:00',
      tipo_practica: 'docente',
      categoria_practica: 'academica',
      justificacion: 'Solicitud de practica academica para laboratorio.',
      firma_digital: 'firma-valida',
    });

    const missingPracticeMessage =
      loaded.route.__private.validatePracticeReservationPayload(payload);
    const validMessage = loaded.route.__private.validatePracticeReservationPayload({
      ...payload,
      practica_id: '15',
      asignatura_codigo: 'FIS101',
    });

    assert.equal(missingPracticeMessage, 'Debes seleccionar una practica academica configurada.');
    assert.equal(validMessage, '');
  } finally {
    loaded.restore();
  }
});

test('prestamos renders role-aware dashboards at root', async () => {
  const loaded = loadRouteWithAccess({ blocked: false, role: null, allowedFacultyIds: [] });
  const roles = ['estudiante', 'docente', 'monitor', 'coordinador', 'admin'];

  try {
    for (const role of roles) {
      const app = buildApp(loaded.route, { tipo: role, roles: [role] });
      const response = await request(app).get('/');
      assert.equal(response.status, 200, `status 200 para rol ${role}`);
      const payload = JSON.parse(response.text);
      assert.equal(
        payload.view,
        'home/prestamos/dashboard',
        `renderiza dashboard.ejs para rol ${role}`
      );
      assert.ok(Array.isArray(payload.locals.moduleCards), `moduleCards es array para rol ${role}`);
      assert.ok(Array.isArray(payload.locals.quickLinks), `quickLinks es array para rol ${role}`);
      assert.ok(
        typeof payload.locals.stats === 'object' && payload.locals.stats !== null,
        `stats es objeto para rol ${role}`
      );
    }

    const laboratoristaApp = buildApp(loaded.route, {
      tipo: 'laboratorista',
      roles: ['laboratorista'],
    });
    const laboratoristaResponse = await request(laboratoristaApp).get('/');
    assert.equal(laboratoristaResponse.status, 200);
    const laboratoristaPayload = JSON.parse(laboratoristaResponse.text);
    assert.equal(laboratoristaPayload.view, 'home/prestamos/dashboard_laboratorista');
    assert.ok(Array.isArray(laboratoristaPayload.locals.laboratorios));
    assert.ok(Array.isArray(laboratoristaPayload.locals.eventsByDay));
    assert.ok(Array.isArray(laboratoristaPayload.locals.pendingRequests));
  } finally {
    loaded.restore();
  }
});

test('prestamos blocks disabled module access with html response for GET requests', async () => {
  const loaded = loadRouteWithAccess({
    blocked: true,
    role: 'coordinador',
    allowedFacultyIds: [],
    facultyIds: [10],
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'coordinador', documento: '900' });
    const response = await request(app).get('/reportes');

    assert.equal(response.status, 403);
    assert.equal(response.body.authError, true);
    assert.match(response.body.payload.message2, /Prestamos esta deshabilitado/i);
  } finally {
    loaded.restore();
  }
});

test('prestamos blocks disabled module access with json response for POST requests', async () => {
  const loaded = loadRouteWithAccess({
    blocked: true,
    role: 'monitor',
    allowedFacultyIds: [],
    facultyIds: [10],
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'monitor', documento: '900' });
    const response = await request(app).post('/solicitudes/crear').send({});

    assert.equal(response.status, 403);
    assert.deepEqual(response.body, {
      success: false,
      message: 'El modulo de Prestamos esta deshabilitado para tu facultad.',
    });
  } finally {
    loaded.restore();
  }
});

test('prestamos rejects a loan request without an equipment selection', async () => {
  const loaded = loadRouteWithAccess({
    blocked: false,
    role: 'estudiante',
    allowedFacultyIds: [],
  });

  try {
    const app = buildApp(loaded.route, {
      tipo: 'estudiante',
      roles: ['estudiante'],
      id: 22,
      documento: '20241001',
    });
    const response = await request(app).post('/solicitudes/crear').send({});

    assert.equal(response.status, 400);
    assert.deepEqual(response.body, {
      success: false,
      message: 'El equipo seleccionado no es valido.',
    });
  } finally {
    loaded.restore();
  }
});

test('prestamos valida reglas de tiempo para solicitud de practica libre', () => {
  const loaded = loadRoute();

  try {
    const message = loaded.route.__private.validateLoanRequestPayload({
      equipo_id: '15',
      fecha_inicio: '2020-01-01T08:00',
      fecha_fin: '2020-01-01T10:00',
      tipo_prestamo: 'libre',
      justificacion_academica: 'Solicitud de practica libre para pruebas.',
      categoria_practica: 'academica',
      firma_digital: 'firma-ok',
    });

    assert.equal(
      message,
      'La fecha de inicio debe ser posterior a la fecha actual para prestamos de practica libre.'
    );
  } finally {
    loaded.restore();
  }
});

test('prestamos valida reglas de ventana para modalidad clase', () => {
  const loaded = loadRoute();

  try {
    const lateMessage = loaded.route.__private.evaluateLoanModeConstraints({
      payload: {
        tipo_prestamo: 'clase',
        fecha_fin: '2025-01-10T09:40',
      },
      selectedSlot: {
        fecha: '2025-01-10',
        horaInicio: '09:00',
        horaFin: '10:00',
      },
      now: new Date('2025-01-10T14:20:00.000Z'),
    });

    const returnMessage = loaded.route.__private.evaluateLoanModeConstraints({
      payload: {
        tipo_prestamo: 'clase',
        fecha_fin: '2025-01-10T09:50',
      },
      selectedSlot: {
        fecha: '2025-01-10',
        horaInicio: '09:00',
        horaFin: '10:00',
      },
      now: new Date('2025-01-10T13:55:00.000Z'),
    });

    assert.match(lateMessage, /hasta 15 minutos despues de iniciada la clase/);
    assert.match(returnMessage, /devolucion maxima es 15 minutos antes/);
  } finally {
    loaded.restore();
  }
});

test('prestamos guarda y recupera modalidad en justificacion sin exponer marcador', () => {
  const loaded = loadRoute();

  try {
    const persisted = loaded.route.__private.buildLoanJustificationWithMode(
      'Solicitud de uso para clase de laboratorio.',
      'clase'
    );
    const parsed = loaded.route.__private.parseLoanModeAndJustification(persisted);

    assert.equal(persisted.startsWith('[modo:clase]'), true);
    assert.equal(parsed.tipo_prestamo, 'clase');
    assert.equal(parsed.justificacion_academica, 'Solicitud de uso para clase de laboratorio.');
  } finally {
    loaded.restore();
  }
});

test('prestamos normaliza registros de solicitud para mostrar modalidad y justificacion limpia', () => {
  const loaded = loadRoute();

  try {
    const normalized = loaded.route.__private.normalizeLoanRecordForDisplay({
      id: 77,
      justificacion_academica: '[modo:clase] Uso del equipo en sesion guiada de clase.',
    });

    assert.equal(normalized.tipo_prestamo, 'clase');
    assert.equal(normalized.tipo_prestamo_label, 'Prestamo en clase');
    assert.equal(normalized.justificacion_academica, 'Uso del equipo en sesion guiada de clase.');
  } finally {
    loaded.restore();
  }
});

test('prestamos normaliza valores de horario para carga desde excel', () => {
  const loaded = loadRoute();

  try {
    assert.equal(loaded.route.__private.normalizeScheduleDayValue('Miércoles'), '3');
    assert.equal(loaded.route.__private.normalizeScheduleDateValue('24/11/2026'), '2026-11-24');
    assert.equal(loaded.route.__private.normalizeScheduleTimeValue('8:05'), '08:05');
  } finally {
    loaded.restore();
  }
});

test('prestamos importa filas del excel guia sin columnas opcionales', () => {
  const loaded = loadRoute({
    spreadsheetRows: [
      {
        Periodo: 'PERIODO DE EJEMPLO',
        Día: 'LUNES',
        Hora: '6PM-7PM',
        Asignatura: '00000 - ASIGNATURA DE EJEMPLO',
        Grupo: '000-000',
        Proyecto: '000 - PROGRAMA ACADEMICO DE EJEMPLO',
        Inscritos: 10,
        Docente: 'DOCENTE DE EJEMPLO',
      },
    ],
  });

  try {
    const parsed = loaded.route.__private.parseSalaScheduleSpreadsheet(Buffer.from('xlsx'), {
      expectedSalaName: 'LABORATORIO DE EJEMPLO',
    });

    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0].tipo_practica, 'docente');
    assert.equal(parsed.rows[0].sala, '');
    assert.equal(parsed.rows[0].hora_inicio, '18:00');
    assert.equal(parsed.rows[0].hora_fin, '19:00');
    assert.equal(parsed.rows[0].activo, true);
    assert.equal(parsed.rows[0].asignatura, '00000 - ASIGNATURA DE EJEMPLO');
    assert.equal(parsed.rows[0].docente, 'DOCENTE DE EJEMPLO');
  } finally {
    loaded.restore();
  }
});

test('prestamos guarda asignatura y docente del horario solo cuando la tabla los soporta', async () => {
  function buildClient(detailColumnCount) {
    const inserts = [];
    return {
      inserts,
      query: async (query, parameters) => {
        if (query.includes("column_name IN ('asignatura', 'docente')")) {
          return { rows: [{ total: detailColumnCount }] };
        }
        if (query.includes('INSERT INTO horario_sala')) {
          inserts.push({ query, parameters });
        }
        return { rows: [] };
      },
    };
  }

  const teacherRow = {
    fecha: '2026-11-30',
    hora_inicio: '18:00',
    hora_fin: '19:00',
    tipo_practica: 'docente',
    asignatura: '  24908 - ROBOTICA  ',
    docente: `DOCENTE ${'X'.repeat(300)}`,
  };

  const legacy = loadRoute();
  try {
    const client = buildClient(0);
    await legacy.route.__private.insertSalaSchedule(client, 10, teacherRow);

    assert.equal(client.inserts.length, 1);
    assert.doesNotMatch(client.inserts[0].query, /asignatura|docente/);
    assert.equal(client.inserts[0].parameters.length, 9);
  } finally {
    legacy.restore();
  }

  const migrated = loadRoute();
  try {
    const client = buildClient(2);
    await migrated.route.__private.insertSalaSchedule(client, 10, teacherRow);
    await migrated.route.__private.insertSalaSchedule(client, 10, {
      ...teacherRow,
      hora_inicio: '19:00',
      hora_fin: '20:00',
      tipo_practica: 'libre',
    });

    assert.match(client.inserts[0].query, /asignatura, docente/);
    assert.equal(client.inserts[0].parameters.at(-2), '24908 - ROBOTICA');
    assert.equal(client.inserts[0].parameters.at(-1).length, 255);
    assert.deepEqual(client.inserts[1].parameters.slice(-2), [null, null]);
  } finally {
    migrated.restore();
  }
});

test('prestamos permite editar un horario desde la sala y limpia modalidad docente', async () => {
  let updateParameters = null;
  const loaded = loadRoute({
    dbQuery: async (query, parameters) => {
      if (query.includes('FROM sala s')) {
        return { rows: [{ id: 10, nombre: 'Sala de ejemplo' }] };
      }
      if (query.includes('FROM horario_sala h')) {
        return {
          rows: [
            {
              id: 50,
              sala_id: 10,
              fecha: '2026-11-30',
              dia_semana: null,
              hora_inicio: '08:00',
              hora_fin: '09:00',
            },
          ],
        };
      }
      if (query.includes('FROM reserva_practica rp')) {
        return { rows: [] };
      }
      if (query.includes('UPDATE horario_sala')) {
        updateParameters = parameters;
        return { rows: [{ id: 50 }] };
      }
      return { rows: [] };
    },
  });

  try {
    const response = await request(buildApp(loaded.route, { roles: ['admin'] }))
      .put('/salas/10/horarios/50')
      .send({
        fecha: '2026-11-30',
        hora_inicio: '09:00',
        hora_fin: '10:00',
        tipo_practica: 'docente',
        modalidad_libre: 'uno_a_uno',
        activo: 'true',
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(updateParameters[8], null);
  } finally {
    loaded.restore();
  }
});

test('prestamos genera una plantilla de horarios si el archivo de pruebas no esta desplegado', () => {
  const loaded = loadRoute();

  try {
    const template = loaded.route.__private.buildSalaScheduleTemplateBuffer(
      path.join(__dirname, 'plantilla-horarios-inexistente.xlsx')
    );

    assert.equal(Buffer.isBuffer(template), true);
  } finally {
    loaded.restore();
  }
});

test('prestamos detecta solapes de horarios en el mismo contexto', () => {
  const loaded = loadRoute();

  try {
    const overlap = loaded.route.__private.hasSalaScheduleOverlap(
      {
        dia_semana: '1',
        fecha: '',
        hora_inicio: '08:00',
        hora_fin: '10:00',
      },
      {
        dia_semana: '1',
        fecha: '',
        hora_inicio: '09:30',
        hora_fin: '11:00',
      }
    );
    const noOverlap = loaded.route.__private.hasSalaScheduleOverlap(
      {
        dia_semana: '1',
        fecha: '',
        hora_inicio: '08:00',
        hora_fin: '10:00',
      },
      {
        dia_semana: '2',
        fecha: '',
        hora_inicio: '09:30',
        hora_fin: '11:00',
      }
    );

    assert.equal(overlap, true);
    assert.equal(noOverlap, false);
  } finally {
    loaded.restore();
  }
});

test('prestamos aplica la modalidad elegida a los espacios libres seleccionados', () => {
  const loaded = loadRoute();

  try {
    const rows = loaded.route.__private.buildFreePracticeRowsFromSlotSelection(
      ['1|14:00|15:00'],
      {
        start: new Date(Date.UTC(2026, 10, 2)),
        end: new Date(Date.UTC(2026, 10, 8)),
      },
      'uno_a_varios'
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].modalidad_libre, 'uno_a_varios');
    assert.equal(rows[0].activo, true);
  } finally {
    loaded.restore();
  }
});

test('prestamos requiere lunes de inicio y domingo de fin en la carga de horarios', () => {
  const loaded = loadRoute();
  const today = '2026-11-02';

  try {
    const invalidStart = loaded.route.__private.validateSalaScheduleDateRange(
      {
        fecha_inicio: '2026-11-03',
        fecha_fin: '2026-11-08',
      },
      today
    );
    const invalidEnd = loaded.route.__private.validateSalaScheduleDateRange(
      {
        fecha_inicio: '2026-11-02',
        fecha_fin: '2026-11-07',
      },
      today
    );
    const reversed = loaded.route.__private.validateSalaScheduleDateRange(
      {
        fecha_inicio: '2026-11-02',
        fecha_fin: '2026-10-25',
      },
      today
    );
    const validWeek = loaded.route.__private.validateSalaScheduleDateRange(
      {
        fecha_inicio: '2026-11-02',
        fecha_fin: '2026-11-08',
      },
      today
    );
    const pastStart = loaded.route.__private.validateSalaScheduleDateRange(
      {
        fecha_inicio: '2026-10-26',
        fecha_fin: '2026-11-01',
      },
      today
    );
    const tooLong = loaded.route.__private.validateSalaScheduleDateRange(
      {
        fecha_inicio: '2026-11-02',
        fecha_fin: '2027-05-09',
      },
      today
    );

    assert.equal(invalidStart.valid, false);
    assert.match(invalidStart.message, /lunes/i);
    assert.equal(invalidEnd.valid, false);
    assert.match(invalidEnd.message, /domingo/i);
    assert.equal(reversed.valid, false);
    assert.match(reversed.message, /anterior/i);
    assert.equal(pastStart.valid, false);
    assert.match(pastStart.message, /fecha actual/i);
    assert.equal(validWeek.valid, true);
    assert.equal(tooLong.valid, false);
    assert.match(tooLong.message, /seis meses/i);
  } finally {
    loaded.restore();
  }
});

test('prestamos exige informacion UAL antes de habilitar carga de horario', () => {
  const loaded = loadRoute();

  try {
    const laboratory = loaded.route.__private.buildLaboratoryActivationModel({
      ual_id: 21,
      laboratorio: 'Lab sin UAL',
      facultad: 'Ingenieria',
      estado_oficial: 'aprobado',
      oficial_sin_inventario: false,
      estado_complementario: 'aprobado',
      complementario_sin_inventario: false,
      estado_reactivo: '',
      reactivo_sin_inventario: false,
      total_salas_activas: 0,
      total_horarios_activos: 8,
      total_equipos_listos: 3,
      ual_tiene_bancos: false,
      ual_cantidad_bancos: 0,
    });
    const checklist = loaded.route.__private.buildLoanActivationChecklist(laboratory);
    const horarioItem = checklist.find((item) => item.key === 'carga_horario');

    assert.equal(laboratory.checklist.horarioLaboratorio, false);
    assert.equal(Boolean(horarioItem?.ready), false);
    assert.equal(horarioItem?.actionHref || '', '');
    assert.match(horarioItem?.pendingDetail || '', /información de la UAL/i);
  } finally {
    loaded.restore();
  }
});

test('prestamos clasifica estado de activacion de inventario', () => {
  const loaded = loadRoute();

  try {
    assert.deepEqual(
      loaded.route.__private.resolveInventoryActivationStatus('aprobado', true, false),
      { key: 'aprobado_sin_inventario', label: 'Aprobado sin inventario', ready: true }
    );
    assert.deepEqual(loaded.route.__private.resolveInventoryActivationStatus('', false, true), {
      key: 'opcional',
      label: 'Opcional',
      ready: true,
    });
    assert.deepEqual(
      loaded.route.__private.resolveInventoryActivationStatus('devuelta', false, false),
      { key: 'devuelta', label: 'Devuelta para correccion', ready: false }
    );
  } finally {
    loaded.restore();
  }
});

test('prestamos busca columnas en el esquema activo de la conexion', async () => {
  const loaded = loadRoute();

  try {
    let queries = 0;
    const client = {
      query: async (sql, params) => {
        queries += 1;
        assert.match(sql, /table_schema = current_schema\(\)/);
        assert.deepEqual(params, ['prestamo_activacion_laboratorio']);
        return {
          rows:
            queries === 1
              ? []
              : [{ column_name: 'estado_activacion' }, { column_name: 'configuracion_json' }],
        };
      },
    };

    const missingColumns = await loaded.route.__private.fetchTableColumns(
      'prestamo_activacion_laboratorio',
      client
    );
    const availableColumns = await loaded.route.__private.fetchTableColumns(
      'prestamo_activacion_laboratorio',
      client
    );

    assert.equal(missingColumns.size, 0);
    assert.equal(availableColumns.has('estado_activacion'), true);
    assert.equal(queries, 2);
  } finally {
    loaded.restore();
  }
});

test('prestamos modela el progreso de activacion por laboratorio', () => {
  const loaded = loadRoute();

  try {
    const model = loaded.route.__private.buildLaboratoryActivationModel({
      ual_id: 7,
      laboratorio: 'Lab de Redes',
      facultad: 'Ingenieria',
      estado_oficial: 'aprobado',
      oficial_sin_inventario: false,
      estado_complementario: 'aprobado',
      complementario_sin_inventario: false,
      estado_reactivo: '',
      reactivo_sin_inventario: false,
      total_salas_activas: 1,
      total_horarios_activos: 2,
      total_equipos_listos: 5,
      ual_tiene_bancos: false,
      ual_cantidad_bancos: 0,
      activacion_configuracion_json: { tiene_practicas: false },
    });

    assert.equal(model.canActivateLoans, true);
    assert.equal(model.completion.percent, 100);
    assert.equal(model.nextStep.href, '/milab/prestamos/activacion/laboratorios/7');
    assert.equal(model.inventory.reactivo.key, 'opcional');
  } finally {
    loaded.restore();
  }
});

test('prestamos requiere una practica activa solo cuando el laboratorio eligio ofrecerlas', () => {
  const loaded = loadRoute();

  try {
    const row = {
      ual_id: 12,
      estado_oficial: 'aprobado',
      estado_complementario: 'aprobado',
      total_salas_activas: 1,
      total_horarios_activos: 1,
      total_equipos_listos: 1,
      ual_tiene_bancos: false,
      ual_cantidad_bancos: 0,
    };
    const needsChoice = loaded.route.__private.buildLaboratoryActivationModel(row);
    const optedOut = loaded.route.__private.buildLaboratoryActivationModel({
      ...row,
      activacion_configuracion_json: { tiene_practicas: false },
    });
    const missingPractice = loaded.route.__private.buildLaboratoryActivationModel({
      ...row,
      activacion_configuracion_json: { tiene_practicas: true },
    });
    const configuredPractice = loaded.route.__private.buildLaboratoryActivationModel({
      ...row,
      activacion_configuracion_json: { tiene_practicas: true },
      total_practicas_activas: 1,
    });

    assert.equal(needsChoice.canActivateLoans, false);
    assert.equal(optedOut.canActivateLoans, true);
    assert.equal(missingPractice.canActivateLoans, false);
    assert.equal(configuredPractice.canActivateLoans, true);
  } finally {
    loaded.restore();
  }
});

test('prestamos arma wizard de activacion con bloqueos secuenciales', () => {
  const loaded = loadRoute();

  try {
    const laboratory = loaded.route.__private.buildLaboratoryActivationModel({
      ual_id: 9,
      laboratorio: 'Lab de Quimica',
      facultad: 'Ciencias',
      estado_oficial: 'pendiente',
      oficial_sin_inventario: false,
      estado_complementario: 'pendiente',
      complementario_sin_inventario: false,
      estado_reactivo: '',
      reactivo_sin_inventario: false,
      total_salas_activas: 0,
      total_horarios_activos: 0,
      total_equipos_listos: 0,
    });
    const steps = loaded.route.__private.buildActivationWizardSteps(laboratory);

    assert.equal(steps.length, 4);
    assert.equal(steps[0].blocked, false);
    assert.equal(steps[1].blocked, true);
    assert.equal(steps[3].blocked, true);
  } finally {
    loaded.restore();
  }
});

test('prestamos arma checklist de activacion y resume pendientes', () => {
  const loaded = loadRoute();

  try {
    const laboratory = loaded.route.__private.buildLaboratoryActivationModel({
      ual_id: 11,
      laboratorio: 'Lab de Electronica',
      facultad: 'Tecnologica',
      estado_oficial: 'aprobado',
      oficial_sin_inventario: false,
      estado_complementario: 'pendiente',
      complementario_sin_inventario: false,
      estado_reactivo: '',
      reactivo_sin_inventario: false,
      total_salas_activas: 0,
      total_horarios_activos: 0,
      total_equipos_listos: 2,
    });
    const checklist = loaded.route.__private.buildLoanActivationChecklist(laboratory);
    const missing = loaded.route.__private.summarizeMissingActivationChecks(checklist);

    assert.equal(checklist.length, 7);
    assert.equal(checklist[0].ready, true);
    assert.equal(checklist[1].ready, false);
    assert.equal(checklist[0].label, 'Inventario de equipos');
    assert.equal(checklist[4].label, 'Información de la UAL');
    assert.equal(checklist[5].label, 'Horario de laboratorio');
    assert.equal(checklist[6].label, 'Prácticas del laboratorio');
    assert.match(missing, /Inventario complementario/);
    assert.match(missing, /Información de la UAL/);
    assert.match(missing, /Horario de laboratorio/);
    assert.match(missing, /Prácticas del laboratorio/);
  } finally {
    loaded.restore();
  }
});

test('prestamos valida el laboratorio del wizard de activacion', async () => {
  const loaded = loadRouteWithAccess({
    blocked: false,
    role: 'laboratorista',
    allowedFacultyIds: [],
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'laboratorista', documento: '900' });
    const response = await request(app).get('/activacion/laboratorios/abc');

    assert.equal(response.status, 302);
    assert.match(response.headers.location, /activacion\/laboratorios\?error=/);
  } finally {
    loaded.restore();
  }
});

test('prestamos valida el laboratorio al intentar activar prestamos', async () => {
  const loaded = loadRouteWithAccess({
    blocked: false,
    role: 'laboratorista',
    allowedFacultyIds: [],
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'laboratorista', documento: '900' });
    const response = await request(app).post('/activacion/laboratorios/0/activar-prestamos');

    assert.equal(response.status, 302);
    assert.match(response.headers.location, /activacion\/laboratorios\?error=/);
  } finally {
    loaded.restore();
  }
});

test('prestamos valida el laboratorio al abrir poster by request', async () => {
  const loaded = loadRouteWithAccess({
    blocked: false,
    role: 'laboratorista',
    allowedFacultyIds: [],
  });

  try {
    const app = buildApp(loaded.route, { tipo: 'laboratorista', documento: '900' });
    const response = await request(app).get('/activacion/laboratorios/0/by-request');

    assert.equal(response.status, 302);
    assert.match(response.headers.location, /activacion\/laboratorios\?error=/);
  } finally {
    loaded.restore();
  }
});

test('prestamos genera PDFs QR A4 en ambas orientaciones sin imprimir la URL', async () => {
  const loaded = loadRoute({ pdfDocument: PDFDocument });

  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const standardFontDataUrl = pathToFileURL(
      `${path.resolve(__dirname, '../../../node_modules/pdfjs-dist/standard_fonts')}${path.sep}`
    ).href;
    const qrUrl = 'https://labs.udistrital.edu.co/milab/prestamos/practicas/solicitar?ual_id=71';
    const qrBuffer = await QRCode.toBuffer(qrUrl, {
      errorCorrectionLevel: 'H',
      margin: 1,
      width: 1200,
    });
    const laboratory = {
      ualId: 71,
      laboratorio: 'Laboratorio Nacional de Ensayos de Materiales y Productos de Ingeniería',
      dependencia: 'Facultad Tecnológica',
      facultad: 'Universidad Distrital Francisco José de Caldas',
    };

    for (const orientation of ['portrait', 'landscape']) {
      const chunks = [];
      const response = new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(Buffer.from(chunk));
          callback();
        },
      });
      response.setHeader = () => {};
      const pdfFinished = new Promise((resolve, reject) => {
        response.once('finish', resolve);
        response.once('error', reject);
      });

      loaded.route.__private.sendByRequestPosterPdf(response, laboratory, qrBuffer, {
        orientation,
      });
      await pdfFinished;

      const pdfBuffer = Buffer.concat(chunks);
      const pdf = await pdfjs.getDocument({
        data: new Uint8Array(pdfBuffer),
        standardFontDataUrl,
      }).promise;
      const page = await pdf.getPage(1);
      const { width, height } = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      const visibleText = textContent.items
        .map((item) => item.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      const operatorList = await page.getOperatorList();

      assert.equal(pdf.numPages, 1);
      assert.equal(orientation === 'landscape', width > height);
      assert.ok(Math.abs(width - (orientation === 'landscape' ? 841.89 : 595.28)) < 0.1);
      assert.ok(Math.abs(height - (orientation === 'landscape' ? 595.28 : 841.89)) < 0.1);
      assert.match(visibleText, /Laboratorio Nacional de Ensayos/);
      assert.match(visibleText, /Facultad Tecnológica/);
      assert.match(visibleText, /Facultad: Universidad Distrital/);
      assert.match(visibleText, /Escanea para solicitar préstamos/);
      assert.doesNotMatch(visibleText, /Plantilla QR · Préstamos/);
      assert.doesNotMatch(visibleText, /Comparte este afiche/);
      assert.doesNotMatch(visibleText, /https?:\/\//);
      assert.ok(
        operatorList.fnArray.filter((operator) => operator === pdfjs.OPS.paintImageXObject)
          .length >= 3
      );
      assert.ok(
        textContent.items.every((item) => item.transform[5] > 0 && item.transform[5] < height)
      );
      await pdf.destroy();
    }
  } finally {
    loaded.restore();
  }
});
