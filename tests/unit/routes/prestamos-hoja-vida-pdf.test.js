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

// Carga el router de prestamos con un pool simulado que responde a las
// consultas de la hoja de vida, la fotografia y los mantenimientos. A
// diferencia de otros tests, NO se stubea pdfkit: se valida el renderizado real.
function loadRoute() {
  const originals = new Map();
  const originalLoad = Module._load;

  const smartPool = {
    query: async (sql) => {
      if (sql.includes('FROM hoja_vida hv')) {
        return {
          rows: [
            {
              id: 42,
              equipo_id: 7,
              codigo_inventario: 'INV-001',
              nombre_equipo: 'Equipo Demo',
              activo: true,
              equipo_codigo: 'EQ-01',
              equipo_nombre: 'Equipo Demo',
              equipo_ubicacion: 'Lab 11',
              equipo_laboratorio: 'Lab',
            },
          ],
        };
      }
      if (sql.includes('FOTOGRAFIA_EQUIPO')) {
        return { rows: [] };
      }
      if (sql.includes('FROM mantenimiento')) {
        return {
          rows: [
            {
              id: 1,
              item: 'Cambio de rodamiento',
              tipo_mantenimiento: 'PREVENTIVO',
              fecha_realizacion: new Date(2024, 1, 15),
              estado: 'CUMPLIDO',
              responsable: 'Juan Perez',
              fecha_cierre: new Date(2024, 1, 16, 9, 30),
            },
            {
              id: 2,
              item: 'Calibracion de sensores',
              tipo_mantenimiento: 'CALIBRACION',
              fecha_realizacion: new Date(2024, 5, 1),
              estado: 'EN_EJECUCION',
              responsable: null,
              fecha_cierre: null,
            },
          ],
        };
      }
      return { rows: [] };
    },
    connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
  };

  const stubs = [
    [dbPath, smartPool],
    [
      facultyScopePath,
      {
        canonicalizeFacultyName: (value) => value,
        resolveCoordinatorScope: async () => ({ coordinatorDocument: null, facultyIds: [] }),
      },
    ],
    [emailNotificationsPath, { sendEmailNotification: async () => ({ success: true }) }],
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

test('prestamos genera el PDF de hoja de vida con la informacion vigente (CA05/CA06)', async () => {
  const loaded = loadRoute();

  try {
    const app = express();
    app.use((req, res, next) => {
      req.session = { user: { id: 5, tipo: 'admin', roles: ['admin'] } };
      next();
    });
    app.use('/', loaded.route);

    const response = await request(app)
      .get('/hojas-vida/7/imprimir')
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /application\/pdf/);
    assert.match(response.headers['content-disposition'], /Hoja_Vida_INV-001\.pdf/);
    assert.ok(response.body.length > 1000, `pdf length=${response.body.length}`);
    assert.equal(response.body.slice(0, 5).toString(), '%PDF-');
  } finally {
    loaded.restore();
  }
});
