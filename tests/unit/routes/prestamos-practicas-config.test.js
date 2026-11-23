const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/prestamos.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const facultyScopePath = path.resolve(__dirname, '../../../src/libs/faculty-scope.js');
const emailNotificationsPath = path.resolve(__dirname, '../../../src/libs/email-notifications.js');
const prestamosModuleAccessPath = path.resolve(
  __dirname,
  '../../../src/libs/prestamos-module-access.js'
);
const authPath = path.resolve(__dirname, '../../../src/routes/middlewares/auth.js');

function loadRoute() {
  const originals = new Map();
  const originalLoad = Module._load;
  const stubs = [
    [
      dbPath,
      {
        query: async () => ({ rows: [] }),
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
    pdfkit: function PDFDocument() {},
    'pdf-lib': {
      PDFDocument: class {},
      StandardFonts: {},
    },
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

test('prestamos renders the dashboard for every role at the module root', async () => {
  const loaded = loadRouteWithAccess({ blocked: false, role: null, allowedFacultyIds: [] });
  const roles = ['estudiante', 'docente', 'monitor', 'laboratorista', 'coordinador', 'admin'];

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
    });

    assert.equal(model.canActivateLoans, true);
    assert.equal(model.completion.percent, 100);
    assert.equal(model.nextStep.href, '/milab/prestamos/coordinador/practicas/config');
    assert.equal(model.inventory.reactivo.key, 'opcional');
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
      total_horarios_activos: 3,
      total_equipos_listos: 2,
    });
    const checklist = loaded.route.__private.buildLoanActivationChecklist(laboratory);
    const missing = loaded.route.__private.summarizeMissingActivationChecks(checklist);

    assert.equal(checklist.length, 5);
    assert.equal(checklist[0].ready, true);
    assert.equal(checklist[1].ready, false);
    assert.match(missing, /Inventario complementario aprobado/);
    assert.match(missing, /Salas activas registradas/);
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
    const response = await request(app).get('/activacion/laboratorios/0/activar-prestamos');

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
