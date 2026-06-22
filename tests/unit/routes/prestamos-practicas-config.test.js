const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

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

test('prestamos expone helpers privados para configuracion dinamica de practicas', () => {
  const loaded = loadRoute();

  try {
    assert.equal(typeof loaded.route.__private.buildPracticeReservationPayload, 'function');
    assert.equal(typeof loaded.route.__private.validatePracticeReservationPayload, 'function');
    assert.equal(typeof loaded.route.__private.normalizeDynamicPracticeSchema, 'function');
    assert.equal(typeof loaded.route.__private.validateDynamicPracticeSchema, 'function');
    assert.equal(typeof loaded.route.__private.validateAcademicPracticePayload, 'function');
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
