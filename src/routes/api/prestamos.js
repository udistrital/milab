const express = require('express');
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const PDFDocument = require('pdfkit');
const { PDFDocument: PdfLibDocument, StandardFonts } = require('pdf-lib');

const { canonicalizeFacultyName, resolveCoordinatorScope } = require('../../libs/faculty-scope');
const pool = require('../../libs/db');
const { sendEmailNotification } = require('../../libs/email-notifications');
const { getPrestamosModuleAccess } = require('../../libs/prestamos-module-access');
const { normalizeRoles } = require('../../libs/roles');
const { requireRoles, renderAuthError } = require('../middlewares/auth');

const router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: true }));

const incidentEvidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 1024 * 1024,
  },
  fileFilter: function (req, file, cb) {
    if (!file?.mimetype || !String(file.mimetype).startsWith('image/')) {
      cb(new Error('Solo se permiten imagenes como evidencia.'));
      return;
    }

    cb(null, true);
  },
});

function parseIncidentEvidenceUpload(req, res, next) {
  incidentEvidenceUpload.single('evidencia')(req, res, function (error) {
    if (error) {
      return res.status(400).json({
        success: false,
        message: sanitizeText(error.message) || 'No fue posible procesar la evidencia fotografica.',
      });
    }

    return next();
  });
}

function respondPrestamosModuleBlocked(req, res) {
  const message = 'El modulo de Prestamos esta deshabilitado para tu facultad.';
  const wantsJson =
    req.method !== 'GET' ||
    req.xhr ||
    String(req.get('accept') || '')
      .toLowerCase()
      .includes('application/json');

  if (wantsJson) {
    return res.status(403).json({
      success: false,
      message,
    });
  }

  return renderAuthError(res, {
    message: 'Acceso denegado',
    message2: message,
    limit: 'loginOnly',
  });
}

router.use(async function attachPrestamosModuleAccess(req, res, next) {
  try {
    const access = await getPrestamosModuleAccess(req.session?.user || null);
    req.prestamosModuleAccess = access;

    if (access?.blocked && ['coordinador', 'laboratorista'].includes(access.role)) {
      return respondPrestamosModuleBlocked(req, res);
    }

    return next();
  } catch (error) {
    return next(error);
  }
});

router.get('/', function (req, res) {
  const roles = normalizeRoles(req.session?.user?.roles || req.session?.user?.tipo);

  if (!roles.length) {
    return res.redirect('/milab/auth/login');
  }

  if (roles.includes('estudiante') || roles.includes('docente')) {
    return res.redirect('/milab/prestamos/solicitar');
  }

  return res.redirect('/milab/prestamos/reportes');
});

const INVENTARIO_MENU_ROUTE = '/milab/prestamos/inventario';
const EQUIPOS_MENU_ROUTE = '/milab/prestamos/equipos';
const SOLICITAR_MENU_ROUTE = '/milab/prestamos/solicitar';
const MIS_SOLICITUDES_MENU_ROUTE = '/milab/prestamos/mis-solicitudes';
const GESTION_SOLICITUDES_MENU_ROUTE = '/milab/prestamos/gestion-solicitudes';
const ENTREGA_EQUIPOS_MENU_ROUTE = '/milab/prestamos/entrega-equipos';
const INCIDENCIAS_MENU_ROUTE = '/milab/prestamos/incidencias';
const PRACTICAS_GESTION_MENU_ROUTE = '/milab/prestamos/practicas/gestion';
const SALAS_MENU_ROUTE = '/milab/prestamos/salas';
const REPORTES_MENU_ROUTE = '/milab/prestamos/reportes';
const AUDITORIA_MENU_ROUTE = '/milab/prestamos/auditoria';
const PARAMETRIZACIONES_MENU_ROUTE = '/milab/prestamos/admin/parametrizaciones';
const PRACTICAS_CONFIG_MENU_ROUTE = '/milab/prestamos/coordinador/practicas/config';
const COORDINADOR_FIRMA_ROUTE = '/milab/prestamos/coordinador/firma';

const ALLOWED_INSTITUTIONAL_FORMAT_FILES = new Set([
  'GL-PR-001-FR-001.pdf',
  'GL-PR-001-FR-002.pdf',
  'GL-PR-001-FR-004.pdf',
  'GL-PR-001-FR-006.pdf',
  'GL-PR-001-FR-012.pdf',
]);

const INSTITUTIONAL_FORMATS_DIRECTORY = path.join(__dirname, '..', '..', 'public', 'formatos');
const PDF_FONT_REGULAR = path.join(
  __dirname,
  '..',
  '..',
  'public',
  'fonts',
  'NotoSansJP-Regular.otf'
);
const PDF_FONT_BOLD = path.join(__dirname, '..', '..', 'public', 'fonts', 'NotoSansJP-Bold.otf');
const PDF_ESCUDO_PATH = path.join(
  __dirname,
  '..',
  '..',
  'public',
  'img',
  'Logo_Escudo_Verticall.jpg'
);
const PDF_SIGUD_PATH = path.join(__dirname, '..', '..', 'public', 'img', 'logo_sigud.jpg');

const requireInventarioAccess = requireRoles(['admin', 'laboratorista', 'coordinador'], {
  message: 'Acceso denegado',
  message2: 'No tienes permisos para acceder al modulo de inventario.',
  limit: 'loginOnly',
});

function createMenuPermissionMiddleware(route) {
  return async function requireMenuPermission(req, res, next) {
    try {
      const user = req.session?.user;
      const roles = normalizeRoles(user?.roles || user?.tipo);

      if (!user || !roles.length) {
        return renderAuthError(res, {
          message: 'Acceso denegado',
          message2: 'Debe iniciar sesion para continuar.',
          limit: 'loginOnly',
        });
      }

      const menuResult = await pool.query(
        `
          SELECT id
          FROM menu_item
          WHERE route = $1
            AND activo = TRUE
          LIMIT 1
        `,
        [route]
      );

      if (!menuResult.rows.length) {
        return next();
      }

      const permissionResult = await pool.query(
        `
          SELECT 1
          FROM rol_permiso rp
          JOIN rol r ON r.id = rp.rol_id
          WHERE rp.menu_item_id = $1
            AND rp.can_view = TRUE
            AND r.nombre = ANY($2::text[])
          LIMIT 1
        `,
        [menuResult.rows[0].id, roles]
      );

      if (!permissionResult.rows.length) {
        return renderAuthError(res, {
          message: 'Acceso denegado',
          message2: 'No tienes permisos para este modulo.',
          limit: 'loginOnly',
        });
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

const requireInventarioAuthorized = [
  requireInventarioAccess,
  createMenuPermissionMiddleware(INVENTARIO_MENU_ROUTE),
];

const requireEquiposAccess = requireRoles(['admin', 'laboratorista', 'coordinador'], {
  message: 'Acceso denegado',
  message2: 'No tienes permisos para acceder al modulo de equipos.',
  limit: 'loginOnly',
});

const requireEquiposAuthorized = [
  requireEquiposAccess,
  createMenuPermissionMiddleware(EQUIPOS_MENU_ROUTE),
];

const requireSolicitudesAccess = requireRoles(['estudiante', 'docente'], {
  message: 'Acceso denegado',
  message2: 'No tienes permisos para acceder al modulo de solicitudes de prestamo.',
  limit: 'loginOnly',
});

const requireSolicitudesAuthorized = [
  requireSolicitudesAccess,
  createMenuPermissionMiddleware(SOLICITAR_MENU_ROUTE),
];

const requireMisSolicitudesAuthorized = [
  requireSolicitudesAccess,
  createMenuPermissionMiddleware(MIS_SOLICITUDES_MENU_ROUTE),
];

const requireGestionSolicitudesAccess = requireRoles(['admin', 'laboratorista', 'coordinador'], {
  message: 'Acceso denegado',
  message2: 'No tienes permisos para acceder a la gestion de solicitudes de prestamo.',
  limit: 'loginOnly',
});

const requireGestionSolicitudesAuthorized = [
  requireGestionSolicitudesAccess,
  createMenuPermissionMiddleware(GESTION_SOLICITUDES_MENU_ROUTE),
];

const requireEntregaEquiposAccess = requireRoles(['admin', 'laboratorista', 'coordinador'], {
  message: 'Acceso denegado',
  message2: 'No tienes permisos para acceder al modulo de entrega y devolucion.',
  limit: 'loginOnly',
});

const requireEntregaEquiposAuthorized = [
  requireEntregaEquiposAccess,
  createMenuPermissionMiddleware(ENTREGA_EQUIPOS_MENU_ROUTE),
];

const requireIncidenciasAccess = requireRoles(['admin', 'laboratorista', 'coordinador'], {
  message: 'Acceso denegado',
  message2: 'No tienes permisos para acceder al modulo de incidencias.',
  limit: 'loginOnly',
});

const requireIncidenciasAuthorized = [
  requireIncidenciasAccess,
  createMenuPermissionMiddleware(INCIDENCIAS_MENU_ROUTE),
];

const requirePracticasAccess = requireRoles(['estudiante', 'docente'], {
  message: 'Acceso denegado',
  message2: 'No tienes permisos para acceder al modulo de practicas.',
  limit: 'loginOnly',
});

const requirePracticasAuthorized = [requirePracticasAccess];

const requireMisPracticasAuthorized = [requirePracticasAccess];

const requireGestionPracticasAccess = requireRoles(['admin', 'laboratorista', 'coordinador'], {
  message: 'Acceso denegado',
  message2: 'No tienes permisos para acceder a la gestion de practicas.',
  limit: 'loginOnly',
});

const requireGestionPracticasAuthorized = [
  requireGestionPracticasAccess,
  createMenuPermissionMiddleware(PRACTICAS_GESTION_MENU_ROUTE),
];

const requireSalasAccess = requireRoles(['admin', 'laboratorista', 'coordinador'], {
  message: 'Acceso denegado',
  message2: 'No tienes permisos para acceder al modulo de salas.',
  limit: 'loginOnly',
});

const requireSalasAuthorized = [
  requireSalasAccess,
  createMenuPermissionMiddleware(SALAS_MENU_ROUTE),
];

const requireReportesAccess = requireRoles(['admin', 'laboratorista', 'coordinador'], {
  message: 'Acceso denegado',
  message2: 'No tienes permisos para acceder al modulo de reportes de prestamos.',
  limit: 'loginOnly',
});

const requireReportesAuthorized = [
  requireReportesAccess,
  createMenuPermissionMiddleware(REPORTES_MENU_ROUTE),
];

const requireAuditoriaAccess = requireRoles(['admin', 'laboratorista', 'coordinador'], {
  message: 'Acceso denegado',
  message2: 'No tienes permisos para acceder a la auditoria de prestamos.',
  limit: 'loginOnly',
});

const requireAuditoriaAuthorized = [
  requireAuditoriaAccess,
  createMenuPermissionMiddleware(AUDITORIA_MENU_ROUTE),
];

const requireParametrizacionesAccess = requireRoles(['admin'], {
  message: 'Acceso denegado',
  message2: 'No tienes permisos para acceder a las parametrizaciones de prestamos.',
  limit: 'loginOnly',
});

const requireParametrizacionesAuthorized = [
  requireParametrizacionesAccess,
  createMenuPermissionMiddleware(PARAMETRIZACIONES_MENU_ROUTE),
];

const requirePracticasConfigAccess = requireRoles(['admin', 'coordinador', 'laboratorista'], {
  message: 'Acceso denegado',
  message2: 'No tienes permisos para acceder a la configuracion de practicas.',
  limit: 'loginOnly',
});

const requirePracticasConfigAuthorized = [
  requirePracticasConfigAccess,
  createMenuPermissionMiddleware(PRACTICAS_CONFIG_MENU_ROUTE),
];

const requireCoordinatorSignatureAccess = requireRoles(['coordinador'], {
  message: 'Acceso denegado',
  message2: 'Solo los coordinadores pueden administrar su firma.',
  limit: 'loginOnly',
});

const requireCoordinatorSignatureAuthorized = [requireCoordinatorSignatureAccess];

const requirePrestamosDocumentAccess = requireRoles(
  ['admin', 'laboratorista', 'coordinador', 'estudiante', 'docente'],
  {
    message: 'Acceso denegado',
    message2: 'No tienes permisos para consultar documentos del modulo de prestamos.',
    limit: 'loginOnly',
  }
);

function toBoolean(value) {
  return value === true || value === 'true' || value === 'on' || value === 'si';
}

function sanitizeText(value) {
  return value === undefined || value === null ? null : String(value).trim() || null;
}

const PRESTAMOS_AUDIT_ACTIONS = [
  'Aprobar Solicitud Prestamo',
  'Rechazar Solicitud Prestamo',
  'Entregar equipo (Prestamo)',
  'Recibir equipo (Finalizar Prestamo)',
  'Prestamo de ultima hora',
  'Asignar cola prestamo (Ultima hora)',
  'Reportar incidencia',
  'Aprobar incidencia (Coordinador)',
  'Solicitar Cierre Incidencia',
  'Solucionar Incidencia (Cerrar)',
  'Configurar Parametrizaciones (Admin)',
  'Configurar Practicas (Coordinador)',
  'Aprobar Reserva Practica',
  'Rechazar Reserva Practica',
  'Iniciar Practica',
  'Finalizar Practica (Recibida)',
  'Marcar No Asistio',
  'Practica de ultima hora',
  'Asignar cola practica (Ultima hora)',
  'Registrar Incidencia Practica Docente',
];

async function registerPrestamosAuditEntry(options = {}) {
  const req = options.req;
  const user = req?.session?.user || {};
  const roles = normalizeRoles(user?.roles || user?.tipo);
  const actorRole = sanitizeText(user?.tipo) || roles[0] || 'sistema';
  const actorDocument = sanitizeText(user?.documento) || '0';
  const action = sanitizeText(options.accion);
  const person = sanitizeText(options.persona) || '-';
  const executor = options.client || pool;

  if (!action) {
    return;
  }

  try {
    await executor.query(
      `
        INSERT INTO log (nombre, documento, accion, persona)
        VALUES ($1, $2, $3, $4)
      `,
      [actorRole, actorDocument, action, person]
    );
  } catch (error) {
    console.error('Error registrando auditoria del modulo de prestamos:', error);
  }
}

const tableColumnCache = new Map();
let practiceIncidenceSchemaEnsured = false;
let academicPracticeSchemaEnsured = false;

async function fetchTableColumns(tableName, client = pool) {
  const normalizedTableName = sanitizeText(tableName);
  if (!normalizedTableName) {
    return new Set();
  }

  if (tableColumnCache.has(normalizedTableName)) {
    return tableColumnCache.get(normalizedTableName);
  }

  const result = await client.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
    `,
    [normalizedTableName]
  );

  const columns = new Set(result.rows.map((row) => String(row.column_name || '')));
  tableColumnCache.set(normalizedTableName, columns);
  return columns;
}

async function ensurePracticeIncidenceSchema(client = pool) {
  if (practiceIncidenceSchemaEnsured) {
    return;
  }

  await client.query(`ALTER TABLE incidencia ALTER COLUMN equipo_id DROP NOT NULL`);
  await client.query(`ALTER TABLE incidencia ADD COLUMN IF NOT EXISTS reserva_practica_id INT`);
  await client.query(`ALTER TABLE incidencia ADD COLUMN IF NOT EXISTS practica_tipo VARCHAR(20)`);

  await client.query(
    `ALTER TABLE incidencia DROP CONSTRAINT IF EXISTS fk_incidencia_reserva_practica`
  );
  await client.query(
    `ALTER TABLE incidencia
      ADD CONSTRAINT fk_incidencia_reserva_practica
      FOREIGN KEY (reserva_practica_id) REFERENCES reserva_practica(id) ON DELETE SET NULL`
  );

  await client.query(`ALTER TABLE incidencia DROP CONSTRAINT IF EXISTS ck_origen_incidencia`);
  await client.query(
    `ALTER TABLE incidencia
      ADD CONSTRAINT ck_origen_incidencia
      CHECK (origen IN ('prestamo', 'practica'))`
  );

  await client.query(
    `ALTER TABLE incidencia DROP CONSTRAINT IF EXISTS ck_practica_tipo_incidencia`
  );
  await client.query(
    `ALTER TABLE incidencia
      ADD CONSTRAINT ck_practica_tipo_incidencia
      CHECK (practica_tipo IS NULL OR practica_tipo IN ('libre', 'docente'))`
  );

  practiceIncidenceSchemaEnsured = true;
}

async function ensureAcademicPracticeSchema(client = pool) {
  if (academicPracticeSchemaEnsured) {
    return;
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS asignatura (
      id SERIAL NOT NULL,
      codigo VARCHAR(80) NOT NULL,
      nombre VARCHAR(255) NOT NULL,
      descripcion TEXT,
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT pk_asignatura PRIMARY KEY (id),
      CONSTRAINT uq_asignatura_codigo UNIQUE (codigo)
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_asignatura_codigo ON asignatura(codigo)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_asignatura_nombre ON asignatura(nombre)`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS configuracion_practica (
      id SERIAL NOT NULL,
      ual_id INT NOT NULL,
      schema_json JSONB NOT NULL DEFAULT '{"campos_adicionales":[]}'::jsonb,
      creado_por_id BIGINT,
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT pk_configuracion_practica PRIMARY KEY (id),
      CONSTRAINT uq_configuracion_practica_ual UNIQUE (ual_id),
      CONSTRAINT fk_configuracion_practica_ual FOREIGN KEY (ual_id) REFERENCES ual(ual_id) ON DELETE CASCADE,
      CONSTRAINT fk_configuracion_practica_usuario FOREIGN KEY (creado_por_id) REFERENCES usuario(id) ON DELETE SET NULL,
      CONSTRAINT ck_configuracion_practica_schema_json CHECK (jsonb_typeof(schema_json) = 'object')
    )
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_configuracion_practica_ual ON configuracion_practica(ual_id)`
  );

  await client.query(`
    CREATE TABLE IF NOT EXISTS practica (
      id SERIAL NOT NULL,
      ual_id INT NOT NULL,
      nombre VARCHAR(255) NOT NULL,
      descripcion TEXT,
      tipo_practica VARCHAR(120) NOT NULL,
      estado VARCHAR(20) NOT NULL DEFAULT 'borrador',
      configuracion_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      creado_por_id BIGINT,
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT pk_practica PRIMARY KEY (id),
      CONSTRAINT fk_practica_ual FOREIGN KEY (ual_id) REFERENCES ual(ual_id) ON DELETE CASCADE,
      CONSTRAINT fk_practica_usuario FOREIGN KEY (creado_por_id) REFERENCES usuario(id) ON DELETE SET NULL,
      CONSTRAINT ck_practica_estado CHECK (estado IN ('borrador', 'activa', 'inactiva')),
      CONSTRAINT ck_practica_configuracion_json CHECK (jsonb_typeof(configuracion_json) = 'object')
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_practica_ual ON practica(ual_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_practica_estado ON practica(estado)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_practica_tipo ON practica(tipo_practica)`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS asignatura_practica (
      id SERIAL NOT NULL,
      asignatura_id INT NOT NULL,
      practica_id INT NOT NULL,
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT pk_asignatura_practica PRIMARY KEY (id),
      CONSTRAINT uq_asignatura_practica UNIQUE (asignatura_id, practica_id),
      CONSTRAINT fk_asignatura_practica_asignatura FOREIGN KEY (asignatura_id) REFERENCES asignatura(id) ON DELETE CASCADE,
      CONSTRAINT fk_asignatura_practica_practica FOREIGN KEY (practica_id) REFERENCES practica(id) ON DELETE CASCADE
    )
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_asignatura_practica_asignatura ON asignatura_practica(asignatura_id)`
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_asignatura_practica_practica ON asignatura_practica(practica_id)`
  );

  academicPracticeSchemaEnsured = true;
}

function sanitizeInstitutionalFormatFile(value) {
  const normalized = sanitizeText(value);
  if (!normalized) {
    return null;
  }

  const fileName = normalized.toLowerCase().endsWith('.pdf') ? normalized : `${normalized}.pdf`;
  return ALLOWED_INSTITUTIONAL_FORMAT_FILES.has(fileName) ? fileName : null;
}

function sanitizeJsonObject(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  return typeof value === 'object' && !Array.isArray(value) ? value : null;
}

const DEFAULT_PRACTICE_CONFIGURATION = {
  min_cancel_hours: 1,
  min_reserva_hours: 2,
  min_docente_reserva_days: 0,
  max_activas_estudiante: 2,
  dias_sancion_no_asistencia: 1,
  max_horas_mes_practica_libre: 0,
  max_horas_mes_prestamos: 0,
};

const DEFAULT_DYNAMIC_PRACTICE_SCHEMA = {
  campos_adicionales: [],
};

const ALLOWED_DYNAMIC_PRACTICE_FIELD_TYPES = new Set([
  'text',
  'textarea',
  'number',
  'select',
  'checkbox',
  'date',
  'url',
]);

function normalizeNonNegativeInteger(value, fallbackValue = 0) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallbackValue;
  }

  return parsed;
}

function normalizePositiveInteger(value, fallbackValue) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackValue;
  }

  return parsed;
}

function buildInventoryPayload(body = {}) {
  return {
    serie: sanitizeText(body.serie),
    placa: sanitizeText(body.placa),
    nombre_bien: sanitizeText(body.nombre_bien),
    grupo_inventario: sanitizeText(body.grupo_inventario),
    nivel_inventario: sanitizeText(body.nivel_inventario),
    funcionario_doc: sanitizeText(body.funcionario_doc),
    nombre_funcionario: sanitizeText(body.nombre_funcionario),
    fecha_registro: sanitizeText(body.fecha_registro),
    sede: sanitizeText(body.sede),
    dependencia: sanitizeText(body.dependencia),
    espacio_fisico: sanitizeText(body.espacio_fisico),
    disponible_prestamo: toBoolean(body.disponible_prestamo),
  };
}

function validateInventoryPayload(payload) {
  if (!payload.nombre_bien) {
    return 'El nombre del bien es obligatorio.';
  }

  if (payload.fecha_registro && !/^\d{4}-\d{2}-\d{2}$/.test(payload.fecha_registro)) {
    return 'La fecha de registro no tiene un formato valido.';
  }

  return '';
}

function isValidInventoryId(id) {
  return /^\d+$/.test(String(id || '').trim());
}

function sanitizeEquipmentCode(value) {
  const normalized = sanitizeText(value);
  return normalized ? normalized.toUpperCase() : null;
}

function buildEquipmentPayload(body = {}) {
  return {
    codigo: sanitizeEquipmentCode(body.codigo),
    nombre: sanitizeText(body.nombre),
    descripcion: sanitizeText(body.descripcion),
    categoria: sanitizeText(body.categoria),
    laboratorio: sanitizeText(body.laboratorio),
    facultad: sanitizeText(body.facultad),
    area_conocimiento: sanitizeText(body.area_conocimiento),
    estado: sanitizeText(body.estado),
    ubicacion: sanitizeText(body.ubicacion),
    ubicacion_prestamo: {
      dentro: toBoolean(body.ubicacion_prestamo_dentro),
      fuera: toBoolean(body.ubicacion_prestamo_fuera),
    },
    especificaciones: {
      marca: sanitizeText(body.marca),
      modelo: sanitizeText(body.modelo),
      serie: sanitizeText(body.serie_equipo),
      detalles: sanitizeText(body.detalles_tecnicos),
    },
  };
}

function validateEquipmentPayload(payload) {
  if (!payload.nombre) {
    return 'El nombre del equipo es obligatorio.';
  }

  if (!payload.categoria) {
    return 'La categoria del equipo es obligatoria.';
  }

  if (!payload.estado) {
    return 'El estado del equipo es obligatorio.';
  }

  if (!['disponible', 'prestado', 'mantenimiento', 'fuera_servicio'].includes(payload.estado)) {
    return 'El estado del equipo no es valido.';
  }

  if (!payload.ubicacion_prestamo.dentro && !payload.ubicacion_prestamo.fuera) {
    return 'Debes seleccionar al menos una ubicacion de prestamo.';
  }

  return '';
}

function isValidEquipmentId(id) {
  return /^\d+$/.test(String(id || '').trim());
}

function generateEquipmentCode() {
  return `EQ-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function sanitizeLocalDateTime(value) {
  const normalized = sanitizeText(value);
  return normalized ? normalized.slice(0, 16) : null;
}

function sanitizeDateOnly(value) {
  const normalized = sanitizeText(value);
  return normalized ? normalized.slice(0, 10) : null;
}

function isValidDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function getCurrentDateKey() {
  return new Date().toISOString().slice(0, 10);
}

function getShiftedDateKey(monthDelta) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setMonth(date.getMonth() + monthDelta);
  return date.toISOString().slice(0, 10);
}

function escapeCsvValue(value) {
  if (value === undefined || value === null) {
    return '';
  }

  const normalized = String(value).replace(/"/g, '""');
  return `"${normalized}"`;
}

function sendCsvResponse(res, filename, headers, rows) {
  const headerRow = headers.map((item) => escapeCsvValue(item.label)).join(',');
  const contentRows = (rows || []).map((row) =>
    headers.map((item) => escapeCsvValue(row[item.key])).join(',')
  );
  const csv = [headerRow].concat(contentRows).join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.status(200).send(`\uFEFF${csv}`);
}

function isValidLocalDateTime(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value || ''));
}

function parseBogotaDateTime(value) {
  const normalized = sanitizeLocalDateTime(value);
  if (!normalized || !isValidLocalDateTime(normalized)) return null;

  return new Date(`${normalized}:00-05:00`);
}

function buildLoanRequestPayload(body = {}) {
  return {
    equipo_id: sanitizeText(body.equipoId || body.equipo_id),
    fecha_inicio: sanitizeLocalDateTime(body.fechaInicio || body.fecha_inicio),
    fecha_fin: sanitizeLocalDateTime(body.fechaFin || body.fecha_fin),
    justificacion_academica: sanitizeText(body.justificacion || body.justificacion_academica),
    categoria_practica: sanitizeText(body.categoria_practica),
    firma_digital: sanitizeText(body.firma_digital),
  };
}

function validateLoanRequestPayload(payload) {
  if (!/^\d+$/.test(String(payload.equipo_id || ''))) {
    return 'El equipo seleccionado no es valido.';
  }

  if (!isValidLocalDateTime(payload.fecha_inicio) || !isValidLocalDateTime(payload.fecha_fin)) {
    return 'Las fechas de la solicitud no tienen un formato valido.';
  }

  if (payload.fecha_inicio.slice(0, 10) !== payload.fecha_fin.slice(0, 10)) {
    return 'La solicitud debe seleccionarse dentro de un solo horario del mismo dia.';
  }

  const fechaInicio = parseBogotaDateTime(payload.fecha_inicio);
  const fechaFin = parseBogotaDateTime(payload.fecha_fin);

  if (
    !fechaInicio ||
    !fechaFin ||
    Number.isNaN(fechaInicio.getTime()) ||
    Number.isNaN(fechaFin.getTime())
  ) {
    return 'Las fechas de la solicitud no tienen un formato valido.';
  }

  if (fechaInicio <= new Date()) {
    return 'La fecha de inicio debe ser posterior a la fecha actual.';
  }

  if (fechaFin <= fechaInicio) {
    return 'La fecha de fin debe ser posterior a la fecha de inicio.';
  }

  if (!payload.justificacion_academica || payload.justificacion_academica.length < 10) {
    return 'La justificacion academica es obligatoria y debe tener al menos 10 caracteres.';
  }

  if (!['academica', 'extension', 'investigacion', 'otra'].includes(payload.categoria_practica)) {
    return 'La categoria de la solicitud no es valida.';
  }

  if (!payload.firma_digital || payload.firma_digital.length < 5) {
    return 'La firma digital es obligatoria y debe tener al menos 5 caracteres.';
  }

  return '';
}

function isValidLoanRequestId(id) {
  return /^\d+$/.test(String(id || '').trim());
}

function buildLoanDeliveryPayload(body = {}) {
  return {
    condicion_entrega: sanitizeText(body.condicion_entrega || body.condicionEntrega),
  };
}

function buildLoanReturnPayload(body = {}) {
  const componentes = Array.isArray(body.lista_componentes)
    ? body.lista_componentes
    : typeof body.lista_componentes === 'string'
      ? body.lista_componentes.split(',')
      : [];

  return {
    condicion_devolucion: sanitizeText(body.condicion_devolucion || body.condicionDevolucion),
    lista_componentes: componentes.map((item) => sanitizeText(item)).filter(Boolean),
  };
}

function buildIncidentPayload(body = {}) {
  return {
    tipo_incidencia: sanitizeText(body.tipo_incidencia || body.tipoIncidencia),
    descripcion: sanitizeText(body.descripcion),
    descripcion_cierre: sanitizeText(body.descripcion_cierre || body.descripcionCierre),
    sancion_tipo: sanitizeText(body.sancion_tipo || body.sancionTipo),
    sancion_detalle: sanitizeText(body.sancion_detalle || body.sancionDetalle),
  };
}

function resolveIncidentReporterState(sessionUsuario) {
  const roles = normalizeRoles(sessionUsuario?.roles);
  if (roles.includes('admin') || roles.includes('coordinador')) {
    return 'abierta';
  }

  if (roles.includes('laboratorista')) {
    return 'pendiente_confirmacion';
  }

  return 'abierta';
}

function canApproveIncident(sessionUsuario) {
  const roles = normalizeRoles(sessionUsuario?.roles);
  return roles.includes('admin') || roles.includes('coordinador');
}

function canRequestIncidentClose(sessionUsuario) {
  const roles = normalizeRoles(sessionUsuario?.roles);
  return roles.includes('admin') || roles.includes('laboratorista');
}

function canFinalizeIncidentClose(sessionUsuario) {
  const roles = normalizeRoles(sessionUsuario?.roles);
  return roles.includes('admin') || roles.includes('coordinador');
}

function buildPracticeManagementPayload(body = {}) {
  return {
    sala_id: sanitizeText(body.sala_id || body.salaId),
    motivo_rechazo: sanitizeText(body.motivo_rechazo || body.motivoRechazo),
    confirmar_cierre: toBoolean(body.confirmar_cierre || body.confirmarCierre),
  };
}

function buildPracticeReservationPayload(body = {}) {
  return {
    facultad: sanitizeText(body.facultad),
    laboratorio: sanitizeText(body.laboratorio),
    sala_id: sanitizeText(body.sala_id || body.salaId),
    fecha_inicio: sanitizeLocalDateTime(body.fechaInicio || body.fecha_inicio),
    fecha_fin: sanitizeLocalDateTime(body.fechaFin || body.fecha_fin),
    tipo_practica: sanitizeText(body.tipo_practica),
    categoria_practica: sanitizeText(body.categoria_practica),
    justificacion: sanitizeText(body.justificacion),
    firma_digital: sanitizeText(body.firma_digital),
    modalidad_libre: sanitizeText(body.modalidad_libre),
    formato_archivo: sanitizeInstitutionalFormatFile(body.formato_archivo || body.formatoArchivo),
    formato_payload: sanitizeJsonObject(body.formato_payload || body.formatoPayload),
  };
}

function validatePracticeReservationPayload(payload) {
  if (!payload.facultad || !payload.laboratorio) {
    return 'La facultad y el laboratorio son obligatorios.';
  }

  if (!/^\d+$/.test(String(payload.sala_id || ''))) {
    return 'Debes seleccionar una sala valida para la practica.';
  }

  if (!isValidLocalDateTime(payload.fecha_inicio) || !isValidLocalDateTime(payload.fecha_fin)) {
    return 'Las fechas de la practica no tienen un formato valido.';
  }

  const fechaInicio = parseBogotaDateTime(payload.fecha_inicio);
  const fechaFin = parseBogotaDateTime(payload.fecha_fin);

  if (
    !fechaInicio ||
    !fechaFin ||
    Number.isNaN(fechaInicio.getTime()) ||
    Number.isNaN(fechaFin.getTime())
  ) {
    return 'Las fechas de la practica no tienen un formato valido.';
  }

  if (fechaInicio <= new Date()) {
    return 'La fecha de inicio debe ser posterior a la fecha actual.';
  }

  if (fechaFin <= fechaInicio) {
    return 'La fecha de fin debe ser posterior a la fecha de inicio.';
  }

  if (payload.fecha_inicio.slice(0, 10) !== payload.fecha_fin.slice(0, 10)) {
    return 'La practica debe seleccionarse dentro de un solo dia.';
  }

  if (!['libre', 'docente'].includes(payload.tipo_practica)) {
    return 'El tipo de practica no es valido.';
  }

  if (!['academica', 'extension', 'investigacion', 'otra'].includes(payload.categoria_practica)) {
    return 'La categoria de la practica no es valida.';
  }

  if (!payload.justificacion || payload.justificacion.length < 10) {
    return 'La justificacion de la practica es obligatoria y debe tener al menos 10 caracteres.';
  }

  if (
    payload.modalidad_libre &&
    !['uno_a_uno', 'uno_a_varios', 'varios_a_uno'].includes(payload.modalidad_libre)
  ) {
    return 'La modalidad libre de la practica no es valida.';
  }

  if (!payload.firma_digital || payload.firma_digital.length < 5) {
    return 'La firma digital es obligatoria y debe tener al menos 5 caracteres.';
  }

  return '';
}

function normalizeSlugPart(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeText(item)).filter(Boolean);
  }

  const normalized = sanitizeText(value);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/\r?\n|,/)
    .map((item) => sanitizeText(item))
    .filter(Boolean);
}

function normalizePracticeSubjectList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(function (item) {
      return {
        codigo: sanitizeText(item?.codigo),
        nombre: sanitizeText(item?.nombre),
        descripcion: sanitizeText(item?.descripcion),
      };
    })
    .filter(function (item) {
      return item.codigo && item.nombre;
    });
}

function normalizePracticeDocumentList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(function (item) {
      const url = sanitizeText(item?.url);
      const nombre =
        sanitizeText(item?.nombre) ||
        (url
          ? decodeURIComponent(String(url).split('/').pop().split('?')[0] || 'Documento PDF')
          : null);

      return {
        nombre,
        url,
      };
    })
    .filter(function (item) {
      return item.url;
    });
}

function normalizeDynamicPracticeField(rawField, index) {
  const nombre = sanitizeText(rawField?.nombre);
  const keyCandidate = sanitizeText(rawField?.key);
  const key = normalizeSlugPart(keyCandidate || nombre || `campo_${index + 1}`);
  const tipo = sanitizeText(rawField?.tipo || 'text');
  const valores = normalizeStringList(rawField?.valores);

  return {
    key,
    nombre,
    tipo,
    obligatorio: toBoolean(rawField?.obligatorio),
    ayuda: sanitizeText(rawField?.ayuda),
    placeholder: sanitizeText(rawField?.placeholder),
    valores,
  };
}

function normalizeDynamicPracticeSchema(value) {
  const raw = sanitizeJsonObject(value) || DEFAULT_DYNAMIC_PRACTICE_SCHEMA;
  const fields = Array.isArray(raw.campos_adicionales) ? raw.campos_adicionales : [];

  return {
    campos_adicionales: fields.map(normalizeDynamicPracticeField).filter(function (item) {
      return item.key && item.nombre;
    }),
  };
}

function validateDynamicPracticeSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return 'El esquema dinamico de la practica no es valido.';
  }

  const keys = new Set();
  for (const field of schema.campos_adicionales || []) {
    if (!field.key || !field.nombre) {
      return 'Todos los campos adicionales deben tener nombre y llave.';
    }

    if (!ALLOWED_DYNAMIC_PRACTICE_FIELD_TYPES.has(field.tipo)) {
      return `El tipo del campo adicional "${field.nombre}" no es valido.`;
    }

    if (keys.has(field.key)) {
      return `La llave "${field.key}" esta repetida en el esquema dinamico.`;
    }
    keys.add(field.key);

    if (['select'].includes(field.tipo) && !(field.valores || []).length) {
      return `El campo "${field.nombre}" debe definir al menos una opcion.`;
    }
  }

  return '';
}

function normalizeDynamicPracticeValues(value) {
  const raw = sanitizeJsonObject(value);
  return raw || {};
}

function validateDynamicPracticeValues(schema, values) {
  const normalizedValues = values && typeof values === 'object' ? values : {};

  for (const field of schema.campos_adicionales || []) {
    const currentValue = normalizedValues[field.key];
    const isEmptyValue =
      currentValue === undefined ||
      currentValue === null ||
      String(currentValue).trim() === '' ||
      (Array.isArray(currentValue) && !currentValue.length);

    if (field.obligatorio && isEmptyValue) {
      return `El campo dinamico "${field.nombre}" es obligatorio.`;
    }

    if (isEmptyValue) {
      continue;
    }

    if (field.tipo === 'number' && !Number.isFinite(Number(currentValue))) {
      return `El campo dinamico "${field.nombre}" debe ser numerico.`;
    }

    if (field.tipo === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(currentValue))) {
      return `El campo dinamico "${field.nombre}" debe tener formato YYYY-MM-DD.`;
    }

    if (field.tipo === 'url') {
      try {
        const parsed = new URL(String(currentValue));
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return `El campo dinamico "${field.nombre}" debe ser una URL http o https.`;
        }
      } catch {
        return `El campo dinamico "${field.nombre}" debe ser una URL valida.`;
      }
    }

    if (field.tipo === 'select' && !(field.valores || []).includes(String(currentValue))) {
      return `El valor del campo dinamico "${field.nombre}" no coincide con las opciones permitidas.`;
    }
  }

  return '';
}

function buildDynamicPracticeSchemaPayload(body = {}) {
  return {
    facultad_id: sanitizeText(body.facultad_id),
    ual_id: sanitizeText(body.ual_id),
    schema_json: normalizeDynamicPracticeSchema(body.schema_json || body.schemaJson),
  };
}

function buildAcademicPracticePayload(body = {}) {
  return {
    practica_id: sanitizeText(body.practica_id || body.practicaId),
    facultad_id: sanitizeText(body.facultad_id),
    ual_id: sanitizeText(body.ual_id || body.ualId),
    nombre: sanitizeText(body.nombre),
    descripcion: sanitizeText(body.descripcion),
    tipo_practica: sanitizeText(body.tipo_practica),
    estado: sanitizeText(body.estado || 'borrador'),
    asignaturas: normalizePracticeSubjectList(body.asignaturas),
    documentos: normalizePracticeDocumentList(body.documentos),
    insumos: normalizeStringList(body.insumos),
    equipos: normalizeStringList(body.equipos),
    competencias: normalizeStringList(body.competencias),
    guias_trabajo: normalizeStringList(body.guias_trabajo || body.guiasTrabajo),
    recomendaciones_seguridad: normalizeStringList(
      body.recomendaciones_seguridad || body.recomendacionesSeguridad
    ),
    parametros_evaluacion: normalizeStringList(
      body.parametros_evaluacion || body.parametrosEvaluacion
    ),
    recomendaciones: sanitizeText(body.recomendaciones),
    observaciones: sanitizeText(body.observaciones),
    duracion: sanitizeText(body.duracion),
    configuracion_dinamica: normalizeDynamicPracticeValues(
      body.configuracion_dinamica || body.configuracionDinamica
    ),
  };
}

function validateAcademicPracticePayload(payload, schema) {
  if (!/^\d+$/.test(String(payload.ual_id || ''))) {
    return 'Debes seleccionar un laboratorio valido para la practica.';
  }

  if (!payload.nombre) {
    return 'El nombre de la practica es obligatorio.';
  }

  if (!payload.tipo_practica) {
    return 'El tipo de practica es obligatorio.';
  }

  if (!['borrador', 'activa', 'inactiva'].includes(payload.estado || '')) {
    return 'El estado de la practica no es valido.';
  }

  if (!payload.asignaturas.length) {
    return 'Debes asociar al menos una asignatura a la practica.';
  }

  if (payload.documentos.length > 10) {
    return 'Solo puedes asociar hasta 10 documentos PDF por practica.';
  }

  for (const documento of payload.documentos) {
    try {
      const parsed = new URL(documento.url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return `El documento "${documento.nombre || documento.url}" debe usar http o https.`;
      }
    } catch {
      return `El enlace del documento "${documento.nombre || documento.url}" no es una URL valida.`;
    }
  }

  if (
    payload.duracion &&
    (!Number.isInteger(Number(payload.duracion)) || Number(payload.duracion) <= 0)
  ) {
    return 'La duracion de la practica debe ser un numero entero mayor que cero.';
  }

  const dynamicValueError = validateDynamicPracticeValues(schema, payload.configuracion_dinamica);
  if (dynamicValueError) {
    return dynamicValueError;
  }

  return '';
}

function buildSalaPayload(body = {}) {
  return {
    facultad: sanitizeText(body.facultad),
    laboratorio: sanitizeText(body.laboratorio),
    nombre: sanitizeText(body.nombre),
    tipo_espacio: sanitizeText(body.tipo_espacio),
    capacidad: sanitizeText(body.capacidad),
    descripcion: sanitizeText(body.descripcion),
    equipos_nombres: sanitizeText(body.equipos_nombres),
    permite_practica_libre: toBoolean(body.permite_practica_libre),
    permite_practica_docente: toBoolean(body.permite_practica_docente),
    formato_practica_libre: sanitizeText(body.formato_practica_libre),
    formato_practica_docente: sanitizeText(body.formato_practica_docente),
    activo: body.activo === undefined ? true : toBoolean(body.activo),
  };
}

function validateSalaPayload(payload) {
  if (!payload.facultad || !payload.laboratorio) {
    return 'La facultad y el laboratorio son obligatorios.';
  }

  if (!payload.nombre) {
    return 'El nombre de la sala es obligatorio.';
  }

  if (!['Aula', 'Laboratorio', 'Sala', 'Otro'].includes(payload.tipo_espacio || 'Sala')) {
    return 'El tipo de espacio no es valido.';
  }

  const capacidad = Number(payload.capacidad);
  if (!Number.isInteger(capacidad) || capacidad <= 0) {
    return 'La capacidad de la sala debe ser un numero entero mayor que cero.';
  }

  if (payload.equipos_nombres && payload.equipos_nombres.length > 2500) {
    return 'La lista de equipos excede el maximo permitido.';
  }

  return '';
}

function buildSalaSchedulePayload(body = {}) {
  return {
    dia_semana: sanitizeText(body.dia_semana),
    fecha: sanitizeText(body.fecha),
    hora_inicio: sanitizeText(body.hora_inicio),
    hora_fin: sanitizeText(body.hora_fin),
    tipo_practica: sanitizeText(body.tipo_practica),
    modalidad_libre: sanitizeText(body.modalidad_libre),
  };
}

function validateSalaSchedulePayload(payload) {
  var hasFecha = Boolean(payload.fecha);
  var hasDia =
    payload.dia_semana !== null && payload.dia_semana !== undefined && payload.dia_semana !== '';

  if (hasFecha === hasDia) {
    return 'Debes indicar una fecha especifica o un dia de la semana.';
  }

  if (hasFecha && !/^\d{4}-\d{2}-\d{2}$/.test(payload.fecha)) {
    return 'La fecha del horario no tiene un formato valido.';
  }

  if (hasDia) {
    var dia = Number(payload.dia_semana);
    if (!Number.isInteger(dia) || dia < 0 || dia > 6) {
      return 'El dia de la semana no es valido.';
    }
  }

  if (
    !/^\d{2}:\d{2}$/.test(String(payload.hora_inicio || '')) ||
    !/^\d{2}:\d{2}$/.test(String(payload.hora_fin || ''))
  ) {
    return 'Las horas del horario no tienen un formato valido.';
  }

  if (payload.hora_inicio >= payload.hora_fin) {
    return 'La hora de inicio debe ser menor que la hora de fin.';
  }

  if (!['libre', 'docente'].includes(payload.tipo_practica || 'libre')) {
    return 'El tipo de practica del horario no es valido.';
  }

  if (
    payload.modalidad_libre &&
    !['uno_a_uno', 'uno_a_varios', 'varios_a_uno'].includes(payload.modalidad_libre)
  ) {
    return 'La modalidad libre del horario no es valida.';
  }

  return '';
}

function isValidSalaId(id) {
  return /^\d+$/.test(String(id || '').trim());
}

function formatLocalDateKey(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function formatLocalTimeKey(date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function generateDefaultEquipmentSchedules(daysAhead = 14) {
  const schedules = [];
  const currentDate = new Date();

  for (let offset = 1; offset <= daysAhead; offset += 1) {
    const targetDate = new Date(currentDate);
    targetDate.setDate(currentDate.getDate() + offset);

    const day = targetDate.getDay();
    if (day === 0) {
      continue;
    }

    schedules.push({
      fecha: targetDate.toISOString().split('T')[0],
      hora_inicio: day === 6 ? '08:00' : '08:00',
      hora_fin: day === 6 ? '12:00' : '17:00',
      activo: true,
    });
  }

  return schedules;
}

function parseScheduleEntries(body = {}) {
  const fechas = Array.isArray(body.schedule_fecha)
    ? body.schedule_fecha
    : body.schedule_fecha
      ? [body.schedule_fecha]
      : [];
  const horasInicio = Array.isArray(body.schedule_hora_inicio)
    ? body.schedule_hora_inicio
    : body.schedule_hora_inicio
      ? [body.schedule_hora_inicio]
      : [];
  const horasFin = Array.isArray(body.schedule_hora_fin)
    ? body.schedule_hora_fin
    : body.schedule_hora_fin
      ? [body.schedule_hora_fin]
      : [];

  const total = Math.max(fechas.length, horasInicio.length, horasFin.length);
  const schedules = [];

  for (let index = 0; index < total; index += 1) {
    const fecha = sanitizeText(fechas[index]);
    const horaInicio = sanitizeText(horasInicio[index]);
    const horaFin = sanitizeText(horasFin[index]);

    if (!fecha && !horaInicio && !horaFin) {
      continue;
    }

    schedules.push({
      fecha,
      hora_inicio: horaInicio,
      hora_fin: horaFin,
    });
  }

  return schedules;
}

function validateSchedules(schedules) {
  const groupedByDate = new Map();

  for (const schedule of schedules) {
    if (!schedule.fecha || !schedule.hora_inicio || !schedule.hora_fin) {
      return 'Cada horario debe tener fecha, hora de inicio y hora de fin.';
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(schedule.fecha)) {
      return 'Una de las fechas de horario no tiene un formato valido.';
    }

    if (!/^\d{2}:\d{2}$/.test(schedule.hora_inicio) || !/^\d{2}:\d{2}$/.test(schedule.hora_fin)) {
      return 'Uno de los horarios no tiene un formato valido.';
    }

    if (schedule.hora_inicio >= schedule.hora_fin) {
      return 'La hora de inicio debe ser menor que la hora de fin en cada horario.';
    }

    if (!groupedByDate.has(schedule.fecha)) {
      groupedByDate.set(schedule.fecha, []);
    }

    groupedByDate.get(schedule.fecha).push(schedule);
  }

  for (const [, entries] of groupedByDate.entries()) {
    const sortedEntries = [...entries].sort((left, right) =>
      left.hora_inicio.localeCompare(right.hora_inicio)
    );

    for (let index = 1; index < sortedEntries.length; index += 1) {
      const previous = sortedEntries[index - 1];
      const current = sortedEntries[index];

      if (current.hora_inicio < previous.hora_fin) {
        return 'Hay horarios traslapados en una misma fecha.';
      }
    }
  }

  return '';
}

function normalizeEquipmentForView(item = {}) {
  const specs = item.especificaciones || {};
  const loanLocation = item.ubicacion_prestamo || {};
  const schedules = Array.isArray(item.horarios) ? item.horarios : [];

  return {
    ...item,
    especificaciones: {
      marca: specs.marca || '',
      modelo: specs.modelo || '',
      serie: specs.serie || '',
      detalles: specs.detalles || '',
    },
    ubicacion_prestamo: {
      dentro: loanLocation.dentro !== false,
      fuera: Boolean(loanLocation.fuera),
    },
    horarios: schedules.map((schedule) => ({
      fecha: schedule.fecha ? new Date(schedule.fecha).toISOString().split('T')[0] : '',
      hora_inicio: schedule.hora_inicio ? String(schedule.hora_inicio).slice(0, 5) : '',
      hora_fin: schedule.hora_fin ? String(schedule.hora_fin).slice(0, 5) : '',
    })),
  };
}

function resolveDbErrorMessage(error, fallbackMessage) {
  if (error?.code === '42P01') {
    return 'La tabla inventario no existe aun. Actualiza la base con la definicion de inventario en sql-scripts/db_structure.sql.';
  }

  if (error?.code === '23505') {
    if (
      String(error.constraint || '')
        .toLowerCase()
        .includes('serie')
    ) {
      return 'Ya existe un elemento con esa serie.';
    }
    if (
      String(error.constraint || '')
        .toLowerCase()
        .includes('placa')
    ) {
      return 'Ya existe un elemento con esa placa.';
    }
    return 'Ya existe un elemento con esos datos.';
  }

  if (error?.code === '23502') {
    return 'Faltan datos obligatorios para guardar el elemento.';
  }

  if (error?.code === '22007') {
    return 'La fecha de registro no tiene un formato valido.';
  }

  if (error?.code === '22P02') {
    return 'El identificador del inventario no es valido.';
  }

  return fallbackMessage;
}

function resolveEquipmentDbErrorMessage(error, fallbackMessage) {
  if (error?.code === '42P01') {
    return 'La tabla equipo no existe aun. Actualiza la base con la definicion de equipos en sql-scripts/db_structure.sql.';
  }

  if (error?.code === '23505') {
    if (
      String(error.constraint || '')
        .toLowerCase()
        .includes('codigo')
    ) {
      return 'Ya existe un equipo con ese codigo.';
    }
    return 'Ya existe un equipo con esos datos.';
  }

  if (error?.code === '23502') {
    return 'Faltan datos obligatorios para guardar el equipo.';
  }

  if (error?.code === '22P02') {
    return 'El identificador del equipo no es valido.';
  }

  return fallbackMessage;
}

function resolveLoanDbErrorMessage(error, fallbackMessage) {
  if (error?.code === '42P01') {
    if (
      String(error?.message || '')
        .toLowerCase()
        .includes('parametrizacion')
    ) {
      return 'La tabla parametrizacion no existe aun. Actualiza la base con la definicion de prestamos en sql-scripts/db_structure.sql.';
    }

    if (
      String(error?.message || '')
        .toLowerCase()
        .includes('practica_config')
    ) {
      return 'La tabla practica_config no existe aun. Actualiza la base con la definicion de prestamos en sql-scripts/db_structure.sql.';
    }

    if (
      String(error?.message || '')
        .toLowerCase()
        .includes('cola_solicitud')
    ) {
      return 'La tabla cola_solicitud no existe aun. Actualiza la base con la definicion de prestamos en sql-scripts/db_structure.sql.';
    }

    if (
      String(error?.message || '')
        .toLowerCase()
        .includes('incidencia')
    ) {
      return 'La tabla incidencia no existe aun. Actualiza la base con la definicion de prestamos en sql-scripts/db_structure.sql.';
    }

    if (
      String(error?.message || '')
        .toLowerCase()
        .includes('reserva_practica')
    ) {
      return 'La tabla reserva_practica no existe aun. Actualiza la base con la definicion de prestamos en sql-scripts/db_structure.sql.';
    }

    if (
      String(error?.message || '')
        .toLowerCase()
        .includes('entrega_equipo')
    ) {
      return 'La tabla entrega_equipo no existe aun. Actualiza la base con la definicion de prestamos en sql-scripts/db_structure.sql.';
    }

    if (
      String(error?.message || '')
        .toLowerCase()
        .includes('horario_sala')
    ) {
      return 'La tabla horario_sala no existe aun. Actualiza la base con la definicion de prestamos en sql-scripts/db_structure.sql.';
    }

    if (
      String(error?.message || '')
        .toLowerCase()
        .includes('sala')
    ) {
      return 'La tabla sala no existe aun. Actualiza la base con la definicion de prestamos en sql-scripts/db_structure.sql.';
    }

    return 'La tabla solicitud_prestamo no existe aun. Actualiza la base con la definicion de prestamos en sql-scripts/db_structure.sql.';
  }

  if (error?.code === '23502') {
    const column = sanitizeText(error?.column);
    if (column) {
      return `Falta el dato obligatorio ${column}.`;
    }
    return 'Faltan datos obligatorios para procesar la solicitud.';
  }

  if (error?.code === '23503') {
    const constraint = String(error?.constraint || '').toLowerCase();
    if (constraint.includes('reserva_practica') && constraint.includes('usuario')) {
      return 'No fue posible asociar el usuario a la reserva. Verifica que el usuario exista en la tabla usuario.';
    }
    return 'La solicitud referencia datos que no existen en la base.';
  }

  if (error?.code === '23505') {
    return 'Ya existe un registro con esos datos.';
  }

  if (error?.code === '23514') {
    const constraint = String(error?.constraint || '').toLowerCase();
    if (constraint.includes('chk_reserva_practica_rango')) {
      return 'La franja horaria no es valida (la hora de inicio debe ser menor a la hora de fin).';
    }
    if (constraint.includes('chk_reserva_practica_modalidad')) {
      return 'La modalidad de practica libre no es valida. Verifica la configuracion de horarios de salas.';
    }
    return 'Los datos de la solicitud no cumplen las reglas del sistema.';
  }

  if (error?.code === '22P02') {
    return 'Uno de los identificadores de la solicitud no es valido.';
  }

  if (error?.code === '22001') {
    return 'Uno de los textos enviados supera la longitud maxima permitida.';
  }

  if (error?.code === '42703') {
    const message = String(error?.message || '').toLowerCase();
    if (message.includes('reserva_practica')) {
      return 'La tabla reserva_practica en esta base aun no tiene todas las columnas nuevas del modulo. Actualiza la estructura con sql-scripts/db_structure.sql.';
    }
    if (message.includes('solicitud_prestamo')) {
      return 'La tabla solicitud_prestamo en esta base aun no tiene todas las columnas nuevas del modulo. Actualiza la estructura con sql-scripts/db_structure.sql.';
    }
    if (message.includes('entrega_equipo')) {
      return 'La tabla entrega_equipo en esta base aun no tiene todas las columnas nuevas del modulo. Actualiza la estructura con sql-scripts/db_structure.sql.';
    }
    if (message.includes('parametrizacion')) {
      return 'La tabla parametrizacion en esta base aun no tiene todas las columnas nuevas del modulo. Actualiza la estructura con sql-scripts/db_structure.sql.';
    }
    return 'La base de datos aun no tiene todas las columnas nuevas del modulo de prestamos. Actualiza la estructura con sql-scripts/db_structure.sql.';
  }

  return fallbackMessage;
}

async function fetchSessionUsuario(req) {
  const sessionUser = req.session?.user;
  if (!sessionUser) return null;

  const document = sanitizeText(sessionUser.documento_real || sessionUser.documento);
  const numericId = Number.isFinite(Number(sessionUser.id)) ? Number(sessionUser.id) : null;

  const result = await pool.query(
    `
      SELECT
        u.id,
        u.documento,
        u.nombre,
        u.correo,
        COALESCE(
          ARRAY_REMOVE(ARRAY_AGG(r.nombre ORDER BY r.nombre), NULL),
          ARRAY[]::text[]
        ) AS roles
      FROM usuario u
      LEFT JOIN usuario_rol ur
        ON ur.usuario_id = u.id
       AND ur.activo = TRUE
      LEFT JOIN rol r
        ON r.id = ur.rol_id
      WHERE ($1::bigint IS NOT NULL AND u.id = $1::bigint)
         OR ($2::text IS NOT NULL AND u.documento = $2::text)
      GROUP BY u.id
      ORDER BY u.id DESC
      LIMIT 1
    `,
    [numericId, document]
  );

  return result.rows[0] || null;
}

async function resolveLoanManagementScope(req) {
  const sessionUser = req.session?.user;
  const roles = normalizeRoles(sessionUser?.roles || sessionUser?.tipo);
  const authDocument = sanitizeText(sessionUser?.documento_real || sessionUser?.documento);

  if (roles.includes('admin')) {
    return {
      unrestricted: true,
      facultyIds: [],
      laboratoryNames: [],
      restrictToLaboratories: false,
    };
  }

  if (!authDocument) {
    return {
      unrestricted: false,
      facultyIds: [],
      laboratoryNames: [],
      restrictToLaboratories: false,
    };
  }

  if (roles.includes('coordinador')) {
    const scope = await resolveCoordinatorScope(pool, authDocument);
    const allowedFacultyIds = Array.isArray(req?.prestamosModuleAccess?.allowedFacultyIds)
      ? req.prestamosModuleAccess.allowedFacultyIds
      : [];
    const scopedFacultyIds = (scope.facultyIds || [])
      .map((item) => Number(item))
      .filter(Number.isInteger)
      .filter((facultyId) => !allowedFacultyIds.length || allowedFacultyIds.includes(facultyId));

    return {
      unrestricted: false,
      facultyIds: scopedFacultyIds,
      laboratoryNames: [],
      restrictToLaboratories: false,
    };
  }

  if (roles.includes('laboratorista')) {
    const result = await pool.query(
      `
        SELECT
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT u.facultad_id), NULL) AS facultades,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT UPPER(u.nombre)), NULL) AS laboratorios
        FROM (
          SELECT documento
          FROM laboratorista
          WHERE documento = $1 OR n_usuario = $1
          LIMIT 1
        ) l
        LEFT JOIN laboratorista_ual lu
          ON lu.laboratorista_documento_id = l.documento
         AND lu.activo = TRUE
        LEFT JOIN ual u
          ON u.ual_id = lu.ual_id
         AND u.activo = TRUE
      `,
      [authDocument]
    );

    const facultyIds = Array.isArray(result.rows[0]?.facultades)
      ? result.rows[0].facultades.map((item) => Number(item)).filter(Number.isInteger)
      : [];
    const allowedFacultyIds = Array.isArray(req?.prestamosModuleAccess?.allowedFacultyIds)
      ? req.prestamosModuleAccess.allowedFacultyIds
      : [];
    const laboratoryNames = Array.isArray(result.rows[0]?.laboratorios)
      ? result.rows[0].laboratorios.map((item) => sanitizeText(item)).filter(Boolean)
      : [];

    return {
      unrestricted: false,
      facultyIds: facultyIds.filter(
        (facultyId) => !allowedFacultyIds.length || allowedFacultyIds.includes(facultyId)
      ),
      laboratoryNames,
      restrictToLaboratories: true,
    };
  }

  return {
    unrestricted: false,
    facultyIds: [],
    laboratoryNames: [],
    restrictToLaboratories: false,
  };
}

async function fetchEquipmentFormOptions(req, currentItem = {}) {
  const sessionUser = req.session?.user;
  const roles = normalizeRoles(sessionUser?.roles || sessionUser?.tipo);
  const authDocument = sanitizeText(sessionUser?.documento_real || sessionUser?.documento);
  let rows = [];

  if (roles.includes('admin')) {
    const result = await pool.query(
      `
        SELECT DISTINCT
          f.nombre AS facultad,
          u.nombre AS laboratorio
        FROM facultad f
        LEFT JOIN ual u
          ON u.facultad_id = f.facultad_id
         AND u.activo = TRUE
        WHERE f.activo = TRUE
        ORDER BY f.nombre ASC, u.nombre ASC
      `
    );
    rows = result.rows || [];
  } else if (roles.includes('coordinador') && authDocument) {
    const scope = await resolveCoordinatorScope(pool, authDocument);
    const allowedFacultyIds = Array.isArray(req?.prestamosModuleAccess?.allowedFacultyIds)
      ? req.prestamosModuleAccess.allowedFacultyIds
      : [];
    const scopedFacultyIds = (scope.facultyIds || [])
      .map((item) => Number(item))
      .filter(Number.isInteger)
      .filter((facultyId) => !allowedFacultyIds.length || allowedFacultyIds.includes(facultyId));

    if (scopedFacultyIds.length) {
      const result = await pool.query(
        `
          SELECT DISTINCT
            f.nombre AS facultad,
            u.nombre AS laboratorio
          FROM facultad f
          LEFT JOIN ual u
            ON u.facultad_id = f.facultad_id
           AND u.activo = TRUE
          WHERE f.activo = TRUE
            AND f.facultad_id = ANY($1::int[])
          ORDER BY f.nombre ASC, u.nombre ASC
        `,
        [scopedFacultyIds]
      );
      rows = result.rows || [];
    }
  } else if (roles.includes('laboratorista') && authDocument) {
    const laboratoristaResult = await pool.query(
      `
        SELECT documento
        FROM laboratorista
        WHERE documento = $1 OR n_usuario = $1
        LIMIT 1
      `,
      [authDocument]
    );

    const laboratorista = laboratoristaResult.rows[0] || null;
    const assignedUalIds = new Set();

    if (laboratorista?.documento) {
      const assignedUalResult = await pool.query(
        `
          SELECT ual_id
          FROM laboratorista_ual
          WHERE laboratorista_documento_id = $1
            AND activo = TRUE
        `,
        [laboratorista.documento]
      );

      (assignedUalResult.rows || []).forEach((row) => {
        const ualId = Number(row.ual_id);
        if (Number.isInteger(ualId)) {
          assignedUalIds.add(ualId);
        }
      });
    }

    const allowedFacultyIds = Array.isArray(req?.prestamosModuleAccess?.allowedFacultyIds)
      ? req.prestamosModuleAccess.allowedFacultyIds
      : [];

    if (assignedUalIds.size) {
      const result = await pool.query(
        `
          SELECT DISTINCT
            f.facultad_id,
            f.nombre AS facultad,
            u.nombre AS laboratorio
          FROM ual u
          JOIN facultad f
            ON f.facultad_id = u.facultad_id
          WHERE u.activo = TRUE
            AND f.activo = TRUE
            AND u.ual_id = ANY($1::int[])
          ORDER BY f.nombre ASC, u.nombre ASC
        `,
        [[...assignedUalIds]]
      );
      rows = (result.rows || []).filter((item) => {
        if (!allowedFacultyIds.length) {
          return true;
        }

        return allowedFacultyIds.includes(Number(item.facultad_id || 0));
      });
    }
  }

  const facultadesSet = new Set();
  const laboratoriosByFaculty = {};

  (rows || []).forEach((row) => {
    const facultad = sanitizeText(row.facultad);
    const laboratorio = sanitizeText(row.laboratorio);

    if (!facultad) {
      return;
    }

    facultadesSet.add(facultad);
    if (!laboratoriosByFaculty[facultad]) {
      laboratoriosByFaculty[facultad] = [];
    }

    if (laboratorio && !laboratoriosByFaculty[facultad].includes(laboratorio)) {
      laboratoriosByFaculty[facultad].push(laboratorio);
    }
  });

  const selectedFaculty = sanitizeText(currentItem?.facultad);
  const selectedLaboratory = sanitizeText(currentItem?.laboratorio);

  if (selectedFaculty) {
    facultadesSet.add(selectedFaculty);
    if (!laboratoriosByFaculty[selectedFaculty]) {
      laboratoriosByFaculty[selectedFaculty] = [];
    }
  }

  if (selectedFaculty && selectedLaboratory) {
    if (!laboratoriosByFaculty[selectedFaculty]) {
      laboratoriosByFaculty[selectedFaculty] = [];
    }

    if (!laboratoriosByFaculty[selectedFaculty].includes(selectedLaboratory)) {
      laboratoriosByFaculty[selectedFaculty].push(selectedLaboratory);
    }
  }

  const facultades = [...facultadesSet].sort(function (a, b) {
    return a.localeCompare(b, 'es');
  });

  Object.keys(laboratoriosByFaculty).forEach((facultad) => {
    laboratoriosByFaculty[facultad] = [...new Set(laboratoriosByFaculty[facultad])].sort(
      function (a, b) {
        return a.localeCompare(b, 'es');
      }
    );
  });

  return {
    facultades,
    laboratoriosByFaculty,
  };
}

async function renderEquipmentForm(req, res, options) {
  const normalizedItem = normalizeEquipmentForView(options?.item || {});
  const formOptions = await fetchEquipmentFormOptions(req, normalizedItem);

  return res.status(options?.statusCode || 200).render('home/prestamos/equipos/form', {
    item: normalizedItem,
    isEdit: Boolean(options?.isEdit),
    errorMessage: sanitizeText(options?.errorMessage),
    availableFacultades: formOptions.facultades,
    availableLaboratoriosByFaculty: formOptions.laboratoriosByFaculty,
  });
}

function buildFacultyNameScopeClause(columnExpression, scope, params) {
  if (scope?.unrestricted) {
    return '';
  }

  if (!scope?.facultyIds || !scope.facultyIds.length) {
    return ' AND 1 = 0';
  }

  params.push(scope.facultyIds);
  return `
    AND EXISTS (
      SELECT 1
      FROM facultad f_scope
      WHERE f_scope.facultad_id = ANY($${params.length}::int[])
        AND UPPER(f_scope.nombre) = UPPER(${columnExpression})
    )
  `;
}

function buildLaboratoryNameScopeClause(columnExpression, scope, params) {
  if (scope?.unrestricted || !scope?.restrictToLaboratories) {
    return '';
  }

  if (!scope?.laboratoryNames || !scope.laboratoryNames.length) {
    return ' AND 1 = 0';
  }

  params.push(scope.laboratoryNames);
  return ` AND UPPER(COALESCE(${columnExpression}, '')) = ANY($${params.length}::text[])`;
}

function buildFacultyIdScopeClause(columnExpression, scope, params) {
  if (scope?.unrestricted) {
    return '';
  }

  if (!scope?.facultyIds || !scope.facultyIds.length) {
    return ' AND 1 = 0';
  }

  params.push(scope.facultyIds);
  return ` AND ${columnExpression} = ANY($${params.length}::int[]) `;
}

function resolveReportDateRange(query = {}) {
  const defaultFechaFin = getCurrentDateKey();
  const defaultFechaInicio = getShiftedDateKey(-5);
  const rawFechaInicio = sanitizeDateOnly(query.fecha_inicio) || defaultFechaInicio;
  const rawFechaFin = sanitizeDateOnly(query.fecha_fin) || defaultFechaFin;
  const fechaInicio = isValidDateOnly(rawFechaInicio) ? rawFechaInicio : defaultFechaInicio;
  const fechaFin = isValidDateOnly(rawFechaFin) ? rawFechaFin : defaultFechaFin;

  return {
    fechaInicio,
    fechaFin,
    isValid: fechaInicio <= fechaFin,
    defaultFechaInicio,
    defaultFechaFin,
  };
}

const PRACTICAS_FORMATOS = {
  PL_REGLAMENTO_GENERAL: {
    tituloComprobante: 'COMPROBANTE DE RESERVA - PRACTICA LIBRE',
    declaracionComprobante:
      'Declaro que conozco y acepto el reglamento de uso del laboratorio. Me hago responsable del puesto de trabajo asignado y de los equipos utilizados durante la practica.',
    tituloReglamento: 'Formato de Aceptacion del Reglamento - Practicas Libres',
    textoAceptacion:
      'He leido, comprendido y aceptado los terminos del presente reglamento para el uso del laboratorio.',
    reglamentoItems: [
      '1. El usuario es responsable de cumplir las normas del laboratorio.',
      '2. Debe mantener el orden y el cuidado de los equipos durante la practica.',
      '3. Cualquier incidente debe reportarse al personal del laboratorio.',
      '4. Los recursos se usaran exclusivamente con fines academicos.',
      '5. Se deben respetar horarios, aforos e instrucciones del laboratorista.',
    ],
  },
  PL_SEGURIDAD_BIOSEGURIDAD: {
    tituloComprobante: 'COMPROBANTE DE RESERVA - PRACTICA LIBRE (SEGURIDAD)',
    declaracionComprobante:
      'Declaro que cumplire las normas de seguridad y bioseguridad del laboratorio y que usare los elementos de proteccion requeridos.',
    tituloReglamento: 'Formato de Aceptacion - Seguridad y Bioseguridad',
    textoAceptacion:
      'He leido y acepto las normas de seguridad y bioseguridad aplicables al laboratorio.',
    reglamentoItems: [
      '1. Deben usarse los elementos de proteccion personal requeridos.',
      '2. No se permite el ingreso de alimentos o bebidas a las areas restringidas.',
      '3. Se deben mantener despejadas las rutas de evacuacion.',
      '4. Las instrucciones ante emergencias deben seguirse de forma inmediata.',
      '5. Toda condicion insegura o incidente debe ser reportado.',
    ],
  },
  PL_RESPONSABILIDAD_EQUIPOS: {
    tituloComprobante: 'COMPROBANTE DE RESERVA - PRACTICA LIBRE (EQUIPOS)',
    declaracionComprobante:
      'Declaro que utilizare los equipos de forma responsable y reportare cualquier dano o novedad durante la practica.',
    tituloReglamento: 'Formato de Aceptacion - Responsabilidad por Equipos',
    textoAceptacion:
      'He leido y acepto las condiciones de uso responsable de equipos y puesto de trabajo.',
    reglamentoItems: [
      '1. Verificar el estado del puesto y de los equipos antes de iniciar.',
      '2. No manipular configuraciones ni componentes sin autorizacion.',
      '3. Reportar fallas, danos o perdidas de inmediato.',
      '4. Dejar el puesto en condiciones adecuadas al finalizar.',
      '5. Respetar aforos, horarios y prioridades definidas por el laboratorio.',
    ],
  },
  DOC_PRACTICA_DOCENTE_SOLICITUD: {
    tituloComprobante: 'COMPROBANTE DE RESERVA - PRACTICA DOCENTE',
    declaracionComprobante:
      'Declaro que la reserva corresponde a una practica docente y que garantizare el uso adecuado del espacio y el cumplimiento de las normas del laboratorio.',
    tituloReglamento: 'Formato de Solicitud - Practica Docente',
    textoAceptacion: 'He leido y acepto las condiciones para la realizacion de practicas docentes.',
    reglamentoItems: [
      '1. El docente responsable debe velar por el control del grupo.',
      '2. Se debe cumplir con el aforo, horarios y condiciones de seguridad.',
      '3. Cualquier incidente debe ser reportado al personal del laboratorio.',
      '4. Los equipos y recursos se usaran solo con fines academicos.',
      '5. El espacio debe entregarse organizado y en condiciones adecuadas.',
    ],
  },
  DOC_COMPROMISO_DOCENTE: {
    tituloComprobante: 'COMPROBANTE DE RESERVA - PRACTICA DOCENTE (COMPROMISO)',
    declaracionComprobante:
      'Declaro mi compromiso como docente responsable para velar por el cuidado del espacio, de los equipos y de la seguridad de los asistentes.',
    tituloReglamento: 'Formato de Compromiso - Practica Docente',
    textoAceptacion:
      'Acepto el compromiso de supervision y cuidado del espacio durante la practica docente.',
    reglamentoItems: [
      '1. El docente asumira la supervision durante toda la sesion.',
      '2. Se garantizara el uso correcto de equipos y materiales.',
      '3. Se respetaran los protocolos del laboratorio y del plan de seguridad.',
      '4. Se reportaran novedades e incidentes cuando ocurran.',
      '5. El espacio se entregara en condiciones adecuadas al cierre.',
    ],
  },
};

function getPracticePdfFormat(code) {
  return PRACTICAS_FORMATOS[code] || PRACTICAS_FORMATOS.PL_REGLAMENTO_GENERAL;
}

function formatPdfDateTime(value) {
  if (!value) {
    return '-';
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function getMilabAppUrl() {
  const raw = String(process.env.APP_BASE_URL || '')
    .trim()
    .replace(/\/+$/, '');
  if (!raw) {
    return '';
  }

  return raw.endsWith('/milab') ? raw : `${raw}/milab`;
}

async function fetchUserNotificationProfile(userId) {
  if (!userId) {
    return null;
  }

  const result = await pool.query(
    `
      SELECT id, nombre, correo, documento, codigo
      FROM usuario
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );

  return result.rows[0] || null;
}

async function fetchUserByDocumentOrCode(value) {
  const normalized = sanitizeText(value);
  if (!normalized) {
    return null;
  }

  const result = await pool.query(
    `
      SELECT id, nombre, correo, documento, codigo
      FROM usuario
      WHERE documento = $1 OR codigo = $1
      ORDER BY id ASC
      LIMIT 1
    `,
    [normalized]
  );

  return result.rows[0] || null;
}

async function sendPrestamosNotification(payload) {
  try {
    if (!payload?.recipient || !payload?.templateName || !payload?.subject) {
      return;
    }

    await sendEmailNotification(payload);
  } catch (error) {
    console.error('Error enviando correo del modulo de prestamos:', error);
  }
}

function buildPracticeNotificationLocation(reservation) {
  const laboratorio = sanitizeText(reservation?.laboratorio);
  const sala = sanitizeText(reservation?.sala_nombre);

  if (laboratorio && sala) {
    return `${laboratorio} - ${sala}`;
  }

  return laboratorio || sala || 'Practica';
}

function buildLastMinuteEligibilityResult(startAt, endAt, now = new Date()) {
  const startDate = startAt ? new Date(startAt) : null;
  const endDate = endAt ? new Date(endAt) : null;

  if (
    !startDate ||
    !endDate ||
    Number.isNaN(startDate.getTime()) ||
    Number.isNaN(endDate.getTime())
  ) {
    return {
      allowed: false,
      message: 'La solicitud no tiene una franja valida para reasignacion.',
    };
  }

  if (now.getTime() < startDate.getTime() + 15 * 60 * 1000) {
    return {
      allowed: false,
      message: 'El prestamo de ultima hora se habilita 15 minutos despues de la hora de inicio.',
    };
  }

  if (endDate.getTime() <= now.getTime()) {
    return {
      allowed: false,
      message: 'La solicitud ya no esta vigente para reasignacion.',
    };
  }

  return {
    allowed: true,
    startDate,
    endDate,
    now,
  };
}

async function updateLoanQueueEntryStatus(client, referenceId, status, attendedBy) {
  if (!referenceId) {
    return;
  }

  await client.query(
    `
      UPDATE cola_solicitud
      SET estado = $2::text,
          atendida_por_id = CASE WHEN $2::text = 'pendiente' THEN NULL ELSE $3 END,
          fecha_modificacion = CURRENT_TIMESTAMP
      WHERE tipo = 'prestamo'
        AND referencia_id = $1
        AND estado = 'pendiente'
    `,
    [referenceId, status, attendedBy || null]
  );
}

async function updatePracticeQueueEntryStatus(client, referenceId, status, attendedBy) {
  if (!referenceId) {
    return;
  }

  await client.query(
    `
      UPDATE cola_solicitud
      SET estado = $2::text,
          atendida_por_id = CASE WHEN $2::text = 'pendiente' THEN NULL ELSE $3 END,
          fecha_modificacion = CURRENT_TIMESTAMP
      WHERE tipo = 'practica'
        AND referencia_id = $1
        AND estado = 'pendiente'
    `,
    [referenceId, status, attendedBy || null]
  );
}

async function updateQueueEntryStatusById(client, queueId, status, attendedBy) {
  if (!queueId) {
    return;
  }

  await client.query(
    `
      UPDATE cola_solicitud
      SET estado = $2::text,
          atendida_por_id = CASE WHEN $2::text = 'pendiente' THEN NULL ELSE $3 END,
          fecha_modificacion = CURRENT_TIMESTAMP
      WHERE id = $1
        AND estado = 'pendiente'
    `,
    [queueId, status, attendedBy || null]
  );
}

function drawPdfHeader(doc, title, subtitle) {
  doc.fontSize(18).font('Helvetica-Bold').text(title, { align: 'center' });

  if (subtitle) {
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica').fillColor('#555555').text(subtitle, {
      align: 'center',
    });
    doc.fillColor('#000000');
  }

  doc.moveDown(1.2);
}

function drawPdfSection(doc, title, lines) {
  doc.font('Helvetica-Bold').fontSize(12).text(title);
  doc.moveDown(0.35);
  doc.font('Helvetica').fontSize(10);

  (lines || []).forEach((line) => {
    doc.text(line);
  });

  doc.moveDown(1);
}

function drawPdfParagraph(doc, text) {
  doc
    .font('Helvetica')
    .fontSize(10)
    .text(text || '-', {
      align: 'justify',
    });
  doc.moveDown(1);
}

function drawPdfBulletList(doc, items) {
  doc.font('Helvetica').fontSize(10);

  (items || []).forEach((item) => {
    doc.text(item);
    doc.moveDown(0.3);
  });

  doc.moveDown(0.7);
}

function drawLegacyTemplateHeader(doc, tituloPrincipal) {
  doc.rect(0, 0, doc.page.width, doc.page.height).fill('#ffffff');
  doc.fillColor('#000000');

  doc.fontSize(10);
  const marginTop = 40;
  const tableWidth = doc.page.width - 80;
  const tableHeight = 80;
  const startX = 40;
  const col1Width = 90;
  const col2Width = 180;
  const col3Width = 110;
  const row1Height = 25;
  const row2Height = 25;

  doc.strokeColor('#000000').lineWidth(1).rect(startX, marginTop, tableWidth, tableHeight).stroke();
  doc
    .moveTo(startX + col1Width, marginTop)
    .lineTo(startX + col1Width, marginTop + tableHeight)
    .stroke();
  doc
    .moveTo(startX + col1Width + col2Width, marginTop)
    .lineTo(startX + col1Width + col2Width, marginTop + tableHeight)
    .stroke();
  doc
    .moveTo(startX + col1Width + col2Width + col3Width, marginTop)
    .lineTo(startX + col1Width + col2Width + col3Width, marginTop + tableHeight)
    .stroke();
  doc
    .moveTo(startX + col1Width, marginTop + row1Height)
    .lineTo(startX + col1Width + col2Width, marginTop + row1Height)
    .stroke();
  doc
    .moveTo(startX + col1Width, marginTop + row1Height + row2Height)
    .lineTo(startX + col1Width + col2Width, marginTop + row1Height + row2Height)
    .stroke();
  doc
    .moveTo(startX + col1Width + col2Width, marginTop + 25)
    .lineTo(startX + col1Width + col2Width + col3Width, marginTop + 25)
    .stroke();
  doc
    .moveTo(startX + col1Width + col2Width, marginTop + 50)
    .lineTo(startX + col1Width + col2Width + col3Width, marginTop + 50)
    .stroke();

  if (fs.existsSync(PDF_ESCUDO_PATH)) {
    doc.image(PDF_ESCUDO_PATH, startX + 5, marginTop + 10, {
      fit: [80, 60],
      align: 'center',
    });
  }

  if (fs.existsSync(PDF_SIGUD_PATH)) {
    doc.image(PDF_SIGUD_PATH, startX + col1Width + col2Width + col3Width + 5, marginTop + 10, {
      fit: [125, 60],
      align: 'center',
    });
  }

  try {
    doc.font(PDF_FONT_REGULAR);
  } catch {
    // Keep PDF generation working even if the custom font is unavailable.
  }

  doc
    .fontSize(8)
    .fill('#021c27')
    .text('SISTEMA DE LABORATORIOS', startX + col1Width + 10, marginTop + 4, {
      width: col2Width - 10,
      align: 'center',
    });
  doc.text('Codigo: GL-PR-007-', startX + col1Width + col2Width + 5, marginTop + 5, {
    width: col3Width - 10,
    align: 'center',
  });
  doc.text('FR-010', startX + col1Width + col2Width + 5, marginTop + 15, {
    width: col3Width - 10,
    align: 'center',
  });
  doc
    .fontSize(9)
    .text('Macro proceso: Apoyo a lo misional', startX + col1Width + 5, marginTop + 30, {
      width: col2Width - 10,
      align: 'left',
    });
  doc.text('Version: 04', startX + col1Width + col2Width + 5, marginTop + 30, {
    width: col3Width - 10,
    align: 'center',
  });
  doc.text(
    'Proceso: Gestion de Laboratorios',
    startX + col1Width + 5,
    marginTop + row1Height + row2Height + 5,
    {
      width: col2Width - 10,
      align: 'left',
    }
  );
  doc.fontSize(8).text('Fecha de aprobacion:', startX + col1Width + col2Width + 5, marginTop + 55, {
    width: col3Width - 10,
    align: 'center',
  });
  doc.text('30/10/2017', startX + col1Width + col2Width + 5, marginTop + 68, {
    width: col3Width - 10,
    align: 'center',
  });

  doc
    .strokeColor('#000000')
    .lineWidth(1)
    .moveTo(doc.page.width / 2 - 200, marginTop + tableHeight + 30)
    .lineTo(doc.page.width / 2 + 200, marginTop + tableHeight + 30)
    .stroke();

  try {
    doc.font(PDF_FONT_BOLD);
  } catch {
    // Keep PDF generation working even if the custom font is unavailable.
  }

  doc
    .fontSize(16)
    .fill('#021c27')
    .text(tituloPrincipal, 40, marginTop + tableHeight + 50, {
      width: doc.page.width - 80,
      align: 'center',
    });
  doc.moveDown(2);
}

function drawPdfSignatureBlock(doc, leftLabel, leftValue, rightLabel, rightValue, options = {}) {
  function getSignatureImageBuffer(value) {
    const signature = sanitizeText(value);
    if (!signature || !signature.startsWith('data:image')) {
      return null;
    }

    const parts = signature.split(',');
    if (parts.length !== 2 || !parts[1]) {
      return null;
    }

    try {
      return Buffer.from(parts[1], 'base64');
    } catch {
      return null;
    }
  }

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const gap = 20;
  const columnWidth = Math.floor((pageWidth - gap) / 2);
  const leftX = doc.page.margins.left;
  const rightX = leftX + columnWidth + gap;
  const imageHeight = 90;
  const blockExtra = 55;
  const requiredHeight = imageHeight + blockExtra;
  const pageBottom = doc.page.height - doc.page.margins.bottom;

  if (doc.y + requiredHeight > pageBottom) {
    doc.addPage();
  }

  const startY = doc.y + 10;
  const leftImageBuffer = getSignatureImageBuffer(leftValue);
  const rightImageBuffer = getSignatureImageBuffer(rightValue);

  if (leftImageBuffer) {
    try {
      doc.image(leftImageBuffer, leftX, startY, {
        fit: [columnWidth, imageHeight],
        align: 'center',
        valign: 'center',
      });
    } catch {
      doc
        .font('Helvetica')
        .fontSize(10)
        .text('Firma digital no disponible', leftX, startY + 25, {
          width: columnWidth,
          align: 'center',
        });
    }
  } else {
    doc
      .font('Helvetica')
      .fontSize(10)
      .text('Firma digital no registrada', leftX, startY + 25, {
        width: columnWidth,
        align: 'center',
      });
  }

  if (rightImageBuffer) {
    try {
      doc.image(rightImageBuffer, rightX, startY, {
        fit: [columnWidth, imageHeight],
        align: 'center',
        valign: 'center',
      });
    } catch {
      doc
        .font('Helvetica')
        .fontSize(10)
        .text('Firma digital no disponible', rightX, startY + 25, {
          width: columnWidth,
          align: 'center',
        });
    }
  } else {
    doc
      .font('Helvetica')
      .fontSize(10)
      .text('Sin firma digital registrada', rightX, startY + 25, {
        width: columnWidth,
        align: 'center',
      });
  }

  const lineY = startY + imageHeight + 10;
  doc
    .moveTo(leftX, lineY)
    .lineTo(leftX + columnWidth, lineY)
    .stroke();
  doc
    .moveTo(rightX, lineY)
    .lineTo(rightX + columnWidth, lineY)
    .stroke();

  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .text(leftLabel, leftX, lineY + 5, {
      width: columnWidth,
      align: 'center',
    })
    .text(rightLabel, rightX, lineY + 5, {
      width: columnWidth,
      align: 'center',
    });

  const leftFooter = sanitizeText(options.leftFooter);
  const rightFooter = sanitizeText(options.rightFooter);
  let footerBottom = lineY + 28;

  if (leftFooter || rightFooter) {
    doc.font('Helvetica').fontSize(8);

    if (leftFooter) {
      doc.text(leftFooter, leftX, lineY + 20, {
        width: columnWidth,
        align: 'center',
      });
    }

    if (rightFooter) {
      doc.text(rightFooter, rightX, lineY + 20, {
        width: columnWidth,
        align: 'center',
      });
    }

    footerBottom = lineY + 35;
  }

  doc.y = footerBottom;
}

function formatInstitutionalDate(value) {
  if (!value) {
    return '';
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function formatInstitutionalTime(value) {
  if (!value) {
    return '';
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function buildPracticeInstitutionalFormatPayload(reservation) {
  const persistedPayload = sanitizeJsonObject(reservation?.formato_payload) || {};
  const payload = { ...persistedPayload };

  if (!payload.archivo && reservation?.formato_archivo) {
    payload.archivo = reservation.formato_archivo;
  }

  if (!payload.fecha) {
    payload.fecha = formatInstitutionalDate(reservation?.fecha_inicio);
  }

  if (!payload.nombre) {
    payload.nombre = reservation?.usuario_nombre || '';
  }

  if (!payload.salon) {
    payload.salon = reservation?.sala_nombre || '';
  }

  if (!payload.hora_salida) {
    payload.hora_salida = formatInstitutionalTime(reservation?.fecha_inicio);
  }

  if (!payload.hora_entrega) {
    payload.hora_entrega = formatInstitutionalTime(reservation?.fecha_fin);
  }

  if (!payload.observaciones) {
    payload.observaciones = reservation?.justificacion || '';
  }

  if (!payload.nombre_practica) {
    payload.nombre_practica = reservation?.justificacion || '';
  }

  if (!payload.titulo) {
    payload.titulo = reservation?.justificacion || '';
  }

  if (!payload.docente && reservation?.tipo_practica === 'docente') {
    payload.docente = reservation?.usuario_nombre || '';
  }

  if (!payload.fecha_practica) {
    payload.fecha_practica = formatInstitutionalDate(reservation?.fecha_inicio);
  }

  if (!payload.hora_practica) {
    payload.hora_practica = formatInstitutionalTime(reservation?.fecha_inicio);
  }

  if (!payload.modalidad_libre && reservation?.modalidad_libre) {
    payload.modalidad_libre = reservation.modalidad_libre;
  }

  return payload;
}

async function renderInstitutionalFormatPdf(res, archivo, payload, responseFileName) {
  if (!ALLOWED_INSTITUTIONAL_FORMAT_FILES.has(archivo)) {
    return res.status(400).send('Formato no permitido.');
  }

  const templatePath = path.join(INSTITUTIONAL_FORMATS_DIRECTORY, archivo);
  if (!fs.existsSync(templatePath)) {
    return res.status(404).send('Plantilla institucional no encontrada.');
  }

  const existingPdfBytes = fs.readFileSync(templatePath);
  const pdfDoc = await PdfLibDocument.load(existingPdfBytes, { updateMetadata: false });
  const form = pdfDoc.getForm();
  const pages = pdfDoc.getPages();
  const page = pages[0];
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const data = {
    fecha: payload?.fecha || '',
    codEquipo: payload?.cod_equipo || payload?.codigo_equipo || '',
    claseEquipo: payload?.clase_equipo || '',
    nombre: payload?.nombre || '',
    celular: payload?.celular || '',
    proyecto: payload?.proyecto || payload?.proyecto_curricular || '',
    sede: payload?.sede || '',
    salon: payload?.salon || '',
    horaSalida: payload?.hora_salida || '',
    horaEntrega: payload?.hora_entrega || '',
    observaciones: payload?.observaciones || '',
  };

  const addOrSet = (name, value, rect, options = {}) => {
    const textValue = value === undefined || value === null ? '' : String(value);

    try {
      const field = form.getTextField(name);
      field.setText(textValue);
      return;
    } catch {
      // Continue drawing directly when the form field does not exist.
    }

    if (!textValue) {
      return;
    }

    const size = Number(options.size || 9);
    const padding = 2;
    const maxWidth = rect.width - padding * 2;
    const lineHeight = size + 1.5;
    const wrap = options.wrap !== false;
    const maxLines = Math.max(1, Math.floor((rect.height - padding * 2) / lineHeight));
    const measure = (text) => helvetica.widthOfTextAtSize(text, size);

    let lines = [];
    if (!wrap || maxLines === 1) {
      let content = textValue;
      while (measure(content) > maxWidth && content.length > 0) {
        content = content.slice(0, -1);
      }
      if (content) {
        lines = [content];
      }
    } else {
      const words = textValue.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
      let current = '';
      words.forEach((word) => {
        const candidate = current ? `${current} ${word}` : word;
        if (measure(candidate) <= maxWidth) {
          current = candidate;
        } else {
          if (current) {
            lines.push(current);
          }
          current = word;
        }
      });
      if (current) {
        lines.push(current);
      }
    }

    let y = rect.y + rect.height - size - padding - (options.baselineAdjust || 0);
    lines.slice(0, maxLines).forEach((line) => {
      page.drawText(line, {
        x: rect.x + padding,
        y,
        size,
        font: helvetica,
      });
      y -= lineHeight;
    });
  };

  const pageHeight = page.getHeight();
  const pageWidth = page.getWidth();
  const R = (x, y, width, height) => ({ x, y, width, height });
  const RTop = (x, yTop, width, height) => R(x, pageHeight - yTop - height, width, height);

  if (archivo === 'GL-PR-001-FR-012.pdf') {
    const parseDateParts = (raw) => {
      const value = String(raw || '').trim();
      if (!value) {
        return { day: '', month: '', year: '' };
      }

      const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (iso) {
        return { year: iso[1], month: iso[2], day: iso[3] };
      }

      const latin = value.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
      if (latin) {
        return { day: latin[1], month: latin[2], year: latin[3] };
      }

      return { day: value, month: '', year: '' };
    };

    const dateParts = parseDateParts(data.fecha);
    const sede = String(data.sede || '').toLowerCase();
    const checkboxOptions = { wrap: false, size: 10, baselineAdjust: -2 };
    const textOptions = { wrap: false, baselineAdjust: -1, size: 9 };

    addOrSet('Fecha_D', dateParts.day, RTop(222, 100, 48, 11), textOptions);
    addOrSet('Fecha_M', dateParts.month, RTop(345, 100, 45, 11), textOptions);
    addOrSet('Fecha_A', dateParts.year, RTop(443, 100, 38, 11), textOptions);
    addOrSet('Cod_Equipo', data.codEquipo, RTop(110, 129, 160, 11), textOptions);
    addOrSet('Clase_Equipo', data.claseEquipo, RTop(395, 129, 86, 11), textOptions);
    addOrSet('Nombre', data.nombre, RTop(110, 143, 371, 11), textOptions);
    addOrSet('Celular', data.celular, RTop(110, 158, 371, 11), textOptions);
    addOrSet('Proy_Curr', data.proyecto, RTop(110, 172, 371, 11), textOptions);
    addOrSet(
      'Sede_Sabio',
      sede.includes('sabio') ? 'X' : '',
      RTop(149, 185, 20, 11),
      checkboxOptions
    );
    addOrSet(
      'Sede_Central',
      sede.includes('central') ? 'X' : '',
      RTop(337, 185, 20, 11),
      checkboxOptions
    );
    addOrSet('Sede_Red', sede.includes('red') ? 'X' : '', RTop(427, 185, 20, 11), checkboxOptions);
    addOrSet('Salon', data.salon, RTop(110, 201, 371, 11), textOptions);
    addOrSet('Hora_Salida', data.horaSalida, RTop(110, 216, 371, 11), textOptions);
    addOrSet('Hora_Entrega', data.horaEntrega, RTop(110, 230, 371, 11), textOptions);
    addOrSet('Observaciones', data.observaciones, RTop(110, 258, 371, 40), {
      wrap: true,
      size: 9,
      baselineAdjust: -1,
    });
  } else if (archivo === 'GL-PR-001-FR-002.pdf') {
    const textOptions = { wrap: false, baselineAdjust: -1, size: 9 };
    const columnsY = [
      266, 280, 294, 308, 322, 336, 350, 364, 378, 392, 406, 420, 434, 448, 462, 476, 490, 504, 518,
      532,
    ];
    const materiales = Array.isArray(payload?.materiales) ? payload.materiales : [];
    const reactivos = Array.isArray(payload?.reactivos) ? payload.reactivos : [];
    const concentracion = Array.isArray(payload?.concentracion)
      ? payload.concentracion
      : Array.isArray(payload?.concentraciones)
        ? payload.concentraciones
        : [];
    const cantidad = Array.isArray(payload?.cantidad) ? payload.cantidad : [];
    const observaciones = String(payload?.observaciones || '').split(/\r?\n/);

    addOrSet(
      'Nombre_Practica',
      payload?.nombre_practica || payload?.titulo || '',
      RTop(161, 160, 401, 12),
      textOptions
    );
    addOrSet('Asignatura', payload?.asignatura || '', RTop(142, 174, 232, 12), textOptions);
    addOrSet('Docente', payload?.docente || '', RTop(414, 174, 148, 12), textOptions);
    addOrSet('Monitor', payload?.monitor || '', RTop(142, 188, 232, 12), textOptions);
    addOrSet(
      'Num_Grupos',
      payload?.numero_grupos || payload?.grupos || payload?.n_grupos || '',
      RTop(433, 188, 129, 12),
      textOptions
    );
    addOrSet(
      'Fecha_Solicitud',
      payload?.fecha_solicitud || payload?.fecha || '',
      RTop(170, 202, 202, 12),
      textOptions
    );
    addOrSet(
      'Hora_Solicitud',
      payload?.hora_solicitud || payload?.hora || '',
      RTop(398, 202, 164, 12),
      textOptions
    );
    addOrSet('Fecha_Practica', payload?.fecha_practica || '', RTop(170, 216, 202, 12), textOptions);
    addOrSet('Hora_Practica', payload?.hora_practica || '', RTop(398, 216, 164, 12), textOptions);

    columnsY.forEach((yTop, index) => {
      addOrSet(`Mat_${index + 1}`, materiales[index] || '', RTop(55, yTop, 219, 11), textOptions);
      addOrSet(`React_${index + 1}`, reactivos[index] || '', RTop(289, yTop, 199, 11), textOptions);
      addOrSet(
        `Conc_${index + 1}`,
        [concentracion[index] || '', cantidad[index] || ''].join(' ').trim(),
        RTop(489, yTop, 64, 11),
        textOptions
      );
    });

    addOrSet('Obs_1', observaciones[0] || '', RTop(55, 617, 507, 11), textOptions);
    addOrSet('Obs_2', observaciones[1] || '', RTop(55, 631, 507, 11), textOptions);
    addOrSet('Obs_3', observaciones[2] || '', RTop(55, 645, 507, 11), textOptions);
    addOrSet('Obs_4', observaciones[3] || '', RTop(55, 659, 507, 11), textOptions);
  } else if (archivo === 'GL-PR-001-FR-001.pdf') {
    const landscapeHeight = Math.min(pageWidth, pageHeight);
    const LTop = (x, yTop, width, height) => R(x, landscapeHeight - yTop - height, width, height);
    const textOptions = { wrap: false, baselineAdjust: -1, size: 9 };
    const categoryValue = String(payload?.tipo_practica_text || payload?.tipo_practica || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const observaciones = String(payload?.observaciones || '').split(/\r?\n/);
    const desc = Array.isArray(payload?.desc)
      ? payload.desc
      : Array.isArray(payload?.descripcion)
        ? payload.descripcion
        : [];
    const cant = Array.isArray(payload?.cant)
      ? payload.cant
      : Array.isArray(payload?.cantidad)
        ? payload.cantidad
        : [];
    const interno = Array.isArray(payload?.interno) ? payload.interno : [];
    const entrega = Array.isArray(payload?.entrega) ? payload.entrega : [];
    const devolucion = Array.isArray(payload?.devol)
      ? payload.devol
      : Array.isArray(payload?.devolucion)
        ? payload.devolucion
        : [];
    const rows = [
      222, 236, 250, 264, 277, 291, 305, 320, 334, 347, 362, 376, 389, 404, 418, 432, 446, 463,
    ];

    addOrSet('Tipo_Academico', categoryValue === 'academico' ? 'X' : '', LTop(315, 118, 20, 9), {
      wrap: false,
      size: 10,
      baselineAdjust: -2,
    });
    addOrSet(
      'Tipo_Investigacion',
      categoryValue === 'investigacion' ? 'X' : '',
      LTop(370, 118, 20, 9),
      { wrap: false, size: 10, baselineAdjust: -2 }
    );
    addOrSet('Tipo_Extension', categoryValue === 'extension' ? 'X' : '', LTop(430, 118, 20, 9), {
      wrap: false,
      size: 10,
      baselineAdjust: -2,
    });
    addOrSet('Tipo_Servicios', categoryValue === 'servicios' ? 'X' : '', LTop(480, 118, 20, 9), {
      wrap: false,
      size: 10,
      baselineAdjust: -2,
    });
    addOrSet('Tipo_Otros', categoryValue === 'otros' ? 'X' : '', LTop(525, 118, 20, 9), {
      wrap: false,
      size: 10,
      baselineAdjust: -2,
    });
    addOrSet('Nombre', payload?.nombre || '', LTop(249, 135, 155, 10), textOptions);
    addOrSet(
      'Codigo_Cedula',
      payload?.codigo || payload?.cedula || '',
      LTop(459, 135, 108, 10),
      textOptions
    );
    addOrSet(
      'Titulo_Practica',
      payload?.titulo_practica || payload?.titulo || '',
      LTop(221, 155, 183, 10),
      textOptions
    );
    addOrSet('Codigo_Grupo', payload?.codigo_grupo || '', LTop(465, 151, 102, 10), textOptions);
    addOrSet(
      'Hora_Solicitud',
      payload?.hora_solicitud || payload?.hora || '',
      LTop(323, 188, 80, 10),
      textOptions
    );
    addOrSet(
      'Dependencia',
      payload?.dependencia || payload?.lugar || '',
      LTop(405, 188, 85, 10),
      textOptions
    );
    addOrSet('Consecutivo', payload?.consecutivo || '', LTop(493, 188, 74, 10), textOptions);

    rows.forEach((rowTop, index) => {
      addOrSet(`Cant_${index + 1}`, cant[index] || '', LTop(220, rowTop, 27, 10), textOptions);
      addOrSet(`Desc_${index + 1}`, desc[index] || '', LTop(248, rowTop, 204, 10), textOptions);
      addOrSet(
        `Interno_${index + 1}`,
        interno[index] || '',
        LTop(453, rowTop, 38, 10),
        textOptions
      );
      addOrSet(
        `Entrega_${index + 1}`,
        entrega[index] || '',
        LTop(492, rowTop, 38, 10),
        textOptions
      );
      addOrSet(
        `Devol_${index + 1}`,
        devolucion[index] || '',
        LTop(531, rowTop, 37, 10),
        textOptions
      );
    });

    addOrSet('Observaciones', observaciones[0] || '', LTop(276, 481, 297, 9), textOptions);
    addOrSet('Obs_linea2', observaciones[1] || '', LTop(220, 492, 348, 9), textOptions);
    addOrSet('Obs_linea3', observaciones[2] || '', LTop(220, 506, 348, 9), textOptions);
    addOrSet('Usuario', payload?.usuario || '', LTop(430, 531, 137, 9), textOptions);
    addOrSet('Docente', payload?.docente || '', LTop(431, 555, 136, 9), textOptions);
  } else if (archivo === 'GL-PR-001-FR-004.pdf') {
    const textOptions = { wrap: false, baselineAdjust: -1, size: 9 };
    const desc = Array.isArray(payload?.desc)
      ? payload.desc
      : Array.isArray(payload?.descripcion)
        ? payload.descripcion
        : [];
    const groups = Array.from({ length: 15 }, (_, index) =>
      Array.isArray(payload?.[`g${index + 1}`]) ? payload[`g${index + 1}`] : []
    );
    const colsX = [162, 188, 214, 240, 266, 292, 318, 344, 370, 396, 422, 448, 473, 499, 525];
    const rowsY = [
      249, 269, 289, 309, 329, 349, 369, 389, 409, 429, 449, 469, 489, 509, 529, 549, 570, 590, 610,
      630, 650,
    ];

    addOrSet(
      'Nombre_Practica',
      payload?.nombre_practica || payload?.nombre || '',
      RTop(152, 155, 402, 11),
      textOptions
    );
    addOrSet(
      'Nombre_Docente',
      payload?.nombre_docente || payload?.docente || '',
      RTop(162, 173, 180, 11),
      textOptions
    );
    addOrSet('Asignatura', payload?.asignatura || '', RTop(407, 172, 147, 11), textOptions);
    addOrSet(
      'Nombre_Monitor',
      payload?.nombre_monitor || payload?.monitor || '',
      RTop(162, 190, 180, 11),
      textOptions
    );
    addOrSet('Fecha', payload?.fecha || '', RTop(384, 190, 170, 11), textOptions);

    rowsY.forEach((rowTop, rowIndex) => {
      addOrSet(
        `Desc_${rowIndex + 1}`,
        desc[rowIndex] || '',
        RTop(48, rowTop, 113, 18),
        textOptions
      );
      colsX.forEach((colX, colIndex) => {
        addOrSet(
          `G${colIndex + 1}_${rowIndex + 1}`,
          groups[colIndex]?.[rowIndex] || '',
          RTop(colX, rowTop, colIndex === 14 ? 29 : 25, 18),
          textOptions
        );
      });
    });
  } else if (archivo === 'GL-PR-001-FR-006.pdf') {
    const textOptions = { wrap: false, baselineAdjust: -1, size: 9 };
    const motivo = String(payload?.motivo || payload?.motivo_solicitud || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const desc = Array.isArray(payload?.desc) ? payload.desc : [];
    const placa = Array.isArray(payload?.placa) ? payload.placa : [];
    const fSalida = Array.isArray(payload?.fSalida)
      ? payload.fSalida
      : Array.isArray(payload?.fecha_salida)
        ? payload.fecha_salida
        : [];
    const fDevol = Array.isArray(payload?.fDevol)
      ? payload.fDevol
      : Array.isArray(payload?.fecha_devol)
        ? payload.fecha_devol
        : [];
    const precio = Array.isArray(payload?.precio) ? payload.precio : [];
    const rows = [250, 263, 277, 291];
    const userRows = [528, 542, 556, 570, 584];
    const uNom = Array.isArray(payload?.uNom) ? payload.uNom : [];
    const uCod = Array.isArray(payload?.uCod) ? payload.uCod : [];
    const uCed = Array.isArray(payload?.uCed) ? payload.uCed : [];
    const uCel = Array.isArray(payload?.uCel) ? payload.uCel : [];

    addOrSet('Dependencia', payload?.dependencia || '', RTop(122, 148, 200, 11), textOptions);
    addOrSet(
      'Fecha_Solicitud',
      payload?.fecha_solicitud || payload?.fecha || '',
      RTop(363, 148, 77, 11),
      textOptions
    );
    addOrSet('Consecutivo', payload?.consecutivo || '', RTop(486, 148, 74, 11), textOptions);
    addOrSet(
      'Mot_PracticaAc',
      motivo === 'practica' || motivo === 'practicaacademica' ? 'X' : '',
      RTop(122, 167, 39, 19),
      { wrap: false, size: 10, baselineAdjust: -2 }
    );
    addOrSet('Mot_Mantenim', motivo === 'mantenimiento' ? 'X' : '', RTop(204, 167, 42, 19), {
      wrap: false,
      size: 10,
      baselineAdjust: -2,
    });
    addOrSet('Mot_Investig', motivo === 'investigacion' ? 'X' : '', RTop(285, 167, 39, 19), {
      wrap: false,
      size: 10,
      baselineAdjust: -2,
    });
    addOrSet('Mot_Prestamo', motivo === 'prestamo' ? 'X' : '', RTop(363, 167, 40, 19), {
      wrap: false,
      size: 10,
      baselineAdjust: -2,
    });
    addOrSet('Mot_Garantia', motivo === 'garantia' ? 'X' : '', RTop(442, 167, 44, 19), {
      wrap: false,
      size: 10,
      baselineAdjust: -2,
    });
    addOrSet(
      'Mot_Otro',
      motivo === 'otro' || motivo === 'otros' ? 'X' : '',
      RTop(522, 167, 39, 19),
      { wrap: false, size: 10, baselineAdjust: -2 }
    );

    rows.forEach((rowTop, index) => {
      addOrSet(`Desc_${index + 1}`, desc[index] || '', RTop(49, rowTop, 196, 12), textOptions);
      addOrSet(`Placa_${index + 1}`, placa[index] || '', RTop(245, rowTop, 78, 12), textOptions);
      addOrSet(
        `FSalida_${index + 1}`,
        fSalida[index] || '',
        RTop(323, rowTop, 80, 12),
        textOptions
      );
      addOrSet(`FDevol_${index + 1}`, fDevol[index] || '', RTop(403, rowTop, 82, 12), textOptions);
      addOrSet(`Precio_${index + 1}`, precio[index] || '', RTop(485, rowTop, 76, 12), textOptions);
    });

    addOrSet(
      'Destino_Equipos',
      payload?.destino || payload?.destino_equipos || '',
      RTop(51, 358, 510, 10),
      textOptions
    );
    addOrSet(
      'Lugar_Reposa',
      payload?.lugar || payload?.lugar_resguardo || payload?.lugar_reposa || '',
      RTop(51, 385, 510, 10),
      textOptions
    );
    addOrSet(
      'Resp_Nombre',
      payload?.responsable_nombre || payload?.nombre_responsable || '',
      RTop(105, 419, 245, 10),
      textOptions
    );
    addOrSet(
      'Resp_Cedula',
      payload?.responsable_cedula || '',
      RTop(413, 419, 140, 10),
      textOptions
    );
    addOrSet(
      'Resp_Empresa',
      payload?.responsable_empresa || payload?.empresa || '',
      RTop(168, 432, 280, 10),
      textOptions
    );
    addOrSet(
      'Resp_Cargo',
      payload?.responsable_cargo || payload?.cargo || '',
      RTop(478, 432, 75, 10),
      textOptions
    );

    userRows.forEach((rowTop, index) => {
      addOrSet(`UNom_${index + 1}`, uNom[index] || '', RTop(50, rowTop, 194, 12), textOptions);
      addOrSet(`UCod_${index + 1}`, uCod[index] || '', RTop(246, rowTop, 76, 12), textOptions);
      addOrSet(`UCed_${index + 1}`, uCed[index] || '', RTop(324, rowTop, 78, 12), textOptions);
      addOrSet(`UCel_${index + 1}`, uCel[index] || '', RTop(403, rowTop, 81, 12), textOptions);
    });
  }

  form.updateFieldAppearances(helvetica);
  form.flatten();

  const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${responseFileName || archivo}"`);
  return res.send(Buffer.from(pdfBytes));
}

function hasManagementDocumentRole(req) {
  const roles = normalizeRoles(req.session?.user?.roles || req.session?.user?.tipo);
  return roles.some((role) => ['admin', 'laboratorista', 'coordinador'].includes(role));
}

async function fetchLoanDocumentRecord(req, loanId) {
  const usuario = await fetchSessionUsuario(req).catch(() => null);

  if (usuario?.id) {
    const ownResult = await pool.query(
      `
        SELECT
          sp.id,
          sp.usuario_id,
          sp.fecha_inicio,
          sp.fecha_fin,
          sp.justificacion_academica,
          sp.categoria_practica,
          sp.estado,
          sp.firma_digital,
          sp.fecha_firma,
          sp.fecha_creacion,
          e.codigo AS equipo_codigo,
          e.nombre AS equipo_nombre,
          e.laboratorio,
          COALESCE(e.facultad, f.nombre) AS facultad,
          u.nombre AS usuario_nombre,
          u.codigo AS usuario_codigo,
          u.documento AS usuario_documento,
          coord.nombre AS coordinador_nombre,
          coord.firma_digital AS firma_coordinador,
          ee.fecha_entrega,
          ee.fecha_devolucion_esperada,
          ee.fecha_devolucion_real,
          ee.condicion_entrega,
          ee.condicion_devolucion,
          ee.firma_digital AS entrega_firma_digital
        FROM solicitud_prestamo sp
        JOIN equipo e
          ON e.id = sp.equipo_id
        JOIN usuario u
          ON u.id = sp.usuario_id
        LEFT JOIN entrega_equipo ee
          ON ee.solicitud_prestamo_id = sp.id
        LEFT JOIN ual ul
          ON UPPER(ul.nombre) = UPPER(e.laboratorio)
        LEFT JOIN facultad f
          ON f.facultad_id = ul.facultad_id
        LEFT JOIN LATERAL (
          SELECT c.nombre, c.firma_digital
          FROM coordinador_facultad cf
          JOIN coordinador c
            ON c.documento = cf.coordinador_documento_id
          WHERE cf.facultad_id = f.facultad_id
            AND cf.activo = TRUE
            AND c.activo = TRUE
          ORDER BY c.fecha_firma DESC NULLS LAST, c.fecha_modificacion DESC NULLS LAST, c.documento ASC
          LIMIT 1
        ) coord
          ON TRUE
        WHERE sp.id = $1
          AND sp.usuario_id = $2
        LIMIT 1
      `,
      [loanId, usuario.id]
    );

    if (ownResult.rows.length) {
      return ownResult.rows[0];
    }
  }

  if (!hasManagementDocumentRole(req)) {
    return null;
  }

  const scope = await resolveLoanManagementScope(req);
  if (!scope.unrestricted && !scope.facultyIds.length) {
    return null;
  }

  const params = [loanId];
  const scopeClause = buildFacultyIdScopeClause('f.facultad_id', scope, params);
  const laboratoryClause = buildLaboratoryNameScopeClause('e.laboratorio', scope, params);
  const result = await pool.query(
    `
      SELECT
        sp.id,
        sp.usuario_id,
        sp.fecha_inicio,
        sp.fecha_fin,
        sp.justificacion_academica,
        sp.categoria_practica,
        sp.estado,
        sp.firma_digital,
        sp.fecha_firma,
        sp.firma_digital,
        sp.fecha_firma,
        sp.fecha_creacion,
        e.codigo AS equipo_codigo,
        e.nombre AS equipo_nombre,
        e.laboratorio,
        COALESCE(e.facultad, f.nombre) AS facultad,
        u.nombre AS usuario_nombre,
        u.codigo AS usuario_codigo,
        u.documento AS usuario_documento,
        coord.nombre AS coordinador_nombre,
        coord.firma_digital AS firma_coordinador,
        ee.fecha_entrega,
        ee.fecha_devolucion_esperada,
        ee.fecha_devolucion_real,
        ee.condicion_entrega,
        ee.condicion_devolucion,
        ee.firma_digital AS entrega_firma_digital
      FROM solicitud_prestamo sp
      JOIN equipo e
        ON e.id = sp.equipo_id
      JOIN usuario u
        ON u.id = sp.usuario_id
      LEFT JOIN entrega_equipo ee
        ON ee.solicitud_prestamo_id = sp.id
      LEFT JOIN ual ul
        ON UPPER(ul.nombre) = UPPER(e.laboratorio)
      LEFT JOIN facultad f
        ON f.facultad_id = ul.facultad_id
      LEFT JOIN LATERAL (
        SELECT c.nombre, c.firma_digital
        FROM coordinador_facultad cf
        JOIN coordinador c
          ON c.documento = cf.coordinador_documento_id
        WHERE cf.facultad_id = f.facultad_id
          AND cf.activo = TRUE
          AND c.activo = TRUE
        ORDER BY c.fecha_firma DESC NULLS LAST, c.fecha_modificacion DESC NULLS LAST, c.documento ASC
        LIMIT 1
      ) coord
        ON TRUE
      WHERE sp.id = $1
      ${scopeClause}
      ${laboratoryClause}
      LIMIT 1
    `,
    params
  );

  return result.rows[0] || null;
}

async function fetchPracticeDocumentRecord(req, reservationId) {
  const usuario = await fetchSessionUsuario(req).catch(() => null);

  if (usuario?.id) {
    const ownResult = await pool.query(
      `
        SELECT
          rp.id,
          rp.usuario_id,
          rp.fecha_inicio,
          rp.fecha_fin,
          rp.facultad,
          rp.laboratorio,
          rp.tipo_practica,
          rp.categoria_practica,
          rp.modalidad_libre,
          rp.estado,
          rp.justificacion,
          rp.formato_archivo,
          rp.formato_payload,
          rp.firma_digital,
          rp.fecha_firma,
          rp.fecha_creacion,
          s.nombre AS sala_nombre,
          CASE
            WHEN rp.tipo_practica = 'docente' THEN COALESCE(s.formato_practica_docente, 'DOC_PRACTICA_DOCENTE_SOLICITUD')
            ELSE COALESCE(s.formato_practica_libre, 'PL_REGLAMENTO_GENERAL')
          END AS formato_aplicado,
          u.nombre AS usuario_nombre,
          u.codigo AS usuario_codigo,
          u.documento AS usuario_documento,
          coord.nombre AS coordinador_nombre,
          coord.firma_digital AS firma_coordinador
        FROM reserva_practica rp
        JOIN usuario u
          ON u.id = rp.usuario_id
        LEFT JOIN sala s
          ON s.id = rp.sala_id
        LEFT JOIN facultad f
          ON UPPER(f.nombre) = UPPER(rp.facultad)
        LEFT JOIN LATERAL (
          SELECT c.nombre, c.firma_digital
          FROM coordinador_facultad cf
          JOIN coordinador c
            ON c.documento = cf.coordinador_documento_id
          WHERE cf.facultad_id = f.facultad_id
            AND cf.activo = TRUE
            AND c.activo = TRUE
          ORDER BY c.fecha_firma DESC NULLS LAST, c.fecha_modificacion DESC NULLS LAST, c.documento ASC
          LIMIT 1
        ) coord
          ON TRUE
        WHERE rp.id = $1
          AND rp.usuario_id = $2
        LIMIT 1
      `,
      [reservationId, usuario.id]
    );

    if (ownResult.rows.length) {
      return ownResult.rows[0];
    }
  }

  if (!hasManagementDocumentRole(req)) {
    return null;
  }

  const scope = await resolveLoanManagementScope(req);
  if (!scope.unrestricted && !scope.facultyIds.length) {
    return null;
  }

  const params = [reservationId];
  const scopeClause = buildFacultyNameScopeClause('rp.facultad', scope, params);
  const laboratoryClause = buildLaboratoryNameScopeClause('rp.laboratorio', scope, params);
  const result = await pool.query(
    `
      SELECT
        rp.id,
        rp.usuario_id,
        rp.fecha_inicio,
        rp.fecha_fin,
        rp.facultad,
        rp.laboratorio,
        rp.tipo_practica,
        rp.categoria_practica,
        rp.modalidad_libre,
        rp.estado,
        rp.justificacion,
        rp.formato_archivo,
        rp.formato_payload,
        rp.firma_digital,
        rp.fecha_firma,
        rp.fecha_creacion,
        s.nombre AS sala_nombre,
        CASE
          WHEN rp.tipo_practica = 'docente' THEN COALESCE(s.formato_practica_docente, 'DOC_PRACTICA_DOCENTE_SOLICITUD')
          ELSE COALESCE(s.formato_practica_libre, 'PL_REGLAMENTO_GENERAL')
        END AS formato_aplicado,
        u.nombre AS usuario_nombre,
        u.codigo AS usuario_codigo,
        u.documento AS usuario_documento,
        coord.nombre AS coordinador_nombre,
        coord.firma_digital AS firma_coordinador
      FROM reserva_practica rp
      JOIN usuario u
        ON u.id = rp.usuario_id
      LEFT JOIN sala s
        ON s.id = rp.sala_id
      LEFT JOIN facultad f
        ON UPPER(f.nombre) = UPPER(rp.facultad)
      LEFT JOIN LATERAL (
        SELECT c.nombre, c.firma_digital
        FROM coordinador_facultad cf
        JOIN coordinador c
          ON c.documento = cf.coordinador_documento_id
        WHERE cf.facultad_id = f.facultad_id
          AND cf.activo = TRUE
          AND c.activo = TRUE
        ORDER BY c.fecha_firma DESC NULLS LAST, c.fecha_modificacion DESC NULLS LAST, c.documento ASC
        LIMIT 1
      ) coord
        ON TRUE
      WHERE rp.id = $1
      ${scopeClause}
        ${laboratoryClause}
      LIMIT 1
    `,
    params
  );

  return result.rows[0] || null;
}

function sendLoanComprobantePdf(res, loan) {
  const doc = new PDFDocument({ margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Comprobante_Prestamo_${loan.id}.pdf"`);
  doc.pipe(res);

  drawLegacyTemplateHeader(doc, 'COMPROBANTE DE PRESTAMO DE EQUIPO');

  try {
    doc.font(PDF_FONT_REGULAR);
  } catch {
    // Keep PDF generation working even if the custom font is unavailable.
  }

  try {
    doc.font(PDF_FONT_BOLD);
  } catch {
    // Keep PDF generation working even if the custom font is unavailable.
  }
  doc.fontSize(12).text('Informacion del Solicitante:');
  try {
    doc.font(PDF_FONT_REGULAR);
  } catch {
    // Keep PDF generation working even if the custom font is unavailable.
  }
  doc.text(`Nombre: ${loan.usuario_nombre || '-'}`);
  doc.text(`Codigo: ${loan.usuario_codigo || '-'}`);
  doc.text(`Documento: ${loan.usuario_documento || '-'}`);
  doc.moveDown();

  try {
    doc.font(PDF_FONT_BOLD);
  } catch {
    // Keep PDF generation working even if the custom font is unavailable.
  }
  doc.text('Informacion del Equipo:');
  try {
    doc.font(PDF_FONT_REGULAR);
  } catch {
    // Keep PDF generation working even if the custom font is unavailable.
  }
  doc.text(`Equipo: ${loan.equipo_nombre || '-'}`);
  doc.text(`Codigo Inventario: ${loan.equipo_codigo || '-'}`);
  doc.moveDown();

  try {
    doc.font(PDF_FONT_BOLD);
  } catch {
    // Keep PDF generation working even if the custom font is unavailable.
  }
  doc.text('Detalles del Prestamo:');
  try {
    doc.font(PDF_FONT_REGULAR);
  } catch {
    // Keep PDF generation working even if the custom font is unavailable.
  }
  doc.text(`Fecha Inicio: ${formatPdfDateTime(loan.fecha_inicio)}`);
  doc.text(`Fecha Fin (Devolucion): ${formatPdfDateTime(loan.fecha_fin)}`);
  doc.text(`Justificacion: ${loan.justificacion_academica || '-'}`);
  doc.moveDown(2);

  try {
    doc.font(PDF_FONT_REGULAR);
  } catch {
    // Keep PDF generation working even if the custom font is unavailable.
  }
  doc
    .fontSize(10)
    .text(
      'Declaro que recibo el equipo descrito en perfectas condiciones de funcionamiento y me hago responsable por su cuidado y devolucion en la fecha establecida. Acepto el reglamento de prestamos de laboratorio.',
      { align: 'justify' }
    );
  doc.moveDown(2);

  const studentSignature = loan.firma_digital || loan.entrega_firma_digital || null;
  const coordinatorLabel = loan.facultad
    ? `Firma del Coordinador de Laboratorio - ${loan.facultad}`
    : 'Firma del Coordinador de Laboratorio';

  drawPdfSignatureBlock(
    doc,
    'Firma del Estudiante/Solicitante',
    studentSignature,
    coordinatorLabel,
    loan.firma_coordinador,
    {
      leftFooter: loan.fecha_firma ? `Firmado el: ${formatPdfDateTime(loan.fecha_firma)}` : '',
    }
  );

  doc.end();
}

function sendLoanReglamentoPdf(res, loan) {
  const doc = new PDFDocument({ margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Reglamento_Prestamo_${loan.id}.pdf"`);
  doc.pipe(res);

  drawLegacyTemplateHeader(doc, 'FORMATO DE ACEPTACION DEL REGLAMENTO DE LABORATORIOS');

  try {
    doc.font(PDF_FONT_REGULAR);
  } catch {
    // Keep PDF generation working even if the custom font is unavailable.
  }
  doc
    .fontSize(10)
    .fill('#5f6368')
    .text(`Solicitud #${loan.id} - Creada ${formatPdfDateTime(loan.fecha_creacion)}`, {
      align: 'center',
    });
  doc.moveDown(1);

  drawPdfBulletList(doc, [
    '1. El usuario es responsable del equipo desde el momento en que lo recibe hasta que lo entrega.',
    '2. El equipo debe ser devuelto en las mismas condiciones en que fue entregado.',
    '3. Cualquier dano o perdida sera responsabilidad del usuario.',
    '4. El prestamo es personal e intransferible.',
    '5. El incumplimiento en la fecha de entrega puede generar sanciones.',
    '6. El equipo debe utilizarse exclusivamente para fines academicos.',
  ]);

  drawPdfSection(doc, 'Informacion del Solicitante', [
    `Nombre: ${loan.usuario_nombre || '-'}`,
    `Codigo: ${loan.usuario_codigo || '-'}`,
    `Documento: ${loan.usuario_documento || '-'}`,
    `Equipo solicitado: ${loan.equipo_nombre || '-'} (${loan.equipo_codigo || '-'})`,
  ]);

  drawPdfParagraph(
    doc,
    'He leido, comprendido y aceptado los terminos del presente reglamento para el uso de equipos y recursos del laboratorio.'
  );

  drawPdfSignatureBlock(
    doc,
    'Firma digital del solicitante',
    loan.firma_digital,
    'Firma del coordinador',
    loan.firma_coordinador
  );

  doc.end();
}

function sendLoanGeneralReglamentoPdf(res) {
  const doc = new PDFDocument({ margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="Formato_Aceptacion_Reglamento.pdf"');
  doc.pipe(res);

  drawLegacyTemplateHeader(doc, 'Formato de Aceptacion del Reglamento de Laboratorios');

  try {
    doc.font(PDF_FONT_REGULAR);
  } catch {
    // Keep PDF generation working even if the custom font is unavailable.
  }

  doc.fontSize(12);
  doc.text(
    '1. El usuario es responsable del equipo desde el momento en que lo recibe hasta que lo entrega.'
  );
  doc.moveDown();
  doc.text('2. El equipo debe ser devuelto en las mismas condiciones en que fue entregado.');
  doc.moveDown();
  doc.text(
    '3. Cualquier dano o perdida sera responsabilidad del usuario, quien debera reponer el equipo o pagar su valor.'
  );
  doc.moveDown();
  doc.text('4. El prestamo es personal e intransferible.');
  doc.moveDown();
  doc.text(
    '5. El incumplimiento en la fecha de entrega generara una sancion y bloqueo en el sistema.'
  );
  doc.moveDown();
  doc.text('6. El equipo debe ser utilizado exclusivamente para fines academicos.');
  doc.moveDown();
  doc.moveDown(2);
  doc.fontSize(10).text('Este documento es una copia informativa del reglamento vigente.', {
    align: 'center',
  });
  doc.end();
}

function sendPracticeComprobantePdf(res, reservation) {
  const formato = getPracticePdfFormat(reservation.formato_aplicado);
  const doc = new PDFDocument({ margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="Comprobante_Practica_${reservation.id}.pdf"`
  );
  doc.pipe(res);

  drawPdfHeader(
    doc,
    formato.tituloComprobante || 'COMPROBANTE DE RESERVA DE PRACTICA',
    `Reserva #${reservation.id} - Generado ${formatPdfDateTime(new Date())}`
  );

  drawPdfSection(doc, 'Informacion del Solicitante', [
    `Nombre: ${reservation.usuario_nombre || '-'}`,
    `Codigo: ${reservation.usuario_codigo || '-'}`,
    `Documento: ${reservation.usuario_documento || '-'}`,
  ]);

  drawPdfSection(doc, 'Detalles de la Reserva', [
    `Estado: ${reservation.estado || '-'}`,
    `Tipo de practica: ${reservation.tipo_practica || '-'}`,
    `Categoria: ${reservation.categoria_practica || '-'}`,
    `Modalidad libre: ${reservation.modalidad_libre || 'No aplica'}`,
    `Facultad: ${reservation.facultad || '-'}`,
    `Laboratorio: ${reservation.laboratorio || '-'}`,
    `Sala: ${reservation.sala_nombre || 'Sin sala asignada'}`,
    `Fecha inicio: ${formatPdfDateTime(reservation.fecha_inicio)}`,
    `Fecha fin: ${formatPdfDateTime(reservation.fecha_fin)}`,
    `Formato aplicado: ${reservation.formato_aplicado || '-'}`,
  ]);

  drawPdfSection(doc, 'Justificacion', [reservation.justificacion || '-']);
  drawPdfParagraph(doc, formato.declaracionComprobante);
  drawPdfSignatureBlock(
    doc,
    'Firma digital del solicitante',
    reservation.firma_digital,
    'Firma del coordinador',
    reservation.firma_coordinador
  );

  doc.end();
}

async function sendPracticeInstitutionalReglamentoPdf(res, reservation) {
  const payload = buildPracticeInstitutionalFormatPayload(reservation);
  return renderInstitutionalFormatPdf(
    res,
    reservation.formato_archivo,
    payload,
    `Reglamento_Practica_${reservation.id}.pdf`
  );
}

function sendPracticeReglamentoPdf(res, reservation) {
  const formato = getPracticePdfFormat(reservation.formato_aplicado);
  const doc = new PDFDocument({ margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="Reglamento_Practica_${reservation.id}.pdf"`
  );
  doc.pipe(res);

  drawLegacyTemplateHeader(
    doc,
    formato.tituloReglamento || 'FORMATO DE ACEPTACION DEL REGLAMENTO DE LABORATORIOS'
  );

  try {
    doc.font(PDF_FONT_REGULAR);
  } catch {
    // Keep PDF generation working even if the custom font is unavailable.
  }
  doc
    .fontSize(10)
    .fill('#5f6368')
    .text(`Reserva #${reservation.id} - Creada ${formatPdfDateTime(reservation.fecha_creacion)}`, {
      align: 'center',
    });
  doc.moveDown(1);

  drawPdfBulletList(doc, formato.reglamentoItems || []);

  drawPdfSection(doc, 'Informacion del Solicitante', [
    `Nombre: ${reservation.usuario_nombre || '-'}`,
    `Codigo: ${reservation.usuario_codigo || '-'}`,
    `Documento: ${reservation.usuario_documento || '-'}`,
    `Laboratorio: ${reservation.laboratorio || '-'}`,
    `Sala: ${reservation.sala_nombre || 'Sin sala asignada'}`,
    `Horario: ${formatPdfDateTime(reservation.fecha_inicio)} a ${formatPdfDateTime(reservation.fecha_fin)}`,
  ]);

  drawPdfParagraph(
    doc,
    formato.textoAceptacion ||
      'He leido, comprendido y aceptado los terminos del presente reglamento.'
  );

  drawPdfSignatureBlock(
    doc,
    'Firma digital del solicitante',
    reservation.firma_digital,
    'Firma del coordinador',
    reservation.firma_coordinador
  );

  doc.end();
}

async function fetchLoanReportsViewData(scope, range) {
  const fechaInicio = range.fechaInicio;
  const fechaFin = range.fechaFin;

  const equipmentParams = [];
  const equipmentScopeClause = buildFacultyNameScopeClause('e.facultad', scope, equipmentParams);
  const equipmentLaboratoryClause = buildLaboratoryNameScopeClause(
    'e.laboratorio',
    scope,
    equipmentParams
  );
  const [equiposResult] = await Promise.all([
    pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM equipo e
        WHERE 1 = 1
        ${equipmentScopeClause}
        ${equipmentLaboratoryClause}
      `,
      equipmentParams
    ),
  ]);

  const solicitudActivasParams = [];
  const solicitudActivasScopeClause = buildFacultyNameScopeClause(
    'e.facultad',
    scope,
    solicitudActivasParams
  );
  const solicitudActivasLaboratoryClause = buildLaboratoryNameScopeClause(
    'e.laboratorio',
    scope,
    solicitudActivasParams
  );
  const solicitudesActivasPromise = pool.query(
    `
      SELECT COUNT(*)::int AS total
      FROM solicitud_prestamo sp
      JOIN equipo e ON e.id = sp.equipo_id
      WHERE sp.estado = 'activo'
      ${solicitudActivasScopeClause}
      ${solicitudActivasLaboratoryClause}
    `,
    solicitudActivasParams
  );

  const solicitudPendientesParams = [];
  const solicitudPendientesScopeClause = buildFacultyNameScopeClause(
    'e.facultad',
    scope,
    solicitudPendientesParams
  );
  const solicitudPendientesLaboratoryClause = buildLaboratoryNameScopeClause(
    'e.laboratorio',
    scope,
    solicitudPendientesParams
  );
  const solicitudesPendientesPromise = pool.query(
    `
      SELECT COUNT(*)::int AS total
      FROM solicitud_prestamo sp
      JOIN equipo e ON e.id = sp.equipo_id
      WHERE sp.estado IN ('pendiente', 'en_cola', 'aprobado')
      ${solicitudPendientesScopeClause}
      ${solicitudPendientesLaboratoryClause}
    `,
    solicitudPendientesParams
  );

  const practicasActivasParams = [];
  const practicasActivasScopeClause = buildFacultyNameScopeClause(
    'rp.facultad',
    scope,
    practicasActivasParams
  );
  const practicasActivasLaboratoryClause = buildLaboratoryNameScopeClause(
    'rp.laboratorio',
    scope,
    practicasActivasParams
  );
  const practicasActivasPromise = pool.query(
    `
      SELECT COUNT(*)::int AS total
      FROM reserva_practica rp
      WHERE rp.estado IN ('aprobada', 'activa', 'iniciada')
      ${practicasActivasScopeClause}
      ${practicasActivasLaboratoryClause}
    `,
    practicasActivasParams
  );

  const incidenciasAbiertasParams = [];
  const incidenciasAbiertasScopeClause = buildFacultyNameScopeClause(
    'e.facultad',
    scope,
    incidenciasAbiertasParams
  );
  const incidenciasAbiertasLaboratoryClause = buildLaboratoryNameScopeClause(
    'e.laboratorio',
    scope,
    incidenciasAbiertasParams
  );
  const incidenciasAbiertasPromise = pool.query(
    `
      SELECT COUNT(*)::int AS total
      FROM incidencia i
      JOIN equipo e ON e.id = i.equipo_id
      WHERE i.estado <> 'cerrada'
      ${incidenciasAbiertasScopeClause}
      ${incidenciasAbiertasLaboratoryClause}
    `,
    incidenciasAbiertasParams
  );

  const salasActivasParams = [];
  const salasActivasScopeClause = buildFacultyIdScopeClause(
    'u.facultad_id',
    scope,
    salasActivasParams
  );
  const salasActivasLaboratoryClause = buildLaboratoryNameScopeClause(
    'u.nombre',
    scope,
    salasActivasParams
  );
  const salasActivasPromise = pool.query(
    `
      SELECT COUNT(*)::int AS total
      FROM sala s
      JOIN ual u ON u.ual_id = s.ual_id
      WHERE s.activo = TRUE
      ${salasActivasScopeClause}
      ${salasActivasLaboratoryClause}
    `,
    salasActivasParams
  );

  const solicitudesEstadoParams = [fechaInicio, fechaFin];
  const solicitudesEstadoScopeClause = buildFacultyNameScopeClause(
    'e.facultad',
    scope,
    solicitudesEstadoParams
  );
  const solicitudesEstadoLaboratoryClause = buildLaboratoryNameScopeClause(
    'e.laboratorio',
    scope,
    solicitudesEstadoParams
  );
  const solicitudesPorEstadoPromise = pool.query(
    `
      SELECT sp.estado, COUNT(*)::int AS cantidad
      FROM solicitud_prestamo sp
      JOIN equipo e ON e.id = sp.equipo_id
      WHERE sp.fecha_inicio >= $1::date
        AND sp.fecha_inicio < ($2::date + INTERVAL '1 day')
        ${solicitudesEstadoScopeClause}
        ${solicitudesEstadoLaboratoryClause}
      GROUP BY sp.estado
      ORDER BY cantidad DESC, sp.estado ASC
    `,
    solicitudesEstadoParams
  );

  const practicasEstadoParams = [fechaInicio, fechaFin];
  const practicasEstadoScopeClause = buildFacultyNameScopeClause(
    'rp.facultad',
    scope,
    practicasEstadoParams
  );
  const practicasEstadoLaboratoryClause = buildLaboratoryNameScopeClause(
    'rp.laboratorio',
    scope,
    practicasEstadoParams
  );
  const practicasPorEstadoPromise = pool.query(
    `
      SELECT rp.estado, COUNT(*)::int AS cantidad
      FROM reserva_practica rp
      WHERE rp.fecha_inicio >= $1::date
        AND rp.fecha_inicio < ($2::date + INTERVAL '1 day')
        ${practicasEstadoScopeClause}
        ${practicasEstadoLaboratoryClause}
      GROUP BY rp.estado
      ORDER BY cantidad DESC, rp.estado ASC
    `,
    practicasEstadoParams
  );

  const incidenciasEstadoParams = [fechaInicio, fechaFin];
  const incidenciasEstadoScopeClause = buildFacultyNameScopeClause(
    'e.facultad',
    scope,
    incidenciasEstadoParams
  );
  const incidenciasEstadoLaboratoryClause = buildLaboratoryNameScopeClause(
    'e.laboratorio',
    scope,
    incidenciasEstadoParams
  );
  const incidenciasPorEstadoPromise = pool.query(
    `
      SELECT i.estado, COUNT(*)::int AS cantidad
      FROM incidencia i
      JOIN equipo e ON e.id = i.equipo_id
      WHERE i.fecha_creacion >= $1::date
        AND i.fecha_creacion < ($2::date + INTERVAL '1 day')
        ${incidenciasEstadoScopeClause}
        ${incidenciasEstadoLaboratoryClause}
      GROUP BY i.estado
      ORDER BY cantidad DESC, i.estado ASC
    `,
    incidenciasEstadoParams
  );

  const solicitudesMesParams = [fechaInicio, fechaFin];
  const solicitudesMesScopeClause = buildFacultyNameScopeClause(
    'e.facultad',
    scope,
    solicitudesMesParams
  );
  const solicitudesMesLaboratoryClause = buildLaboratoryNameScopeClause(
    'e.laboratorio',
    scope,
    solicitudesMesParams
  );
  const solicitudesPorMesPromise = pool.query(
    `
      SELECT
        TO_CHAR(DATE_TRUNC('month', sp.fecha_inicio), 'YYYY-MM') AS periodo,
        COUNT(*)::int AS cantidad
      FROM solicitud_prestamo sp
      JOIN equipo e ON e.id = sp.equipo_id
      WHERE sp.fecha_inicio >= $1::date
        AND sp.fecha_inicio < ($2::date + INTERVAL '1 day')
        ${solicitudesMesScopeClause}
        ${solicitudesMesLaboratoryClause}
      GROUP BY DATE_TRUNC('month', sp.fecha_inicio)
      ORDER BY DATE_TRUNC('month', sp.fecha_inicio) ASC
    `,
    solicitudesMesParams
  );

  const practicasMesParams = [fechaInicio, fechaFin];
  const practicasMesScopeClause = buildFacultyNameScopeClause(
    'rp.facultad',
    scope,
    practicasMesParams
  );
  const practicasMesLaboratoryClause = buildLaboratoryNameScopeClause(
    'rp.laboratorio',
    scope,
    practicasMesParams
  );
  const practicasPorMesPromise = pool.query(
    `
      SELECT
        TO_CHAR(DATE_TRUNC('month', rp.fecha_inicio), 'YYYY-MM') AS periodo,
        COUNT(*)::int AS cantidad
      FROM reserva_practica rp
      WHERE rp.fecha_inicio >= $1::date
        AND rp.fecha_inicio < ($2::date + INTERVAL '1 day')
        ${practicasMesScopeClause}
        ${practicasMesLaboratoryClause}
      GROUP BY DATE_TRUNC('month', rp.fecha_inicio)
      ORDER BY DATE_TRUNC('month', rp.fecha_inicio) ASC
    `,
    practicasMesParams
  );

  const equiposTopParams = [fechaInicio, fechaFin];
  const equiposTopScopeClause = buildFacultyNameScopeClause('e.facultad', scope, equiposTopParams);
  const equiposTopLaboratoryClause = buildLaboratoryNameScopeClause(
    'e.laboratorio',
    scope,
    equiposTopParams
  );
  const equiposTopPromise = pool.query(
    `
      SELECT
        e.nombre,
        e.codigo,
        COUNT(*)::int AS cantidad
      FROM solicitud_prestamo sp
      JOIN equipo e ON e.id = sp.equipo_id
      WHERE sp.fecha_inicio >= $1::date
        AND sp.fecha_inicio < ($2::date + INTERVAL '1 day')
        ${equiposTopScopeClause}
        ${equiposTopLaboratoryClause}
      GROUP BY e.id, e.nombre, e.codigo
      ORDER BY cantidad DESC, e.nombre ASC
      LIMIT 5
    `,
    equiposTopParams
  );

  const salasTopParams = [fechaInicio, fechaFin];
  const salasTopScopeClause = buildFacultyIdScopeClause('u.facultad_id', scope, salasTopParams);
  const salasTopLaboratoryClause = buildLaboratoryNameScopeClause(
    'u.nombre',
    scope,
    salasTopParams
  );
  const salasTopPromise = pool.query(
    `
      SELECT
        s.nombre,
        COUNT(*)::int AS cantidad
      FROM reserva_practica rp
      JOIN sala s ON s.id = rp.sala_id
      JOIN ual u ON u.ual_id = s.ual_id
      WHERE rp.fecha_inicio >= $1::date
        AND rp.fecha_inicio < ($2::date + INTERVAL '1 day')
        ${salasTopScopeClause}
        ${salasTopLaboratoryClause}
      GROUP BY s.id, s.nombre
      ORDER BY cantidad DESC, s.nombre ASC
      LIMIT 5
    `,
    salasTopParams
  );

  const [
    solicitudesActivasResult,
    solicitudesPendientesResult,
    practicasActivasResult,
    incidenciasAbiertasResult,
    salasActivasResult,
    solicitudesPorEstadoResult,
    practicasPorEstadoResult,
    incidenciasPorEstadoResult,
    solicitudesPorMesResult,
    practicasPorMesResult,
    equiposTopResult,
    salasTopResult,
  ] = await Promise.all([
    solicitudesActivasPromise,
    solicitudesPendientesPromise,
    practicasActivasPromise,
    incidenciasAbiertasPromise,
    salasActivasPromise,
    solicitudesPorEstadoPromise,
    practicasPorEstadoPromise,
    incidenciasPorEstadoPromise,
    solicitudesPorMesPromise,
    practicasPorMesPromise,
    equiposTopPromise,
    salasTopPromise,
  ]);

  return {
    filters: {
      fecha_inicio: fechaInicio,
      fecha_fin: fechaFin,
    },
    stats: {
      equipos: Number(equiposResult.rows[0]?.total || 0),
      solicitudes_activas: Number(solicitudesActivasResult.rows[0]?.total || 0),
      solicitudes_pendientes: Number(solicitudesPendientesResult.rows[0]?.total || 0),
      practicas_activas: Number(practicasActivasResult.rows[0]?.total || 0),
      incidencias_abiertas: Number(incidenciasAbiertasResult.rows[0]?.total || 0),
      salas_activas: Number(salasActivasResult.rows[0]?.total || 0),
    },
    solicitudesPorEstado: solicitudesPorEstadoResult.rows || [],
    practicasPorEstado: practicasPorEstadoResult.rows || [],
    incidenciasPorEstado: incidenciasPorEstadoResult.rows || [],
    solicitudesPorMes: solicitudesPorMesResult.rows || [],
    practicasPorMes: practicasPorMesResult.rows || [],
    equiposTop: equiposTopResult.rows || [],
    salasTop: salasTopResult.rows || [],
  };
}

async function fetchManagedLoanRequest(id, scope) {
  if (!scope?.unrestricted && (!scope?.facultyIds || !scope.facultyIds.length)) {
    return null;
  }

  const params = [id];
  const facultyCondition = scope?.unrestricted ? '' : 'AND f.facultad_id = ANY($2::int[])';

  if (!scope?.unrestricted) {
    params.push(scope.facultyIds);
  }

  const laboratoryCondition = buildLaboratoryNameScopeClause('e.laboratorio', scope, params);

  const result = await pool.query(
    `
      SELECT
        sp.id,
        sp.usuario_id,
        sp.equipo_id,
        sp.fecha_inicio,
        sp.fecha_fin,
        sp.justificacion_academica,
        sp.categoria_practica,
        sp.estado,
        sp.tipo_aprobacion,
        sp.motivo_rechazo,
        e.codigo AS equipo_codigo,
        e.nombre AS equipo_nombre,
        e.laboratorio,
        COALESCE(e.facultad, f.nombre) AS facultad,
        f.facultad_id
      FROM solicitud_prestamo sp
      JOIN equipo e
        ON e.id = sp.equipo_id
      LEFT JOIN ual u
        ON UPPER(u.nombre) = UPPER(e.laboratorio)
      LEFT JOIN facultad f
        ON f.facultad_id = u.facultad_id
      WHERE sp.id = $1
        ${facultyCondition}
        ${laboratoryCondition}
      LIMIT 1
    `,
    params
  );

  return result.rows[0] || null;
}

async function fetchManagedDeliveryLoanRequest(id, scope) {
  if (!scope?.unrestricted && (!scope?.facultyIds || !scope.facultyIds.length)) {
    return null;
  }
  const params = [id];
  const facultyCondition = scope?.unrestricted ? '' : 'AND f.facultad_id = ANY($2::int[])';

  if (!scope?.unrestricted) {
    params.push(scope.facultyIds);
  }

  const laboratoryCondition = buildLaboratoryNameScopeClause('e.laboratorio', scope, params);

  const result = await pool.query(
    `
      SELECT
        sp.id,
        sp.usuario_id,
        sp.equipo_id,
        sp.fecha_inicio,
        sp.fecha_fin,
        sp.justificacion_academica,
        sp.categoria_practica,
        sp.estado,
        sp.tipo_aprobacion,
        sp.firma_digital,
        e.codigo AS equipo_codigo,
        e.nombre AS equipo_nombre,
        e.laboratorio,
        e.estado AS equipo_estado,
        EXISTS (
          SELECT 1
          FROM incidencia i
          WHERE i.equipo_id = e.id
            AND i.estado <> 'cerrada'
        ) AS incidencia_activa,
        COALESCE(e.facultad, f.nombre) AS facultad,
        f.facultad_id,
        ee.id AS entrega_id,
        ee.fecha_entrega,
        ee.fecha_devolucion_esperada,
        ee.condicion_entrega,
        ee.fecha_devolucion_real,
        ee.condicion_devolucion,
        ee.lista_componentes
      FROM solicitud_prestamo sp
      JOIN equipo e
        ON e.id = sp.equipo_id
      LEFT JOIN entrega_equipo ee
        ON ee.solicitud_prestamo_id = sp.id
      LEFT JOIN ual u
        ON UPPER(u.nombre) = UPPER(e.laboratorio)
      LEFT JOIN facultad f
        ON f.facultad_id = u.facultad_id
      WHERE sp.id = $1
        ${facultyCondition}
        ${laboratoryCondition}
      LIMIT 1
    `,
    params
  );

  return result.rows[0] || null;
}

async function fetchManagedIncident(id, scope) {
  if (!scope?.unrestricted && (!scope?.facultyIds || !scope.facultyIds.length)) {
    return null;
  }
  const params = [id];
  const facultyCondition = scope?.unrestricted ? '' : 'AND f.facultad_id = ANY($2::int[])';

  if (!scope?.unrestricted) {
    params.push(scope.facultyIds);
  }

  const laboratoryCondition = buildLaboratoryNameScopeClause('e.laboratorio', scope, params);

  const result = await pool.query(
    `
      SELECT
        i.id,
        i.equipo_id,
        i.solicitud_prestamo_id,
        i.entrega_equipo_id,
        i.tipo_incidencia,
        i.descripcion,
        i.estado,
        i.descripcion_cierre,
        i.sancion_tipo,
        i.sancion_detalle,
        i.evidencia_mime,
        CASE WHEN i.evidencia_foto IS NOT NULL THEN TRUE ELSE FALSE END AS tiene_evidencia,
        e.estado AS equipo_estado,
        e.laboratorio,
        sp.estado AS solicitud_estado,
        COALESCE(e.facultad, f.nombre) AS facultad,
        f.facultad_id
      FROM incidencia i
      JOIN equipo e
        ON e.id = i.equipo_id
      LEFT JOIN solicitud_prestamo sp
        ON sp.id = i.solicitud_prestamo_id
      LEFT JOIN ual u
        ON UPPER(u.nombre) = UPPER(e.laboratorio)
      LEFT JOIN facultad f
        ON f.facultad_id = u.facultad_id
      WHERE i.id = $1
        ${facultyCondition}
        ${laboratoryCondition}
      LIMIT 1
    `,
    params
  );

  return result.rows[0] || null;
}

async function fetchManagedPracticeReservation(id, scope) {
  if (!scope?.unrestricted && (!scope?.facultyIds || !scope?.facultyIds.length)) {
    return null;
  }

  const params = [id];
  const facultyCondition = scope?.unrestricted ? '' : 'AND f.facultad_id = ANY($2::int[])';

  if (!scope?.unrestricted) {
    params.push(scope.facultyIds);
  }

  const laboratoryCondition = buildLaboratoryNameScopeClause('rp.laboratorio', scope, params);

  const result = await pool.query(
    `
      SELECT
        rp.id,
        rp.usuario_id,
        rp.sala_id,
        rp.fecha_inicio,
        rp.fecha_fin,
        rp.laboratorio,
        rp.facultad,
        rp.tipo_practica,
        rp.categoria_practica,
        rp.modalidad_libre,
        rp.estado,
        rp.justificacion,
        rp.formato_archivo,
        rp.formato_payload,
        rp.firma_digital,
        rp.motivo_rechazo,
        CASE
          WHEN rp.tipo_practica = 'docente' THEN COALESCE(s.formato_practica_docente, 'DOC_PRACTICA_DOCENTE_SOLICITUD')
          ELSE COALESCE(s.formato_practica_libre, 'PL_REGLAMENTO_GENERAL')
        END AS formato_aplicado,
        s.nombre AS sala_nombre,
        s.capacidad AS sala_capacidad,
        u.nombre AS usuario_nombre,
        u.documento AS usuario_documento,
        u.correo AS usuario_correo,
        f.facultad_id
      FROM reserva_practica rp
      JOIN usuario u
        ON u.id = rp.usuario_id
      LEFT JOIN sala s
        ON s.id = rp.sala_id
      LEFT JOIN facultad f
        ON UPPER(f.nombre) = UPPER(rp.facultad)
      WHERE rp.id = $1
        ${facultyCondition}
        ${laboratoryCondition}
      LIMIT 1
    `,
    params
  );

  return result.rows[0] || null;
}

async function resolveManagedUal(payload, scope) {
  if (!scope?.unrestricted && (!scope?.facultyIds || !scope.facultyIds.length)) {
    return null;
  }

  const params = [payload.facultad, payload.laboratorio];
  const facultyCondition = scope?.unrestricted ? '' : 'AND f.facultad_id = ANY($3::int[])';

  if (!scope?.unrestricted) {
    params.push(scope.facultyIds);
  }

  const result = await pool.query(
    `
      SELECT u.ual_id, u.nombre AS laboratorio, f.nombre AS facultad, f.facultad_id
      FROM ual u
      JOIN facultad f ON f.facultad_id = u.facultad_id
      WHERE UPPER(f.nombre) = UPPER($1::text)
        AND UPPER(u.nombre) = UPPER($2::text)
        ${facultyCondition}
      LIMIT 1
    `,
    params
  );

  return result.rows[0] || null;
}

async function fetchManagedUalById(ualId, scope) {
  if (!Number.isInteger(Number(ualId)) || Number(ualId) <= 0) {
    return null;
  }

  if (!scope?.unrestricted && (!scope?.facultyIds || !scope.facultyIds.length)) {
    return null;
  }

  const params = [Number(ualId)];
  const whereParts = ['u.ual_id = $1'];

  if (!scope.unrestricted) {
    params.push(scope.facultyIds);
    whereParts.push(`f.facultad_id = ANY($${params.length}::int[])`);
  }

  if (
    scope.restrictToLaboratories &&
    Array.isArray(scope.laboratoryNames) &&
    scope.laboratoryNames.length
  ) {
    params.push(scope.laboratoryNames);
    whereParts.push(`UPPER(u.nombre) = ANY($${params.length}::text[])`);
  }

  const result = await pool.query(
    `
      SELECT
        u.ual_id,
        u.nombre AS laboratorio,
        f.nombre AS facultad,
        f.facultad_id
      FROM ual u
      JOIN facultad f ON f.facultad_id = u.facultad_id
      WHERE ${whereParts.join(' AND ')}
      LIMIT 1
    `,
    params
  );

  return result.rows[0] || null;
}

async function fetchPracticeRoomAvailability(payload, scope) {
  const managedUal = await resolveManagedUal(payload, scope);

  if (!managedUal?.ual_id) {
    return [];
  }

  const fechaInicio = parseBogotaDateTime(payload.fecha_inicio);
  const fechaFin = parseBogotaDateTime(payload.fecha_fin);
  const salasColumns = await fetchTableColumns('sala');
  const equiposSelect = salasColumns.has('equipos_nombres') ? 's.equipos_nombres' : 'NULL::text';

  if (
    !fechaInicio ||
    !fechaFin ||
    Number.isNaN(fechaInicio.getTime()) ||
    Number.isNaN(fechaFin.getTime())
  ) {
    return [];
  }

  const requestedDate = payload.fecha_inicio.slice(0, 10);
  const requestedStartTime = payload.fecha_inicio.slice(11, 16);
  const requestedEndTime = payload.fecha_fin.slice(11, 16);
  const requestedDay = fechaInicio.getDay();

  const result = await pool.query(
    `
      SELECT
        s.id,
        s.nombre,
        s.tipo_espacio,
        s.capacidad,
        s.descripcion,
        ${equiposSelect} AS equipos_nombres,
        s.permite_practica_libre,
        s.permite_practica_docente,
        s.formato_practica_libre,
        s.formato_practica_docente,
        hs.modalidad_libre,
        COALESCE(occ.total_reservas, 0) AS total_reservas
      FROM sala s
      JOIN horario_sala hs
        ON hs.sala_id = s.id
       AND hs.activo = TRUE
       AND (
         hs.fecha = $2::date OR
         (hs.fecha IS NULL AND hs.dia_semana = $3)
       )
       AND hs.tipo_practica = $6::text
       AND hs.hora_inicio <= $4::time
       AND hs.hora_fin >= $5::time
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS total_reservas
        FROM reserva_practica rp
        WHERE rp.sala_id = s.id
          AND rp.estado IN ('pendiente', 'por_aprobacion', 'con_comentarios', 'aprobada', 'activa', 'iniciada')
          AND rp.fecha_inicio < $8
          AND rp.fecha_fin > $7
      ) occ ON TRUE
      WHERE s.ual_id = $1
        AND s.activo = TRUE
        AND (
          ($6::text = 'docente' AND s.permite_practica_docente = TRUE) OR
          ($6::text = 'libre' AND s.permite_practica_libre = TRUE)
        )
      ORDER BY s.nombre ASC
    `,
    [
      managedUal.ual_id,
      requestedDate,
      requestedDay,
      requestedStartTime,
      requestedEndTime,
      payload.tipo_practica,
      fechaInicio,
      fechaFin,
    ]
  );

  return (result.rows || [])
    .map((row) => ({
      ...row,
      cupos_disponibles: Math.max(0, Number(row.capacidad || 0) - Number(row.total_reservas || 0)),
      formato_requerido:
        payload.tipo_practica === 'docente'
          ? row.formato_practica_docente || 'DOC_PRACTICA_DOCENTE_SOLICITUD'
          : row.formato_practica_libre || 'PL_REGLAMENTO_GENERAL',
    }))
    .filter((row) => row.cupos_disponibles > 0);
}

async function fetchPracticeRoomAvailabilityByDate(payload, scope) {
  const managedUal = await resolveManagedUal(payload, scope);

  if (!managedUal?.ual_id) {
    return [];
  }

  const requestedDate = String(payload.fecha || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    return [];
  }

  const requestedDateValue = new Date(`${requestedDate}T00:00:00`);
  if (Number.isNaN(requestedDateValue.getTime())) {
    return [];
  }

  const salasColumns = await fetchTableColumns('sala');
  const equiposSelect = salasColumns.has('equipos_nombres') ? 's.equipos_nombres' : 'NULL::text';
  const requestedDay = requestedDateValue.getDay();
  const roomResult = await pool.query(
    `
      SELECT
        s.id,
        s.nombre,
        s.tipo_espacio,
        s.capacidad,
        s.descripcion,
        ${equiposSelect} AS equipos_nombres,
        s.permite_practica_libre,
        s.permite_practica_docente,
        s.formato_practica_libre,
        s.formato_practica_docente
      FROM sala s
      WHERE s.ual_id = $1
        AND s.activo = TRUE
        AND (
          ($2::text = 'docente' AND s.permite_practica_docente = TRUE) OR
          ($2::text = 'libre' AND s.permite_practica_libre = TRUE)
        )
      ORDER BY s.nombre ASC
    `,
    [managedUal.ual_id, payload.tipo_practica]
  );

  const results = [];

  for (const room of roomResult.rows || []) {
    const scheduleResult = await pool.query(
      `
        SELECT
          hs.hora_inicio,
          hs.hora_fin,
          hs.tipo_practica,
          hs.modalidad_libre
        FROM horario_sala hs
        WHERE hs.sala_id = $1
          AND hs.activo = TRUE
          AND hs.tipo_practica = $4
          AND (
            hs.fecha = $2::date OR
            (
              hs.fecha IS NULL AND
              hs.dia_semana = $3 AND
              NOT EXISTS (
                SELECT 1
                FROM horario_sala h2
                WHERE h2.sala_id = $1
                  AND h2.fecha = $2::date
                  AND h2.activo = FALSE
              )
            )
          )
        ORDER BY hs.hora_inicio ASC
      `,
      [room.id, requestedDate, requestedDay, payload.tipo_practica]
    );

    if (!scheduleResult.rows.length) {
      continue;
    }

    const reservationsResult = await pool.query(
      `
        SELECT
          rp.fecha_inicio::time AS hora_inicio,
          rp.fecha_fin::time AS hora_fin,
          rp.tipo_practica
        FROM reserva_practica rp
        WHERE rp.sala_id = $1
          AND rp.estado IN ('pendiente', 'por_aprobacion', 'con_comentarios', 'aprobada', 'activa', 'iniciada')
          AND rp.fecha_inicio::date = $2::date
      `,
      [room.id, requestedDate]
    );

    const availableSlots = [];

    for (const schedule of scheduleResult.rows) {
      const startHour = Number(String(schedule.hora_inicio || '').slice(0, 2));
      const endHour = Number(String(schedule.hora_fin || '').slice(0, 2));

      if (!Number.isFinite(startHour) || !Number.isFinite(endHour) || endHour <= startHour) {
        continue;
      }

      for (let hour = startHour; hour < endHour; hour += 1) {
        const slotStart = `${String(hour).padStart(2, '0')}:00`;
        const slotEnd = `${String(hour + 1).padStart(2, '0')}:00`;

        const overlapping = reservationsResult.rows.filter((reservation) => {
          const reservationStart = String(reservation.hora_inicio || '').slice(0, 5);
          const reservationEnd = String(reservation.hora_fin || '').slice(0, 5);
          return reservationStart < slotEnd && reservationEnd > slotStart;
        });

        if (payload.tipo_practica === 'docente') {
          availableSlots.push({
            hora_inicio: slotStart,
            hora_fin: slotEnd,
            cupos_disponibles: overlapping.length === 0 ? Number(room.capacidad || 0) : 0,
            modalidad_libre: null,
          });
          continue;
        }

        const hasTeachingReservation = overlapping.some(
          (reservation) => reservation.tipo_practica === 'docente'
        );

        if (hasTeachingReservation) {
          availableSlots.push({
            hora_inicio: slotStart,
            hora_fin: slotEnd,
            cupos_disponibles: 0,
            modalidad_libre: schedule.modalidad_libre || null,
          });
          continue;
        }

        const roomCapacity = Number(room.capacidad || 0);
        availableSlots.push({
          hora_inicio: slotStart,
          hora_fin: slotEnd,
          cupos_disponibles: Math.max(0, roomCapacity - overlapping.length),
          modalidad_libre: schedule.modalidad_libre || null,
        });
      }
    }

    if (availableSlots.length) {
      results.push({
        ...room,
        formato_requerido:
          payload.tipo_practica === 'docente'
            ? room.formato_practica_docente || 'DOC_PRACTICA_DOCENTE_SOLICITUD'
            : room.formato_practica_libre || 'PL_REGLAMENTO_GENERAL',
        horarios: availableSlots,
      });
    }
  }

  return results;
}

async function fetchManagedSala(id, scope) {
  if (!scope?.unrestricted && (!scope?.facultyIds || !scope?.facultyIds.length)) {
    return null;
  }

  const params = [id];
  const facultyCondition = scope?.unrestricted ? '' : 'AND f.facultad_id = ANY($2::int[])';

  if (!scope?.unrestricted) {
    params.push(scope.facultyIds);
  }

  const result = await pool.query(
    `
      SELECT
        s.id,
        s.ual_id,
        s.nombre,
        s.tipo_espacio,
        s.permite_practica_libre,
        s.permite_practica_docente,
        s.formato_practica_libre,
        s.formato_practica_docente,
        s.capacidad,
        s.descripcion,
        s.activo,
        u.nombre AS laboratorio,
        f.nombre AS facultad,
        f.facultad_id
      FROM sala s
      JOIN ual u ON u.ual_id = s.ual_id
      JOIN facultad f ON f.facultad_id = u.facultad_id
      WHERE s.id = $1
        ${facultyCondition}
      LIMIT 1
    `,
    params
  );

  return result.rows[0] || null;
}

async function fetchManagedHorarioSala(id, scope) {
  if (!scope?.unrestricted && (!scope?.facultyIds || !scope?.facultyIds.length)) {
    return null;
  }

  const params = [id];
  const facultyCondition = scope?.unrestricted ? '' : 'AND f.facultad_id = ANY($2::int[])';

  if (!scope?.unrestricted) {
    params.push(scope.facultyIds);
  }

  const result = await pool.query(
    `
      SELECT
        h.id,
        h.sala_id,
        h.dia_semana,
        h.hora_inicio,
        h.hora_fin,
        h.fecha,
        h.tipo_practica,
        h.modalidad_libre,
        s.nombre AS sala_nombre,
        u.nombre AS laboratorio,
        f.nombre AS facultad,
        f.facultad_id
      FROM horario_sala h
      JOIN sala s ON s.id = h.sala_id
      JOIN ual u ON u.ual_id = s.ual_id
      JOIN facultad f ON f.facultad_id = u.facultad_id
      WHERE h.id = $1
        ${facultyCondition}
      LIMIT 1
    `,
    params
  );

  return result.rows[0] || null;
}

async function fetchAffectedPracticeReservationsBySchedule(scheduleId, scope) {
  const horario = await fetchManagedHorarioSala(scheduleId, scope);

  if (!horario) {
    return { horario: null, reservas: [] };
  }

  const params = [horario.sala_id];
  const whereParts = [
    "rp.estado IN ('pendiente', 'por_aprobacion', 'con_comentarios', 'aprobada', 'activa', 'iniciada')",
    'rp.sala_id = $1',
    'rp.fecha_inicio::time < $3::time',
    'rp.fecha_fin::time > $2::time',
  ];

  params.push(String(horario.hora_inicio || '').slice(0, 5));
  params.push(String(horario.hora_fin || '').slice(0, 5));

  if (horario.fecha) {
    params.push(horario.fecha);
    whereParts.push(`rp.fecha_inicio::date = $${params.length}::date`);
  } else {
    params.push(Number(horario.dia_semana));
    whereParts.push(`EXTRACT(DOW FROM rp.fecha_inicio) = $${params.length}`);
    whereParts.push('rp.fecha_inicio::date >= CURRENT_DATE');
  }

  const result = await pool.query(
    `
      SELECT
        rp.id,
        rp.fecha_inicio,
        rp.fecha_fin,
        rp.estado,
        rp.tipo_practica,
        rp.categoria_practica,
        rp.laboratorio,
        rp.facultad,
        rp.sala_id,
        s.nombre AS sala_nombre,
        u.nombre AS usuario_nombre,
        u.documento AS usuario_documento
      FROM reserva_practica rp
      JOIN usuario u ON u.id = rp.usuario_id
      LEFT JOIN sala s ON s.id = rp.sala_id
      WHERE ${whereParts.join(' AND ')}
      ORDER BY rp.fecha_inicio ASC, rp.id ASC
    `,
    params
  );

  return {
    horario,
    reservas: result.rows || [],
  };
}

async function fetchPrestamoFacultades() {
  const result = await pool.query(
    `
      SELECT DISTINCT nombre AS facultad
      FROM facultad
      WHERE activo = TRUE
      ORDER BY nombre ASC
    `
  );

  return result.rows || [];
}

async function fetchPrestamoLaboratorios(facultad) {
  const result = await pool.query(
    `
      SELECT DISTINCT u.nombre AS laboratorio
      FROM ual u
      JOIN facultad f
        ON f.facultad_id = u.facultad_id
      WHERE u.activo = TRUE
        AND f.activo = TRUE
        AND UPPER(f.nombre) = UPPER($1)
      ORDER BY u.nombre ASC
    `,
    [facultad]
  );

  return result.rows || [];
}

async function fetchPrestamoEquipos(facultad, laboratorio) {
  const result = await pool.query(
    `
      SELECT
        e.id,
        e.codigo,
        e.nombre,
        e.descripcion,
        e.categoria,
        e.laboratorio,
        COALESCE(e.facultad, f.nombre) AS facultad,
        e.estado,
        e.ubicacion,
        e.ubicacion_prestamo,
        e.especificaciones
      FROM equipo e
      LEFT JOIN ual u
        ON UPPER(u.nombre) = UPPER(e.laboratorio)
      LEFT JOIN facultad f
        ON f.facultad_id = u.facultad_id
      WHERE e.estado = 'disponible'
        AND UPPER(COALESCE(e.facultad, f.nombre, '')) = UPPER($1)
        AND UPPER(COALESCE(e.laboratorio, '')) LIKE UPPER($2)
      ORDER BY e.nombre ASC
    `,
    [facultad, `%${laboratorio}%`]
  );

  return result.rows || [];
}

async function fetchActiveSanctionsCount(usuarioId) {
  const result = await pool.query(
    `
      SELECT COUNT(*)::int AS total
      FROM multa
      WHERE usuario_id_sancionado = $1
        AND activo = TRUE
        AND UPPER(COALESCE(con_estado_multa, '')) IN ('ACTIVA', 'PENDIENTE', 'POR SALDAR')
    `,
    [usuarioId]
  );

  return result.rows[0]?.total || 0;
}

async function fetchGlobalLoanPracticeParameters() {
  try {
    const result = await pool.query(
      `
        SELECT max_horas_mes_practica_libre, max_horas_mes_prestamos
        FROM parametrizacion
        WHERE id = 1
        LIMIT 1
      `
    );

    const row = result.rows[0] || {};
    return {
      ...DEFAULT_PRACTICE_CONFIGURATION,
      max_horas_mes_practica_libre: normalizeNonNegativeInteger(
        row.max_horas_mes_practica_libre,
        DEFAULT_PRACTICE_CONFIGURATION.max_horas_mes_practica_libre
      ),
      max_horas_mes_prestamos: normalizeNonNegativeInteger(
        row.max_horas_mes_prestamos,
        DEFAULT_PRACTICE_CONFIGURATION.max_horas_mes_prestamos
      ),
    };
  } catch (error) {
    if (error?.code === '42P01') {
      return { ...DEFAULT_PRACTICE_CONFIGURATION };
    }

    throw error;
  }
}

async function fetchPracticeConfigurationByFacultyId(facultyId) {
  if (!facultyId) {
    return { ...DEFAULT_PRACTICE_CONFIGURATION };
  }

  try {
    const result = await pool.query(
      `
        SELECT
          min_cancel_hours,
          min_reserva_hours,
          min_docente_reserva_days,
          max_activas_estudiante,
          dias_sancion_no_asistencia
        FROM practica_config
        WHERE facultad_id = $1
        LIMIT 1
      `,
      [facultyId]
    );

    const row = result.rows[0] || {};
    return {
      ...DEFAULT_PRACTICE_CONFIGURATION,
      min_cancel_hours: normalizePositiveInteger(
        row.min_cancel_hours,
        DEFAULT_PRACTICE_CONFIGURATION.min_cancel_hours
      ),
      min_reserva_hours: normalizePositiveInteger(
        row.min_reserva_hours,
        DEFAULT_PRACTICE_CONFIGURATION.min_reserva_hours
      ),
      min_docente_reserva_days: normalizeNonNegativeInteger(
        row.min_docente_reserva_days,
        DEFAULT_PRACTICE_CONFIGURATION.min_docente_reserva_days
      ),
      max_activas_estudiante: normalizePositiveInteger(
        row.max_activas_estudiante,
        DEFAULT_PRACTICE_CONFIGURATION.max_activas_estudiante
      ),
      dias_sancion_no_asistencia: normalizeNonNegativeInteger(
        row.dias_sancion_no_asistencia,
        DEFAULT_PRACTICE_CONFIGURATION.dias_sancion_no_asistencia
      ),
    };
  } catch (error) {
    if (error?.code === '42P01') {
      return { ...DEFAULT_PRACTICE_CONFIGURATION };
    }

    throw error;
  }
}

async function fetchPracticeConfigurationByFacultyName(facultyName) {
  const normalizedName = sanitizeText(facultyName);
  const canonicalName = canonicalizeFacultyName(normalizedName);

  if (!normalizedName && !canonicalName) {
    return { ...DEFAULT_PRACTICE_CONFIGURATION };
  }

  const result = await pool.query(
    `
      SELECT f.facultad_id
      FROM facultad f
      WHERE UPPER(f.nombre) = UPPER($1::text)
         OR ($2::text IS NOT NULL AND UPPER(f.nombre) = UPPER($2::text))
      ORDER BY f.facultad_id ASC
      LIMIT 1
    `,
    [normalizedName, canonicalName]
  );

  return fetchPracticeConfigurationByFacultyId(result.rows[0]?.facultad_id || null);
}

async function fetchCoordinatorSignatureRecord(req) {
  const sessionUser = req.session?.user;
  const authDocument = sanitizeText(sessionUser?.documento_real || sessionUser?.documento);

  if (!authDocument) {
    return null;
  }

  const scope = await resolveCoordinatorScope(pool, authDocument);
  if (!scope.coordinatorDocument) {
    return null;
  }

  const result = await pool.query(
    `
      SELECT
        c.documento,
        c.nombre,
        c.correo,
        c.firma_digital,
        c.fecha_firma,
        f.nombre AS facultad
      FROM coordinador c
      LEFT JOIN coordinador_facultad cf
        ON cf.coordinador_documento_id = c.documento
       AND cf.activo = TRUE
      LEFT JOIN facultad f
        ON f.facultad_id = cf.facultad_id
      WHERE c.documento = $1
      ORDER BY cf.fecha_modificacion DESC NULLS LAST, cf.facultad_id ASC
      LIMIT 1
    `,
    [scope.coordinatorDocument]
  );

  return result.rows[0] || null;
}

async function fetchScopedPracticeConfigurationFaculties(req) {
  const scope = await resolveLoanManagementScope(req);

  if (scope.unrestricted) {
    const result = await pool.query(
      `
        SELECT facultad_id, nombre
        FROM facultad
        WHERE activo = TRUE
        ORDER BY nombre ASC
      `
    );

    return result.rows || [];
  }

  if (!scope.facultyIds.length) {
    return [];
  }

  const result = await pool.query(
    `
      SELECT facultad_id, nombre
      FROM facultad
      WHERE facultad_id = ANY($1::int[])
      ORDER BY nombre ASC
    `,
    [scope.facultyIds]
  );

  return result.rows || [];
}

async function fetchScopedPracticeConfigurationLaboratories(req, facultyId) {
  const scope = await resolveLoanManagementScope(req);
  const params = [facultyId];
  const whereParts = ['u.activo = TRUE', 'u.facultad_id = $1'];

  if (!scope.unrestricted) {
    if (!scope.facultyIds.length) {
      return [];
    }

    params.push(scope.facultyIds);
    whereParts.push(`u.facultad_id = ANY($${params.length}::int[])`);
  }

  if (
    scope.restrictToLaboratories &&
    Array.isArray(scope.laboratoryNames) &&
    scope.laboratoryNames.length
  ) {
    params.push(scope.laboratoryNames);
    whereParts.push(`UPPER(u.nombre) = ANY($${params.length}::text[])`);
  }

  const result = await pool.query(
    `
      SELECT u.ual_id, u.nombre, f.nombre AS facultad, f.facultad_id
      FROM ual u
      JOIN facultad f ON f.facultad_id = u.facultad_id
      WHERE ${whereParts.join(' AND ')}
      ORDER BY u.nombre ASC
    `,
    params
  );

  return result.rows || [];
}

async function fetchDynamicPracticeSchemaByUalId(ualId) {
  if (!Number.isInteger(Number(ualId)) || Number(ualId) <= 0) {
    return { ...DEFAULT_DYNAMIC_PRACTICE_SCHEMA };
  }

  await ensureAcademicPracticeSchema();

  const result = await pool.query(
    `
      SELECT schema_json
      FROM configuracion_practica
      WHERE ual_id = $1
      LIMIT 1
    `,
    [Number(ualId)]
  );

  return normalizeDynamicPracticeSchema(result.rows[0]?.schema_json);
}

async function validatePracticeDocumentUrl(url) {
  const normalizedUrl = sanitizeText(url);
  if (!normalizedUrl) {
    return {
      available: false,
      warning: 'El enlace del documento esta vacio.',
      statusCode: null,
      contentType: '',
    };
  }

  try {
    new URL(normalizedUrl);
  } catch {
    return {
      available: false,
      warning: 'El enlace del documento no es una URL valida.',
      statusCode: null,
      contentType: '',
    };
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return {
      available: false,
      warning: 'El enlace del documento debe usar http o https.',
      statusCode: null,
      contentType: '',
    };
  }

  const requestInit = function (method, controller) {
    return {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'application/pdf,*/*;q=0.8',
        'User-Agent': 'MiLab/Prestamos',
      },
    };
  };

  const attemptRequest = async function (method) {
    const controller = new AbortController();
    const timeoutId = setTimeout(function () {
      controller.abort();
    }, 4000);

    try {
      const response = await fetch(normalizedUrl, requestInit(method, controller));
      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (response.body && typeof response.body.cancel === 'function') {
        response.body.cancel().catch(function () {
          return null;
        });
      }

      return {
        ok: response.ok,
        statusCode: response.status,
        contentType,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  };

  try {
    let result = await attemptRequest('HEAD');
    if (!result.ok && [403, 405, 406].includes(Number(result.statusCode || 0))) {
      result = await attemptRequest('GET');
    }

    if (!result.ok) {
      return {
        available: false,
        warning: `El enlace respondio con estado HTTP ${result.statusCode || 'desconocido'}.`,
        statusCode: result.statusCode || null,
        contentType: result.contentType || '',
      };
    }

    const looksLikePdf =
      normalizedUrl.toLowerCase().includes('.pdf') ||
      String(result.contentType || '').includes('pdf');

    if (!looksLikePdf) {
      return {
        available: false,
        warning: 'El enlace responde, pero no parece apuntar a un PDF.',
        statusCode: result.statusCode || null,
        contentType: result.contentType || '',
      };
    }

    return {
      available: true,
      warning: '',
      statusCode: result.statusCode || null,
      contentType: result.contentType || '',
    };
  } catch (error) {
    return {
      available: false,
      warning:
        error?.name === 'AbortError'
          ? 'No fue posible validar el documento porque el enlace excedio el tiempo maximo de respuesta.'
          : 'No fue posible validar el enlace del documento.',
      statusCode: null,
      contentType: '',
    };
  }
}

async function validatePracticeDocumentLinks(documents) {
  const normalizedDocuments = Array.isArray(documents) ? documents : [];
  const validations = await Promise.all(
    normalizedDocuments.map(async function (item) {
      const validation = await validatePracticeDocumentUrl(item.url);
      return {
        ...item,
        validacion: validation,
      };
    })
  );

  return validations;
}

async function fetchAcademicPracticesByUalId(ualId) {
  if (!Number.isInteger(Number(ualId)) || Number(ualId) <= 0) {
    return [];
  }

  await ensureAcademicPracticeSchema();

  const result = await pool.query(
    `
      SELECT
        p.id,
        p.ual_id,
        p.nombre,
        p.descripcion,
        p.tipo_practica,
        p.estado,
        p.configuracion_json,
        p.fecha_creacion,
        p.fecha_modificacion,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', a.id,
              'codigo', a.codigo,
              'nombre', a.nombre
            )
          ) FILTER (WHERE a.id IS NOT NULL),
          '[]'::json
        ) AS asignaturas
      FROM practica p
      LEFT JOIN asignatura_practica ap
        ON ap.practica_id = p.id
       AND ap.activo = TRUE
      LEFT JOIN asignatura a
        ON a.id = ap.asignatura_id
       AND a.activo = TRUE
      WHERE p.ual_id = $1
      GROUP BY p.id
      ORDER BY p.fecha_modificacion DESC, p.id DESC
    `,
    [Number(ualId)]
  );

  const rows = result.rows || [];
  const practices = await Promise.all(
    rows.map(async function (row) {
      const configuracion = sanitizeJsonObject(row.configuracion_json) || {};
      const documentos = normalizePracticeDocumentList(configuracion.documentos);

      return {
        ...row,
        asignaturas: Array.isArray(row.asignaturas) ? row.asignaturas : [],
        configuracion_json: {
          ...configuracion,
          documentos: await validatePracticeDocumentLinks(documentos),
        },
      };
    })
  );

  return practices;
}

async function fetchManagedAcademicPractice(practiceId, scope) {
  if (!Number.isInteger(Number(practiceId)) || Number(practiceId) <= 0) {
    return null;
  }

  if (!scope?.unrestricted && (!scope?.facultyIds || !scope.facultyIds.length)) {
    return null;
  }

  const params = [Number(practiceId)];
  const whereParts = ['p.id = $1'];

  if (!scope.unrestricted) {
    params.push(scope.facultyIds);
    whereParts.push(`f.facultad_id = ANY($${params.length}::int[])`);
  }

  if (
    scope.restrictToLaboratories &&
    Array.isArray(scope.laboratoryNames) &&
    scope.laboratoryNames.length
  ) {
    params.push(scope.laboratoryNames);
    whereParts.push(`UPPER(u.nombre) = ANY($${params.length}::text[])`);
  }

  const result = await pool.query(
    `
      SELECT
        p.id,
        p.ual_id,
        p.nombre,
        p.estado,
        u.nombre AS laboratorio,
        f.nombre AS facultad,
        f.facultad_id
      FROM practica p
      JOIN ual u ON u.ual_id = p.ual_id
      JOIN facultad f ON f.facultad_id = u.facultad_id
      WHERE ${whereParts.join(' AND ')}
      LIMIT 1
    `,
    params
  );

  return result.rows[0] || null;
}

async function upsertAcademicPracticeSubjects(client, practiceId, subjects) {
  await client.query(
    `
      DELETE FROM asignatura_practica
      WHERE practica_id = $1
    `,
    [practiceId]
  );

  for (const subject of subjects) {
    const result = await client.query(
      `
        INSERT INTO asignatura (
          codigo,
          nombre,
          descripcion,
          fecha_modificacion
        )
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
        ON CONFLICT (codigo)
        DO UPDATE SET
          nombre = EXCLUDED.nombre,
          descripcion = COALESCE(EXCLUDED.descripcion, asignatura.descripcion),
          activo = TRUE,
          fecha_modificacion = CURRENT_TIMESTAMP
        RETURNING id
      `,
      [subject.codigo, subject.nombre, subject.descripcion]
    );

    const subjectId = result.rows[0]?.id;
    if (!subjectId) {
      continue;
    }

    await client.query(
      `
        INSERT INTO asignatura_practica (
          asignatura_id,
          practica_id,
          activo,
          fecha_modificacion
        )
        VALUES ($1, $2, TRUE, CURRENT_TIMESTAMP)
        ON CONFLICT (asignatura_id, practica_id)
        DO UPDATE SET
          activo = TRUE,
          fecha_modificacion = CURRENT_TIMESTAMP
      `,
      [subjectId, practiceId]
    );
  }
}

async function calculateMonthlyLoanHours(usuarioId) {
  if (!usuarioId) {
    return 0;
  }
  const result = await pool.query(
    `
      SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (fecha_fin - fecha_inicio)) / 3600), 0) AS horas
      FROM solicitud_prestamo
      WHERE usuario_id = $1
        AND estado NOT IN ('cancelado', 'rechazado')
        AND fecha_inicio >= date_trunc('month', CURRENT_TIMESTAMP)
        AND fecha_inicio < date_trunc('month', CURRENT_TIMESTAMP) + interval '1 month'
    `,
    [usuarioId]
  );

  return Number(result.rows[0]?.horas || 0);
}

async function calculateMonthlyFreePracticeHours(usuarioId) {
  const result = await pool.query(
    `
      SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (fecha_fin - fecha_inicio)) / 3600), 0) AS horas
      FROM reserva_practica
      WHERE usuario_id = $1
        AND tipo_practica = 'libre'
        AND estado NOT IN ('cancelada', 'rechazada')
        AND fecha_inicio >= date_trunc('month', CURRENT_TIMESTAMP)
        AND fecha_inicio < date_trunc('month', CURRENT_TIMESTAMP) + interval '1 month'
    `,
    [usuarioId]
  );

  return Number(result.rows[0]?.horas || 0);
}

async function countUserActivePracticeReservations(usuarioId, facultyName) {
  const params = [usuarioId];
  const clauses = [
    'usuario_id = $1',
    "estado IN ('pendiente', 'por_aprobacion', 'con_comentarios', 'aprobada', 'activa', 'iniciada')",
  ];

  if (facultyName) {
    params.push(facultyName);
    clauses.push(`UPPER(COALESCE(facultad, '')) = UPPER($${params.length})`);
  }

  const result = await pool.query(
    `
      SELECT COUNT(*)::int AS total
      FROM reserva_practica
      WHERE ${clauses.join(' AND ')}
    `,
    params
  );

  return Number(result.rows[0]?.total || 0);
}

async function fetchLatestPracticeNoShow(usuarioId) {
  const result = await pool.query(
    `
      SELECT fecha_inicio
      FROM reserva_practica
      WHERE usuario_id = $1
        AND estado = 'no_asistio'
      ORDER BY fecha_inicio DESC
      LIMIT 1
    `,
    [usuarioId]
  );

  return result.rows[0]?.fecha_inicio || null;
}

async function buildEquipmentLoanAvailability(equipmentId) {
  const equipment = await fetchEquipmentItem(equipmentId);

  if (!equipment) {
    return null;
  }

  const configuredSchedules = await fetchEquipmentSchedules(equipmentId);
  const schedules = configuredSchedules.length
    ? configuredSchedules.map((schedule) => ({
        fecha:
          typeof schedule.fecha === 'string'
            ? schedule.fecha
            : schedule.fecha?.toISOString?.().split('T')[0],
        hora_inicio: String(schedule.hora_inicio || '').slice(0, 5),
        hora_fin: String(schedule.hora_fin || '').slice(0, 5),
        activo: schedule.activo,
      }))
    : generateDefaultEquipmentSchedules();

  const now = new Date();
  const todayKey = formatLocalDateKey(now);
  const nowTimeKey = formatLocalTimeKey(now);
  const upcomingSchedules = schedules.filter((schedule) => {
    if (!schedule.fecha) {
      return false;
    }

    if (schedule.fecha > todayKey) {
      return true;
    }

    if (schedule.fecha < todayKey) {
      return false;
    }

    return String(schedule.hora_inicio || '') > nowTimeKey;
  });

  const requestsResult = await pool.query(
    `
      SELECT fecha_inicio, fecha_fin, estado
      FROM solicitud_prestamo
      WHERE equipo_id = $1
        AND estado IN ('pendiente', 'aprobado', 'activo')
        AND fecha_fin >= CURRENT_TIMESTAMP
      ORDER BY fecha_inicio ASC
    `,
    [equipmentId]
  );

  const busyIntervalsByDate = new Map();

  (requestsResult.rows || []).forEach((request) => {
    const startDate = new Date(request.fecha_inicio);
    const endDate = new Date(request.fecha_fin);
    const dateKey = formatLocalDateKey(startDate);

    if (!busyIntervalsByDate.has(dateKey)) {
      busyIntervalsByDate.set(dateKey, []);
    }

    busyIntervalsByDate.get(dateKey).push({
      hora_inicio: formatLocalTimeKey(startDate),
      hora_fin: formatLocalTimeKey(endDate),
      estado: request.estado,
    });
  });

  const horariosDisponibles = upcomingSchedules
    .filter((schedule) => schedule.fecha && schedule.hora_inicio && schedule.hora_fin)
    .map((schedule) => {
      const intervals = busyIntervalsByDate.get(schedule.fecha) || [];
      const hasConflict = intervals.some(
        (interval) =>
          schedule.hora_inicio < interval.hora_fin && schedule.hora_fin > interval.hora_inicio
      );

      return {
        fecha: schedule.fecha,
        horaInicio: schedule.hora_inicio,
        horaFin: schedule.hora_fin,
        disponible: !hasConflict,
      };
    });

  return {
    equipo: normalizeEquipmentForView(equipment),
    horariosDisponibles,
    usaHorariosConfigurados: configuredSchedules.length > 0,
  };
}

async function fetchInventoryItem(id) {
  const result = await pool.query(
    `
      SELECT
        id,
        serie,
        placa,
        nombre_bien,
        grupo_inventario,
        nivel_inventario,
        funcionario_doc,
        nombre_funcionario,
        fecha_registro,
        sede,
        dependencia,
        espacio_fisico,
        disponible_prestamo,
        fecha_creacion,
        fecha_modificacion
      FROM inventario
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );

  return result.rows[0] || null;
}

async function fetchEquipmentItem(id) {
  const result = await pool.query(
    `
      SELECT
        id,
        codigo,
        nombre,
        descripcion,
        especificaciones,
        categoria,
        laboratorio,
        facultad,
        area_conocimiento,
        estado,
        ubicacion,
        ubicacion_prestamo,
        fecha_creacion,
        fecha_modificacion
      FROM equipo
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );

  return result.rows[0] || null;
}

async function fetchEquipmentSchedules(id) {
  const result = await pool.query(
    `
      SELECT
        id,
        fecha,
        hora_inicio,
        hora_fin,
        activo
      FROM horario_equipo
      WHERE equipo_id = $1
        AND activo = TRUE
      ORDER BY fecha ASC, hora_inicio ASC
    `,
    [id]
  );

  return result.rows || [];
}

async function replaceEquipmentSchedules(client, equipmentId, schedules) {
  await client.query('DELETE FROM horario_equipo WHERE equipo_id = $1', [equipmentId]);

  if (!schedules.length) {
    return;
  }

  for (const schedule of schedules) {
    await client.query(
      `
        INSERT INTO horario_equipo (
          equipo_id,
          fecha,
          hora_inicio,
          hora_fin,
          activo
        )
        VALUES ($1, $2::date, $3::time, $4::time, TRUE)
      `,
      [equipmentId, schedule.fecha, schedule.hora_inicio, schedule.hora_fin]
    );
  }
}

router.get('/inventario', requireInventarioAuthorized, async function (req, res) {
  try {
    const result = await pool.query(
      `
        SELECT
          id,
          serie,
          placa,
          nombre_bien,
          grupo_inventario,
          nivel_inventario,
          funcionario_doc,
          nombre_funcionario,
          fecha_registro,
          sede,
          dependencia,
          espacio_fisico,
          disponible_prestamo,
          fecha_creacion,
          fecha_modificacion
        FROM inventario
        ORDER BY fecha_creacion DESC NULLS LAST, id DESC
      `
    );

    return res.render('home/prestamos/inventario/index', {
      items: result.rows,
      successMessage: sanitizeText(req.query.success),
      errorMessage: sanitizeText(req.query.error),
    });
  } catch (error) {
    console.error('Error cargando inventario MiLab:', error);
    return res.render('home/prestamos/inventario/index', {
      items: [],
      successMessage: '',
      errorMessage: resolveDbErrorMessage(error, 'No fue posible cargar el inventario.'),
    });
  }
});

router.get('/inventario/crear', requireInventarioAuthorized, function (req, res) {
  return res.render('home/prestamos/inventario/form', {
    item: {},
    isEdit: false,
    errorMessage: '',
  });
});

router.post('/inventario/crear', requireInventarioAuthorized, async function (req, res) {
  const payload = buildInventoryPayload(req.body);
  const validationError = validateInventoryPayload(payload);

  if (validationError) {
    return res.status(400).render('home/prestamos/inventario/form', {
      item: payload,
      isEdit: false,
      errorMessage: validationError,
    });
  }

  try {
    await pool.query(
      `
        INSERT INTO inventario (
          serie,
          placa,
          nombre_bien,
          grupo_inventario,
          nivel_inventario,
          funcionario_doc,
          nombre_funcionario,
          fecha_registro,
          sede,
          dependencia,
          espacio_fisico,
          disponible_prestamo
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10, $11, $12)
      `,
      [
        payload.serie,
        payload.placa,
        payload.nombre_bien,
        payload.grupo_inventario,
        payload.nivel_inventario,
        payload.funcionario_doc,
        payload.nombre_funcionario,
        payload.fecha_registro,
        payload.sede,
        payload.dependencia,
        payload.espacio_fisico,
        payload.disponible_prestamo,
      ]
    );

    return res.redirect('/milab/prestamos/inventario?success=Elemento creado correctamente');
  } catch (error) {
    console.error('Error creando inventario MiLab:', error);
    return res.status(500).render('home/prestamos/inventario/form', {
      item: payload,
      isEdit: false,
      errorMessage: resolveDbErrorMessage(error, 'No fue posible crear el elemento.'),
    });
  }
});

router.get('/inventario/:id/editar', requireInventarioAuthorized, async function (req, res) {
  if (!isValidInventoryId(req.params.id)) {
    return res.redirect('/milab/prestamos/inventario?error=El elemento no existe');
  }

  try {
    const item = await fetchInventoryItem(req.params.id);

    if (!item) {
      return res.redirect('/milab/prestamos/inventario?error=El elemento no existe');
    }

    return res.render('home/prestamos/inventario/form', {
      item,
      isEdit: true,
      errorMessage: '',
    });
  } catch (error) {
    console.error('Error cargando edicion de inventario MiLab:', error);
    return res.redirect(
      `/milab/prestamos/inventario?error=${encodeURIComponent(
        resolveDbErrorMessage(error, 'No fue posible cargar el elemento.')
      )}`
    );
  }
});

router.post('/inventario/:id/editar', requireInventarioAuthorized, async function (req, res) {
  if (!isValidInventoryId(req.params.id)) {
    return res.redirect('/milab/prestamos/inventario?error=El elemento no existe');
  }

  const payload = buildInventoryPayload(req.body);
  const validationError = validateInventoryPayload(payload);

  if (validationError) {
    return res.status(400).render('home/prestamos/inventario/form', {
      item: { ...payload, id: req.params.id },
      isEdit: true,
      errorMessage: validationError,
    });
  }

  try {
    const result = await pool.query(
      `
        UPDATE inventario
        SET
          serie = $1,
          placa = $2,
          nombre_bien = $3,
          grupo_inventario = $4,
          nivel_inventario = $5,
          funcionario_doc = $6,
          nombre_funcionario = $7,
          fecha_registro = $8::date,
          sede = $9,
          dependencia = $10,
          espacio_fisico = $11,
          disponible_prestamo = $12,
          fecha_modificacion = CURRENT_TIMESTAMP
        WHERE id = $13
      `,
      [
        payload.serie,
        payload.placa,
        payload.nombre_bien,
        payload.grupo_inventario,
        payload.nivel_inventario,
        payload.funcionario_doc,
        payload.nombre_funcionario,
        payload.fecha_registro,
        payload.sede,
        payload.dependencia,
        payload.espacio_fisico,
        payload.disponible_prestamo,
        req.params.id,
      ]
    );

    if (result.rowCount === 0) {
      return res.redirect('/milab/prestamos/inventario?error=El elemento no existe');
    }

    return res.redirect('/milab/prestamos/inventario?success=Elemento actualizado correctamente');
  } catch (error) {
    console.error('Error actualizando inventario MiLab:', error);
    return res.status(500).render('home/prestamos/inventario/form', {
      item: { ...payload, id: req.params.id },
      isEdit: true,
      errorMessage: resolveDbErrorMessage(error, 'No fue posible actualizar el elemento.'),
    });
  }
});

router.post('/inventario/:id/eliminar', requireInventarioAuthorized, async function (req, res) {
  if (!isValidInventoryId(req.params.id)) {
    return res.redirect('/milab/prestamos/inventario?error=El elemento no existe');
  }

  try {
    const result = await pool.query('DELETE FROM inventario WHERE id = $1', [req.params.id]);

    if (result.rowCount === 0) {
      return res.redirect('/milab/prestamos/inventario?error=El elemento no existe');
    }

    return res.redirect('/milab/prestamos/inventario?success=Elemento eliminado correctamente');
  } catch (error) {
    console.error('Error eliminando inventario MiLab:', error);
    return res.redirect(
      `/milab/prestamos/inventario?error=${encodeURIComponent(
        resolveDbErrorMessage(error, 'No fue posible eliminar el elemento.')
      )}`
    );
  }
});

router.get('/equipos', requireEquiposAuthorized, async function (req, res) {
  try {
    const result = await pool.query(
      `
        SELECT
          id,
          codigo,
          nombre,
          descripcion,
          especificaciones,
          categoria,
          laboratorio,
          facultad,
          area_conocimiento,
          estado,
          ubicacion,
          ubicacion_prestamo,
          fecha_creacion,
          fecha_modificacion
        FROM equipo
        ORDER BY fecha_creacion DESC NULLS LAST, id DESC
      `
    );

    const items = result.rows || [];
    const equipmentIds = items.map((item) => item.id).filter(Boolean);
    const schedulesByEquipmentId = new Map();

    if (equipmentIds.length) {
      const scheduleResult = await pool.query(
        `
          SELECT
            equipo_id,
            fecha,
            hora_inicio,
            hora_fin
          FROM horario_equipo
          WHERE equipo_id = ANY($1::int[])
            AND activo = TRUE
          ORDER BY fecha ASC, hora_inicio ASC
        `,
        [equipmentIds]
      );

      (scheduleResult.rows || []).forEach((schedule) => {
        if (!schedulesByEquipmentId.has(schedule.equipo_id)) {
          schedulesByEquipmentId.set(schedule.equipo_id, []);
        }

        schedulesByEquipmentId.get(schedule.equipo_id).push(schedule);
      });
    }

    return res.render('home/prestamos/equipos/index', {
      items: items.map((item) =>
        normalizeEquipmentForView({
          ...item,
          horarios: schedulesByEquipmentId.get(item.id) || [],
        })
      ),
      successMessage: sanitizeText(req.query.success),
      errorMessage: sanitizeText(req.query.error),
    });
  } catch (error) {
    console.error('Error cargando equipos MiLab:', error);
    return res.render('home/prestamos/equipos/index', {
      items: [],
      successMessage: '',
      errorMessage: resolveEquipmentDbErrorMessage(error, 'No fue posible cargar los equipos.'),
    });
  }
});

router.get('/equipos/crear', requireEquiposAuthorized, async function (req, res) {
  return renderEquipmentForm(req, res, {
    item: {
      estado: 'disponible',
      ubicacion_prestamo: { dentro: true, fuera: false },
      horarios: [],
    },
    isEdit: false,
    errorMessage: '',
  });
});

router.post('/equipos/crear', requireEquiposAuthorized, async function (req, res) {
  const payload = buildEquipmentPayload(req.body);
  const schedules = parseScheduleEntries(req.body);
  const validationError = validateEquipmentPayload(payload);
  const scheduleValidationError = validateSchedules(schedules);

  if (validationError) {
    return renderEquipmentForm(req, res, {
      statusCode: 400,
      item: { ...payload, horarios: schedules },
      isEdit: false,
      errorMessage: validationError,
    });
  }

  if (scheduleValidationError) {
    return renderEquipmentForm(req, res, {
      statusCode: 400,
      item: { ...payload, horarios: schedules },
      isEdit: false,
      errorMessage: scheduleValidationError,
    });
  }

  try {
    const codigo = payload.codigo || generateEquipmentCode();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const createResult = await client.query(
        `
          INSERT INTO equipo (
            codigo,
            nombre,
            descripcion,
            especificaciones,
            categoria,
            laboratorio,
            facultad,
            area_conocimiento,
            estado,
            ubicacion,
            ubicacion_prestamo
          )
          VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11::jsonb)
          RETURNING id
        `,
        [
          codigo,
          payload.nombre,
          payload.descripcion,
          JSON.stringify(payload.especificaciones),
          payload.categoria,
          payload.laboratorio,
          payload.facultad,
          payload.area_conocimiento,
          payload.estado,
          payload.ubicacion,
          JSON.stringify(payload.ubicacion_prestamo),
        ]
      );

      await replaceEquipmentSchedules(client, createResult.rows[0].id, schedules);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return res.redirect('/milab/prestamos/equipos?success=Equipo creado correctamente');
  } catch (error) {
    console.error('Error creando equipo MiLab:', error);
    return renderEquipmentForm(req, res, {
      statusCode: 500,
      item: { ...payload, horarios: schedules },
      isEdit: false,
      errorMessage: resolveEquipmentDbErrorMessage(error, 'No fue posible crear el equipo.'),
    });
  }
});

router.get('/equipos/:id/editar', requireEquiposAuthorized, async function (req, res) {
  if (!isValidEquipmentId(req.params.id)) {
    return res.redirect('/milab/prestamos/equipos?error=El equipo no existe');
  }

  try {
    const item = await fetchEquipmentItem(req.params.id);
    const schedules = await fetchEquipmentSchedules(req.params.id);

    if (!item) {
      return res.redirect('/milab/prestamos/equipos?error=El equipo no existe');
    }

    return renderEquipmentForm(req, res, {
      item: { ...item, horarios: schedules },
      isEdit: true,
      errorMessage: '',
    });
  } catch (error) {
    console.error('Error cargando edicion de equipo MiLab:', error);
    return res.redirect(
      `/milab/prestamos/equipos?error=${encodeURIComponent(
        resolveEquipmentDbErrorMessage(error, 'No fue posible cargar el equipo.')
      )}`
    );
  }
});

router.post('/equipos/:id/editar', requireEquiposAuthorized, async function (req, res) {
  if (!isValidEquipmentId(req.params.id)) {
    return res.redirect('/milab/prestamos/equipos?error=El equipo no existe');
  }

  const payload = buildEquipmentPayload(req.body);
  const schedules = parseScheduleEntries(req.body);
  const validationError = validateEquipmentPayload(payload);
  const scheduleValidationError = validateSchedules(schedules);

  if (validationError) {
    return renderEquipmentForm(req, res, {
      statusCode: 400,
      item: { ...payload, id: req.params.id, horarios: schedules },
      isEdit: true,
      errorMessage: validationError,
    });
  }

  if (scheduleValidationError) {
    return renderEquipmentForm(req, res, {
      statusCode: 400,
      item: { ...payload, id: req.params.id, horarios: schedules },
      isEdit: true,
      errorMessage: scheduleValidationError,
    });
  }

  try {
    const client = await pool.connect();
    let result;

    try {
      await client.query('BEGIN');
      result = await client.query(
        `
          UPDATE equipo
          SET
            nombre = $1,
            descripcion = $2,
            especificaciones = $3::jsonb,
            categoria = $4,
            laboratorio = $5,
            facultad = $6,
            area_conocimiento = $7,
            estado = $8,
            ubicacion = $9,
            ubicacion_prestamo = $10::jsonb,
          fecha_modificacion = CURRENT_TIMESTAMP
          WHERE id = $11
        `,
        [
          payload.nombre,
          payload.descripcion,
          JSON.stringify(payload.especificaciones),
          payload.categoria,
          payload.laboratorio,
          payload.facultad,
          payload.area_conocimiento,
          payload.estado,
          payload.ubicacion,
          JSON.stringify(payload.ubicacion_prestamo),
          req.params.id,
        ]
      );

      if (result.rowCount > 0) {
        await replaceEquipmentSchedules(client, req.params.id, schedules);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    if (result.rowCount === 0) {
      return res.redirect('/milab/prestamos/equipos?error=El equipo no existe');
    }

    return res.redirect('/milab/prestamos/equipos?success=Equipo actualizado correctamente');
  } catch (error) {
    console.error('Error actualizando equipo MiLab:', error);
    return renderEquipmentForm(req, res, {
      statusCode: 500,
      item: { ...payload, id: req.params.id, horarios: schedules },
      isEdit: true,
      errorMessage: resolveEquipmentDbErrorMessage(error, 'No fue posible actualizar el equipo.'),
    });
  }
});

router.post('/equipos/:id/estado', requireEquiposAuthorized, async function (req, res) {
  if (!isValidEquipmentId(req.params.id)) {
    return res.redirect('/milab/prestamos/equipos?error=El equipo no existe');
  }

  const newState = sanitizeText(req.body.estado);

  if (!['disponible', 'prestado', 'mantenimiento', 'fuera_servicio'].includes(newState)) {
    return res.redirect('/milab/prestamos/equipos?error=El estado seleccionado no es valido');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const equipmentResult = await client.query(
      `
        SELECT id, codigo, nombre, facultad, laboratorio, estado
        FROM equipo
        WHERE id = $1
        LIMIT 1
      `,
      [req.params.id]
    );

    const equipment = equipmentResult.rows[0];
    if (!equipment) {
      await client.query('ROLLBACK');
      return res.redirect('/milab/prestamos/equipos?error=El equipo no existe');
    }

    await client.query(
      `
        UPDATE equipo
        SET estado = $1,
            fecha_modificacion = CURRENT_TIMESTAMP
        WHERE id = $2
      `,
      [newState, equipment.id]
    );

    await client.query('COMMIT');

    return res.redirect(
      '/milab/prestamos/equipos?success=Estado del equipo actualizado correctamente'
    );
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error actualizando estado de equipo MiLab:', error);
    return res.redirect(
      `/milab/prestamos/equipos?error=${encodeURIComponent(
        resolveEquipmentDbErrorMessage(error, 'No fue posible actualizar el estado del equipo.')
      )}`
    );
  } finally {
    client.release();
  }
});

router.post('/equipos/:id/eliminar', requireEquiposAuthorized, async function (req, res) {
  if (!isValidEquipmentId(req.params.id)) {
    return res.redirect('/milab/prestamos/equipos?error=El equipo no existe');
  }

  try {
    const result = await pool.query('DELETE FROM equipo WHERE id = $1', [req.params.id]);

    if (result.rowCount === 0) {
      return res.redirect('/milab/prestamos/equipos?error=El equipo no existe');
    }

    return res.redirect('/milab/prestamos/equipos?success=Equipo eliminado correctamente');
  } catch (error) {
    console.error('Error eliminando equipo MiLab:', error);
    return res.redirect(
      `/milab/prestamos/equipos?error=${encodeURIComponent(
        resolveEquipmentDbErrorMessage(error, 'No fue posible eliminar el equipo.')
      )}`
    );
  }
});

router.get('/solicitar', requireSolicitudesAuthorized, async function (req, res) {
  try {
    const usuario = await fetchSessionUsuario(req);
    const sancionesActivas = usuario ? await fetchActiveSanctionsCount(usuario.id) : 0;

    return res.render('home/prestamos/solicitudes/solicitar', {
      successMessage: sanitizeText(req.query.success),
      errorMessage: sanitizeText(req.query.error),
      sancionesActivas,
    });
  } catch (error) {
    console.error('Error cargando formulario de solicitudes MiLab:', error);
    return res.render('home/prestamos/solicitudes/solicitar', {
      successMessage: '',
      errorMessage: 'No fue posible cargar el formulario de solicitudes.',
      sancionesActivas: 0,
    });
  }
});

router.get('/solicitar/consultar', requireSolicitudesAuthorized, async function (req, res) {
  const facultad = sanitizeText(req.query.facultad);
  const laboratorio = sanitizeText(req.query.laboratorio);

  if (!facultad || !laboratorio) {
    return res.redirect(
      '/milab/prestamos/solicitar?error=Debes seleccionar una facultad y un laboratorio.'
    );
  }

  try {
    const equipos = await fetchPrestamoEquipos(facultad, laboratorio);

    return res.render('home/prestamos/solicitudes/equipos-disponibles', {
      equipos,
      facultad,
      laboratorio,
      successMessage: sanitizeText(req.query.success),
      errorMessage: sanitizeText(req.query.error),
    });
  } catch (error) {
    console.error('Error consultando equipos disponibles MiLab:', error);
    return res.redirect(
      `/milab/prestamos/solicitar?error=${encodeURIComponent(
        resolveLoanDbErrorMessage(error, 'No fue posible consultar los equipos disponibles.')
      )}`
    );
  }
});

router.get('/api/facultades', requireSolicitudesAuthorized, async function (req, res) {
  try {
    const facultades = await fetchPrestamoFacultades();
    return res.json({ success: true, facultades });
  } catch (error) {
    console.error('Error consultando facultades para prestamos MiLab:', error);
    return res.status(500).json({
      success: false,
      message: 'No fue posible cargar las facultades.',
    });
  }
});

router.get('/api/laboratorios/:facultad', requireSolicitudesAuthorized, async function (req, res) {
  const facultad = sanitizeText(req.params.facultad);

  if (!facultad) {
    return res.status(400).json({
      success: false,
      message: 'La facultad es obligatoria.',
    });
  }

  try {
    const laboratorios = await fetchPrestamoLaboratorios(facultad);
    return res.json({ success: true, laboratorios });
  } catch (error) {
    console.error('Error consultando laboratorios para prestamos MiLab:', error);
    return res.status(500).json({
      success: false,
      message: 'No fue posible cargar los laboratorios.',
    });
  }
});

router.get(
  '/api/equipos/:id/disponibilidad',
  requireSolicitudesAuthorized,
  async function (req, res) {
    if (!isValidEquipmentId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'El equipo seleccionado no es valido.',
      });
    }

    try {
      const disponibilidad = await buildEquipmentLoanAvailability(req.params.id);

      if (!disponibilidad) {
        return res.status(404).json({
          success: false,
          message: 'El equipo no existe.',
        });
      }

      return res.json({
        success: true,
        disponibilidad: {
          equipo: disponibilidad.equipo,
          horariosDisponibles: disponibilidad.horariosDisponibles,
          mensaje: disponibilidad.usaHorariosConfigurados
            ? 'Se encontraron horarios configurados para este equipo.'
            : 'El equipo no tiene horarios configurados, se muestran franjas sugeridas por defecto.',
        },
      });
    } catch (error) {
      console.error('Error consultando disponibilidad de equipo MiLab:', error);
      return res.status(500).json({
        success: false,
        message: resolveLoanDbErrorMessage(error, 'No fue posible consultar la disponibilidad.'),
      });
    }
  }
);

router.post('/solicitudes/crear', requireSolicitudesAuthorized, async function (req, res) {
  const payload = buildLoanRequestPayload(req.body);
  const validationError = validateLoanRequestPayload(payload);

  if (validationError) {
    return res.status(400).json({
      success: false,
      message: validationError,
    });
  }

  try {
    const usuario = await fetchSessionUsuario(req);

    if (!usuario) {
      return res.status(401).json({
        success: false,
        message: 'No fue posible identificar al usuario autenticado.',
      });
    }

    const sancionesActivas = await fetchActiveSanctionsCount(usuario.id);
    if (sancionesActivas > 0) {
      return res.status(400).json({
        success: false,
        message: 'Tienes sanciones activas y no puedes solicitar equipos por ahora.',
      });
    }

    const disponibilidad = await buildEquipmentLoanAvailability(payload.equipo_id);

    if (!disponibilidad) {
      return res.status(404).json({
        success: false,
        message: 'El equipo no existe.',
      });
    }

    const selectedDate = payload.fecha_inicio.slice(0, 10);
    const selectedStartTime = payload.fecha_inicio.slice(11, 16);
    const selectedEndTime = payload.fecha_fin.slice(11, 16);

    const selectedSlot = disponibilidad.horariosDisponibles.find(
      (slot) =>
        slot.fecha === selectedDate &&
        slot.horaInicio === selectedStartTime &&
        slot.horaFin === selectedEndTime
    );

    if (!selectedSlot) {
      return res.status(400).json({
        success: false,
        message: 'El horario seleccionado no coincide con la disponibilidad del equipo.',
      });
    }

    const shouldQueueRequest = !selectedSlot.disponible;

    const fechaInicio = parseBogotaDateTime(payload.fecha_inicio);
    const fechaFin = parseBogotaDateTime(payload.fecha_fin);
    const requestedHours = (fechaFin.getTime() - fechaInicio.getTime()) / (1000 * 60 * 60);

    const globalParameters = await fetchGlobalLoanPracticeParameters();
    const monthlyLoanLimit = Number(globalParameters.max_horas_mes_prestamos || 0);
    if (Number.isFinite(monthlyLoanLimit) && monthlyLoanLimit > 0) {
      const usedHoursThisMonth = await calculateMonthlyLoanHours(usuario.id);
      if (usedHoursThisMonth + requestedHours > monthlyLoanLimit) {
        return res.status(400).json({
          success: false,
          message: `Has alcanzado el limite mensual de ${monthlyLoanLimit} hora(s) para prestamos. Llevas ${usedHoursThisMonth.toFixed(2)} hora(s) y esta solicitud agrega ${requestedHours.toFixed(2)} hora(s).`,
        });
      }
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const equipmentResult = await client.query(
        `
          SELECT id, codigo, nombre, facultad, laboratorio
          FROM equipo
          WHERE id = $1
          LIMIT 1
        `,
        [Number(payload.equipo_id)]
      );

      const equipo = equipmentResult.rows[0] || null;
      const insertColumns = [
        'usuario_id',
        'equipo_id',
        'fecha_inicio',
        'fecha_fin',
        'justificacion_academica',
        'categoria_practica',
        'estado',
        'tipo_aprobacion',
        'firma_digital',
        'fecha_firma',
      ];
      const insertValues = [
        usuario.id,
        Number(payload.equipo_id),
        fechaInicio,
        fechaFin,
        payload.justificacion_academica,
        payload.categoria_practica,
        shouldQueueRequest ? 'en_cola' : 'pendiente',
        'manual',
        payload.firma_digital,
        payload.firma_digital ? new Date() : null,
      ];

      const insertPlaceholders = insertValues.map(function (_, index) {
        return `$${index + 1}`;
      });
      const result = await client.query(
        `
          INSERT INTO solicitud_prestamo (
            ${insertColumns.join(', ')}
          )
          VALUES (${insertPlaceholders.join(', ')})
          RETURNING id, fecha_creacion
        `,
        insertValues
      );

      if (shouldQueueRequest) {
        await client.query(
          `
            INSERT INTO cola_solicitud (
              tipo,
              estado,
              usuario_id,
              equipo_id,
              laboratorio,
              fecha_inicio,
              fecha_fin,
              observaciones,
              referencia_id
            )
            VALUES ('prestamo', 'pendiente', $1, $2, $3, $4, $5, $6, $7)
          `,
          [
            usuario.id,
            Number(payload.equipo_id),
            sanitizeText(equipo?.laboratorio),
            fechaInicio,
            fechaFin,
            payload.justificacion_academica,
            result.rows[0]?.id || null,
          ]
        );
      }

      await client.query('COMMIT');

      sendPrestamosNotification({
        sourceSystem: 'prestamos',
        templateName: shouldQueueRequest
          ? 'prestamos/solicitud_en_cola'
          : 'prestamos/reserva_solicitada',
        recipient: usuario.correo,
        subject: shouldQueueRequest
          ? 'Solicitud en cola de espera'
          : 'Solicitud de prestamo registrada',
        variables: {
          usuarioNombre: usuario.nombre || 'Usuario',
          solicitudId: result.rows[0]?.id || '',
          equipoNombre: equipo?.nombre || 'Equipo',
          fechaInicio: formatPdfDateTime(fechaInicio),
          fechaFin: formatPdfDateTime(fechaFin),
          appUrl: getMilabAppUrl(),
          seguimientoPath: '/prestamos/mis-solicitudes',
        },
        correlationId: `prestamo-solicitud-${result.rows[0]?.id || 'nuevo'}`,
      });

      return res.json({
        success: true,
        en_cola: shouldQueueRequest,
        message: shouldQueueRequest
          ? 'Horario ocupado. Tu solicitud quedo en cola de espera.'
          : 'Solicitud de prestamo creada exitosamente',
        solicitud: result.rows[0] || null,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error creando solicitud de prestamo MiLab:', error);
    return res.status(500).json({
      success: false,
      message: resolveLoanDbErrorMessage(error, 'No fue posible crear la solicitud.'),
    });
  }
});

router.get('/mis-solicitudes', requireMisSolicitudesAuthorized, async function (req, res) {
  try {
    const usuario = await fetchSessionUsuario(req);

    if (!usuario) {
      return res.render('home/prestamos/solicitudes/mis-solicitudes', {
        solicitudes: [],
        ultimaHoraSolicitudes: [],
        successMessage: '',
        errorMessage: 'No fue posible identificar al usuario autenticado.',
      });
    }

    const ultimaHoraResult = await pool.query(
      `
        SELECT
          c.id AS cola_id,
          c.fecha_inicio,
          c.fecha_fin,
          c.observaciones,
          c.referencia_id AS solicitud_base_id,
          e.codigo AS equipo_codigo,
          e.nombre AS equipo_nombre,
          e.laboratorio,
          COALESCE(e.facultad, f.nombre) AS facultad
        FROM cola_solicitud c
        JOIN equipo e
          ON e.id = c.equipo_id
        LEFT JOIN ual u
          ON UPPER(u.nombre) = UPPER(e.laboratorio)
        LEFT JOIN facultad f
          ON f.facultad_id = u.facultad_id
        WHERE c.usuario_id = $1
          AND c.tipo = 'prestamo'
          AND c.estado = 'pendiente'
          AND (
            c.observaciones ILIKE '%ultima_hora%'
            OR c.observaciones ILIKE '%ultima hora%'
          )
        ORDER BY c.fecha_creacion DESC, c.id DESC
      `,
      [usuario.id]
    );

    const result = await pool.query(
      `
        SELECT
          sp.id,
          sp.fecha_inicio,
          sp.fecha_fin,
          sp.justificacion_academica,
          sp.categoria_practica,
          sp.estado,
          sp.motivo_rechazo,
          sp.fecha_creacion,
          e.codigo AS equipo_codigo,
          e.nombre AS equipo_nombre,
          e.descripcion AS equipo_descripcion,
          e.laboratorio,
          COALESCE(e.facultad, f.nombre) AS facultad
        FROM solicitud_prestamo sp
        JOIN equipo e
          ON e.id = sp.equipo_id
        LEFT JOIN ual u
          ON UPPER(u.nombre) = UPPER(e.laboratorio)
        LEFT JOIN facultad f
          ON f.facultad_id = u.facultad_id
        WHERE sp.usuario_id = $1
        ORDER BY sp.fecha_creacion DESC, sp.id DESC
      `,
      [usuario.id]
    );

    return res.render('home/prestamos/solicitudes/mis-solicitudes', {
      solicitudes: result.rows || [],
      ultimaHoraSolicitudes: ultimaHoraResult.rows || [],
      successMessage: sanitizeText(req.query.success),
      errorMessage: sanitizeText(req.query.error),
    });
  } catch (error) {
    console.error('Error consultando mis solicitudes MiLab:', error);
    return res.render('home/prestamos/solicitudes/mis-solicitudes', {
      solicitudes: [],
      ultimaHoraSolicitudes: [],
      successMessage: '',
      errorMessage: resolveLoanDbErrorMessage(error, 'No fue posible cargar tus solicitudes.'),
    });
  }
});

router.get(
  '/solicitudes/:id/comprobante-pdf',
  requirePrestamosDocumentAccess,
  async function (req, res) {
    if (!isValidLoanRequestId(req.params.id)) {
      return res.status(400).send('La solicitud seleccionada no es valida.');
    }

    try {
      const loan = await fetchLoanDocumentRecord(req, req.params.id);

      if (!loan) {
        return res.status(404).send('La solicitud no existe o no tienes permisos para verla.');
      }

      if (!['aprobado', 'activo', 'finalizado', 'completado'].includes(loan.estado)) {
        return res
          .status(403)
          .send(
            'El comprobante solo esta disponible para solicitudes aprobadas, activas o finalizadas.'
          );
      }

      return sendLoanComprobantePdf(res, loan);
    } catch (error) {
      console.error('Error generando comprobante PDF de prestamo MiLab:', error);
      return res.status(500).send('No fue posible generar el comprobante PDF.');
    }
  }
);

router.get('/api/reglamento/descargar', requireSolicitudesAuthorized, async function (req, res) {
  try {
    return sendLoanGeneralReglamentoPdf(res);
  } catch (error) {
    console.error('Error generando reglamento general de prestamos MiLab:', error);
    return res.status(500).send('No fue posible generar el reglamento.');
  }
});

router.get(
  '/solicitudes/:id/reglamento-pdf',
  requirePrestamosDocumentAccess,
  async function (req, res) {
    if (!isValidLoanRequestId(req.params.id)) {
      return res.status(400).send('La solicitud seleccionada no es valida.');
    }

    try {
      const loan = await fetchLoanDocumentRecord(req, req.params.id);

      if (!loan) {
        return res.status(404).send('La solicitud no existe o no tienes permisos para verla.');
      }

      return sendLoanReglamentoPdf(res, loan);
    } catch (error) {
      console.error('Error generando reglamento PDF de prestamo MiLab:', error);
      return res.status(500).send('No fue posible generar el reglamento PDF.');
    }
  }
);

router.get('/gestion-solicitudes', requireGestionSolicitudesAuthorized, async function (req, res) {
  try {
    const scope = await resolveLoanManagementScope(req);
    let solicitudes = [];

    if (scope.unrestricted || scope.facultyIds.length) {
      const params = [];
      const whereParts = ["sp.estado IN ('pendiente', 'en_cola')"];

      if (!scope.unrestricted) {
        params.push(scope.facultyIds);
        whereParts.push(`f.facultad_id = ANY($${params.length}::int[])`);
      }

      const laboratoryClause = buildLaboratoryNameScopeClause('e.laboratorio', scope, params);
      if (laboratoryClause) {
        whereParts.push(laboratoryClause.replace(/^\s*AND\s+/i, ''));
      }

      const result = await pool.query(
        `
          SELECT
            sp.id,
            e.id AS equipo_id,
            sp.fecha_inicio,
            sp.fecha_fin,
            sp.justificacion_academica,
            sp.categoria_practica,
            sp.estado,
            sp.tipo_aprobacion,
            sp.fecha_creacion,
            sp.firma_digital,
            e.codigo AS equipo_codigo,
            e.nombre AS equipo_nombre,
            e.descripcion AS equipo_descripcion,
            e.laboratorio,
            COALESCE(e.facultad, f.nombre) AS facultad,
            u.nombre AS usuario_nombre,
            u.documento AS usuario_documento,
            u.correo AS usuario_correo
          FROM solicitud_prestamo sp
          JOIN equipo e
            ON e.id = sp.equipo_id
          JOIN usuario u
            ON u.id = sp.usuario_id
          LEFT JOIN ual ul
            ON UPPER(ul.nombre) = UPPER(e.laboratorio)
          LEFT JOIN facultad f
            ON f.facultad_id = ul.facultad_id
          WHERE ${whereParts.join(' AND ')}
          ORDER BY sp.fecha_inicio ASC, sp.fecha_creacion ASC, sp.id ASC
        `,
        params
      );

      solicitudes = result.rows || [];
      const now = new Date();

      for (const solicitud of solicitudes) {
        if (solicitud.estado !== 'en_cola') {
          continue;
        }

        solicitud.cupo_libre = false;
        solicitud.puede_ultima_hora = false;
        solicitud.cola_id = null;
        solicitud.solicitud_fuente_id = null;

        try {
          const queueResult = await pool.query(
            `
              SELECT id
              FROM cola_solicitud
              WHERE tipo = 'prestamo'
                AND estado = 'pendiente'
                AND referencia_id = $1
              LIMIT 1
            `,
            [solicitud.id]
          );
          solicitud.cola_id = queueResult.rows[0]?.id || null;
        } catch {
          solicitud.cola_id = null;
        }

        try {
          const overlapResult = await pool.query(
            `
              SELECT id, estado, fecha_inicio, fecha_fin
              FROM solicitud_prestamo
              WHERE equipo_id = $1
                AND id <> $2
                AND estado IN ('aprobado', 'activo')
                AND fecha_inicio < $4
                AND fecha_fin > $3
            `,
            [solicitud.equipo_id, solicitud.id, solicitud.fecha_inicio, solicitud.fecha_fin]
          );
          const overlaps = overlapResult.rows || [];
          solicitud.cupo_libre = overlaps.length === 0;

          let sourceRequestId = null;
          for (const overlap of overlaps) {
            const overlapStart = new Date(overlap.fecha_inicio);
            const overlapEnd = new Date(overlap.fecha_fin);
            if (
              overlap.estado === 'aprobado' &&
              now.getTime() >= overlapStart.getTime() + 15 * 60 * 1000 &&
              overlapEnd.getTime() > now.getTime()
            ) {
              sourceRequestId = overlap.id;
              break;
            }
          }

          solicitud.puede_ultima_hora = !!sourceRequestId;
          solicitud.solicitud_fuente_id = sourceRequestId;
        } catch {
          solicitud.cupo_libre = false;
          solicitud.puede_ultima_hora = false;
          solicitud.solicitud_fuente_id = null;
        }
      }
    }

    return res.render('home/prestamos/solicitudes/gestion-solicitudes', {
      solicitudes,
      successMessage: sanitizeText(req.query.success),
      errorMessage: sanitizeText(req.query.error),
    });
  } catch (error) {
    console.error('Error cargando gestion de solicitudes MiLab:', error);
    return res.render('home/prestamos/solicitudes/gestion-solicitudes', {
      solicitudes: [],
      successMessage: '',
      errorMessage: resolveLoanDbErrorMessage(
        error,
        'No fue posible cargar las solicitudes pendientes.'
      ),
    });
  }
});

router.post(
  '/gestion-solicitudes/:id/aprobar',
  requireGestionSolicitudesAuthorized,
  async function (req, res) {
    if (!isValidLoanRequestId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'La solicitud seleccionada no es valida.',
      });
    }

    try {
      const scope = await resolveLoanManagementScope(req);
      const solicitud = await fetchManagedLoanRequest(req.params.id, scope);

      if (!solicitud) {
        return res.status(404).json({
          success: false,
          message: 'La solicitud no existe o no pertenece a tu alcance de gestion.',
        });
      }

      if (!['pendiente', 'en_cola'].includes(solicitud.estado)) {
        return res.status(409).json({
          success: false,
          message: 'La solicitud ya fue procesada.',
        });
      }

      const overlapResult = await pool.query(
        `
          SELECT 1
          FROM solicitud_prestamo
          WHERE equipo_id = $1
            AND id <> $2
            AND estado IN ('aprobado', 'activo')
            AND fecha_inicio < $4
            AND fecha_fin > $3
          LIMIT 1
        `,
        [solicitud.equipo_id, solicitud.id, solicitud.fecha_inicio, solicitud.fecha_fin]
      );

      if (overlapResult.rows.length) {
        return res.status(409).json({
          success: false,
          message: 'Ya existe otra solicitud aprobada o activa en ese horario.',
        });
      }

      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const sessionUsuario = await fetchSessionUsuario(req);

        const result = await client.query(
          `
            UPDATE solicitud_prestamo
            SET estado = 'aprobado',
                tipo_aprobacion = 'manual',
                motivo_rechazo = NULL,
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $1
              AND estado IN ('pendiente', 'en_cola')
            RETURNING id
          `,
          [solicitud.id]
        );

        if (!result.rows.length) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            success: false,
            message: 'La solicitud ya fue procesada por otro usuario.',
          });
        }

        if (solicitud.estado === 'en_cola') {
          await updateLoanQueueEntryStatus(client, solicitud.id, 'atendida', sessionUsuario?.id);
        }

        await client.query('COMMIT');

        await registerPrestamosAuditEntry({
          req,
          accion: 'Aprobar Solicitud Prestamo',
          persona: `Solicitud: ${solicitud.id}`,
        });

        const recipientProfile = await fetchUserNotificationProfile(solicitud.usuario_id);
        sendPrestamosNotification({
          sourceSystem: 'prestamos',
          templateName: 'prestamos/reserva_aprobada',
          recipient: recipientProfile?.correo,
          subject: 'Solicitud de prestamo aprobada',
          variables: {
            usuarioNombre: recipientProfile?.nombre || 'Usuario',
            solicitudId: solicitud.id,
            equipoNombre: solicitud.equipo_nombre || 'Equipo',
            fechaInicio: formatPdfDateTime(solicitud.fecha_inicio),
            fechaFin: formatPdfDateTime(solicitud.fecha_fin),
            appUrl: getMilabAppUrl(),
          },
          correlationId: `prestamo-aprobado-${solicitud.id}`,
        });

        return res.json({
          success: true,
          message: 'Solicitud aprobada correctamente.',
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error aprobando solicitud MiLab:', error);
      return res.status(500).json({
        success: false,
        message: resolveLoanDbErrorMessage(error, 'No fue posible aprobar la solicitud.'),
      });
    }
  }
);

router.post(
  '/gestion-solicitudes/:id/rechazar',
  requireGestionSolicitudesAuthorized,
  async function (req, res) {
    if (!isValidLoanRequestId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'La solicitud seleccionada no es valida.',
      });
    }

    try {
      const scope = await resolveLoanManagementScope(req);
      const solicitud = await fetchManagedLoanRequest(req.params.id, scope);

      if (!solicitud) {
        return res.status(404).json({
          success: false,
          message: 'La solicitud no existe o no pertenece a tu alcance de gestion.',
        });
      }

      if (!['pendiente', 'en_cola'].includes(solicitud.estado)) {
        return res.status(409).json({
          success: false,
          message: 'La solicitud ya fue procesada.',
        });
      }

      const rejectionReason = sanitizeText(req.body.motivo_rechazo || req.body.motivoRechazo);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const sessionUsuario = await fetchSessionUsuario(req);

        const result = await client.query(
          `
            UPDATE solicitud_prestamo
            SET estado = 'rechazado',
                motivo_rechazo = $2,
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $1
              AND estado IN ('pendiente', 'en_cola')
            RETURNING id
          `,
          [solicitud.id, rejectionReason || 'Sin motivo especificado']
        );

        if (!result.rows.length) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            success: false,
            message: 'La solicitud ya fue procesada por otro usuario.',
          });
        }

        if (solicitud.estado === 'en_cola') {
          await updateLoanQueueEntryStatus(client, solicitud.id, 'cancelada', sessionUsuario?.id);
        }

        await client.query('COMMIT');

        await registerPrestamosAuditEntry({
          req,
          accion: 'Rechazar Solicitud Prestamo',
          persona: `Solicitud: ${solicitud.id}`,
        });

        const recipientProfile = await fetchUserNotificationProfile(solicitud.usuario_id);
        sendPrestamosNotification({
          sourceSystem: 'prestamos',
          templateName: 'prestamos/reserva_rechazada',
          recipient: recipientProfile?.correo,
          subject: 'Solicitud de prestamo rechazada',
          variables: {
            usuarioNombre: recipientProfile?.nombre || 'Usuario',
            solicitudId: solicitud.id,
            equipoNombre: solicitud.equipo_nombre || 'Equipo',
            fechaInicio: formatPdfDateTime(solicitud.fecha_inicio),
            fechaFin: formatPdfDateTime(solicitud.fecha_fin),
            motivoRechazo: rejectionReason || 'Sin motivo especificado',
            appUrl: getMilabAppUrl(),
          },
          correlationId: `prestamo-rechazado-${solicitud.id}`,
        });

        return res.json({
          success: true,
          message: 'Solicitud rechazada correctamente.',
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error rechazando solicitud MiLab:', error);
      return res.status(500).json({
        success: false,
        message: resolveLoanDbErrorMessage(error, 'No fue posible rechazar la solicitud.'),
      });
    }
  }
);

router.get('/entrega-equipos', requireEntregaEquiposAuthorized, async function (req, res) {
  try {
    const scope = await resolveLoanManagementScope(req);
    let solicitudes = [];
    let colasPrestamo = [];

    if (scope.unrestricted || scope.facultyIds.length) {
      const params = [];
      const whereParts = ["sp.estado IN ('aprobado', 'activo')"];

      if (!scope.unrestricted) {
        params.push(scope.facultyIds);
        whereParts.push(`f.facultad_id = ANY($${params.length}::int[])`);
      }

      const laboratoryClause = buildLaboratoryNameScopeClause('e.laboratorio', scope, params);
      if (laboratoryClause) {
        whereParts.push(laboratoryClause.replace(/^\s*AND\s+/i, ''));
      }

      const result = await pool.query(
        `
          SELECT
            sp.id,
            sp.fecha_inicio,
            sp.fecha_fin,
            sp.justificacion_academica,
            sp.categoria_practica,
            sp.estado,
            sp.fecha_creacion,
            e.id AS equipo_id,
            e.codigo AS equipo_codigo,
            e.nombre AS equipo_nombre,
            e.descripcion AS equipo_descripcion,
            e.laboratorio,
            e.estado AS equipo_estado,
            EXISTS (
              SELECT 1
              FROM incidencia i
              WHERE i.equipo_id = e.id
                AND i.estado <> 'cerrada'
            ) AS incidencia_activa,
            (
              SELECT i.descripcion
              FROM incidencia i
              WHERE i.equipo_id = e.id
                AND i.estado <> 'cerrada'
              ORDER BY i.fecha_creacion DESC
              LIMIT 1
            ) AS incidencia_descripcion,
            COALESCE(e.facultad, f.nombre) AS facultad,
            u.nombre AS usuario_nombre,
            u.documento AS usuario_documento,
            u.correo AS usuario_correo,
            ee.id AS entrega_id,
            ee.fecha_entrega,
            ee.fecha_devolucion_esperada,
            ee.condicion_entrega,
            ee.fecha_devolucion_real,
            ee.condicion_devolucion,
            ee.lista_componentes
          FROM solicitud_prestamo sp
          JOIN equipo e
            ON e.id = sp.equipo_id
          JOIN usuario u
            ON u.id = sp.usuario_id
          LEFT JOIN entrega_equipo ee
            ON ee.solicitud_prestamo_id = sp.id
          LEFT JOIN ual ul
            ON UPPER(ul.nombre) = UPPER(e.laboratorio)
          LEFT JOIN facultad f
            ON f.facultad_id = ul.facultad_id
          WHERE ${whereParts.join(' AND ')}
          ORDER BY sp.estado ASC, sp.fecha_inicio ASC, sp.id ASC
        `,
        params
      );

      solicitudes = (result.rows || []).map(function (item) {
        const eligibility = buildLastMinuteEligibilityResult(item.fecha_inicio, item.fecha_fin);
        return {
          ...item,
          habilitarUltimaHora: String(item.estado || '') === 'aprobado' && eligibility.allowed,
        };
      });

      const queueParams = [];
      const queueWhereParts = ["c.tipo = 'prestamo'", "c.estado = 'pendiente'"];

      if (!scope.unrestricted) {
        queueParams.push(scope.facultyIds);
        queueWhereParts.push(`f.facultad_id = ANY($${queueParams.length}::int[])`);
      }

      const queueLaboratoryClause = buildLaboratoryNameScopeClause(
        'COALESCE(e.laboratorio, c.laboratorio)',
        scope,
        queueParams
      );
      if (queueLaboratoryClause) {
        queueWhereParts.push(queueLaboratoryClause.replace(/^\s*AND\s+/i, ''));
      }

      const queueResult = await pool.query(
        `
          SELECT
            c.id,
            c.referencia_id,
            c.usuario_id,
            c.equipo_id,
            c.laboratorio,
            c.fecha_inicio,
            c.fecha_fin,
            c.observaciones,
            e.nombre AS equipo_nombre,
            e.codigo AS equipo_codigo,
            u.nombre AS usuario_nombre,
            u.documento AS usuario_documento,
            u.correo AS usuario_correo
          FROM cola_solicitud c
          JOIN usuario u
            ON u.id = c.usuario_id
          LEFT JOIN equipo e
            ON e.id = c.equipo_id
          LEFT JOIN ual ul
            ON UPPER(ul.nombre) = UPPER(COALESCE(e.laboratorio, c.laboratorio))
          LEFT JOIN facultad f
            ON f.facultad_id = ul.facultad_id
          WHERE ${queueWhereParts.join(' AND ')}
          ORDER BY c.fecha_inicio ASC, c.id ASC
        `,
        queueParams
      );

      colasPrestamo = queueResult.rows || [];
    }

    return res.render('home/prestamos/solicitudes/entrega-equipos', {
      solicitudes,
      colasPrestamo,
      successMessage: sanitizeText(req.query.success),
      errorMessage: sanitizeText(req.query.error),
    });
  } catch (error) {
    console.error('Error cargando entrega y devolucion MiLab:', error);
    return res.render('home/prestamos/solicitudes/entrega-equipos', {
      solicitudes: [],
      colasPrestamo: [],
      successMessage: '',
      errorMessage: resolveLoanDbErrorMessage(
        error,
        'No fue posible cargar las solicitudes para entrega y devolucion.'
      ),
    });
  }
});

router.post(
  '/entrega-equipos/:id/marcar-prestado',
  requireEntregaEquiposAuthorized,
  async function (req, res) {
    if (!isValidLoanRequestId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'La solicitud seleccionada no es valida.',
      });
    }

    const payload = buildLoanDeliveryPayload(req.body);
    if (!payload.condicion_entrega) {
      return res.status(400).json({
        success: false,
        message: 'La condicion de la entrega es obligatoria.',
      });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const scope = await resolveLoanManagementScope(req);
      const solicitud = await fetchManagedDeliveryLoanRequest(req.params.id, scope);

      if (!solicitud) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'La solicitud no existe o no pertenece a tu alcance de gestion.',
        });
      }

      if (solicitud.estado !== 'aprobado') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: 'Solo las solicitudes aprobadas pueden marcarse como prestadas.',
        });
      }

      const sessionUsuario = await fetchSessionUsuario(req);

      const updateRequest = await client.query(
        `
          UPDATE solicitud_prestamo
          SET estado = 'activo',
              fecha_modificacion = CURRENT_TIMESTAMP
          WHERE id = $1
            AND estado = 'aprobado'
          RETURNING id
        `,
        [solicitud.id]
      );

      if (!updateRequest.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: 'La solicitud ya fue procesada por otro usuario.',
        });
      }

      await client.query(
        `
          INSERT INTO entrega_equipo (
            solicitud_prestamo_id,
            fecha_entrega,
            fecha_devolucion_esperada,
            condicion_entrega,
            creado_por_id,
            firma_digital,
            fecha_firma,
            fecha_modificacion
          )
          VALUES (
            $1,
            CURRENT_TIMESTAMP,
            $2,
            $3,
            $4,
            $5,
            $6,
            CURRENT_TIMESTAMP
          )
          ON CONFLICT (solicitud_prestamo_id) DO UPDATE
          SET fecha_entrega = EXCLUDED.fecha_entrega,
              fecha_devolucion_esperada = EXCLUDED.fecha_devolucion_esperada,
              condicion_entrega = EXCLUDED.condicion_entrega,
              creado_por_id = EXCLUDED.creado_por_id,
              firma_digital = EXCLUDED.firma_digital,
              fecha_firma = EXCLUDED.fecha_firma,
              fecha_modificacion = CURRENT_TIMESTAMP
        `,
        [
          solicitud.id,
          solicitud.fecha_fin,
          payload.condicion_entrega,
          sessionUsuario?.id || null,
          sanitizeText(solicitud.firma_digital) || null,
          sanitizeText(solicitud.firma_digital) ? new Date() : null,
        ]
      );

      await client.query(
        `
          UPDATE equipo
          SET estado = 'prestado',
              fecha_modificacion = CURRENT_TIMESTAMP
          WHERE id = $1
        `,
        [solicitud.equipo_id]
      );

      await client.query('COMMIT');

      await registerPrestamosAuditEntry({
        req,
        accion: 'Entregar equipo (Prestamo)',
        persona: `Solicitud: ${solicitud.id}`,
      });

      return res.json({
        success: true,
        message: 'Equipo entregado y solicitud marcada como activa.',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error marcando equipo como prestado MiLab:', error);
      return res.status(500).json({
        success: false,
        message: resolveLoanDbErrorMessage(
          error,
          'No fue posible registrar la entrega del equipo.'
        ),
      });
    } finally {
      client.release();
    }
  }
);

router.post(
  '/entrega-equipos/:id/ultima-hora',
  requireEntregaEquiposAuthorized,
  async function (req, res) {
    if (!isValidLoanRequestId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'La solicitud seleccionada no es valida.',
      });
    }

    const documento = sanitizeText(
      req.body.documento || req.body.usuario_documento || req.body.codigo
    );

    if (!documento) {
      return res.status(400).json({
        success: false,
        message: 'Debes indicar el documento del usuario destino.',
      });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const scope = await resolveLoanManagementScope(req);
      const solicitud = await fetchManagedDeliveryLoanRequest(req.params.id, scope);

      if (!solicitud) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'La solicitud no existe o no pertenece a tu alcance de gestion.',
        });
      }

      if (solicitud.estado !== 'aprobado') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: 'Solo las solicitudes aprobadas pueden reasignarse por ultima hora.',
        });
      }

      const eligibility = buildLastMinuteEligibilityResult(
        solicitud.fecha_inicio,
        solicitud.fecha_fin
      );
      if (!eligibility.allowed) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: eligibility.message,
        });
      }

      const usuarioDestino = await fetchUserByDocumentOrCode(documento);
      if (!usuarioDestino?.id) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'El usuario destino no existe en el sistema.',
        });
      }

      const globalParameters = await fetchGlobalLoanPracticeParameters();
      const monthlyLoanLimit = Number(globalParameters.max_horas_mes_prestamos || 0);
      const requestedHours =
        (eligibility.endDate.getTime() - eligibility.now.getTime()) / (1000 * 60 * 60);
      if (Number.isFinite(monthlyLoanLimit) && monthlyLoanLimit > 0) {
        const usedHoursThisMonth = await calculateMonthlyLoanHours(usuarioDestino.id);
        if (usedHoursThisMonth + requestedHours > monthlyLoanLimit) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: `El usuario destino supera la cuota mensual de ${monthlyLoanLimit} hora(s) para prestamos.`,
          });
        }
      }

      const updateResult = await client.query(
        `
          UPDATE solicitud_prestamo
          SET estado = 'cancelado',
              motivo_rechazo = 'No asistió - prestamo de ultima hora',
              fecha_modificacion = CURRENT_TIMESTAMP
          WHERE id = $1
            AND estado = 'aprobado'
          RETURNING id
        `,
        [solicitud.id]
      );

      if (!updateResult.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Solicitud no encontrada o no elegible para ultima hora.',
        });
      }

      const queueMeta = JSON.stringify({
        tipo: 'ultima_hora',
        sourceSolicitudId: solicitud.id,
      });

      const queueResult = await client.query(
        `
          INSERT INTO cola_solicitud (
            tipo,
            estado,
            usuario_id,
            equipo_id,
            laboratorio,
            fecha_inicio,
            fecha_fin,
            observaciones,
            referencia_id
          )
          VALUES ('prestamo', 'pendiente', $1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id, fecha_inicio, fecha_fin
        `,
        [
          usuarioDestino.id,
          solicitud.equipo_id,
          sanitizeText(solicitud.equipo_laboratorio),
          eligibility.now,
          eligibility.endDate,
          queueMeta,
          solicitud.id,
          solicitud.id,
        ]
      );

      await client.query('COMMIT');

      await registerPrestamosAuditEntry({
        req,
        accion: 'Prestamo de ultima hora',
        persona: `Solicitud base: ${solicitud.id} - Cola ultima hora: ${queueResult.rows[0]?.id || '-'}`,
      });

      sendPrestamosNotification({
        sourceSystem: 'prestamos',
        templateName: 'prestamos/ultima_hora_pendiente_firma',
        recipient: usuarioDestino.correo,
        subject: 'Prestamo de ultima hora disponible (firma requerida)',
        variables: {
          usuarioNombre: usuarioDestino.nombre || 'Usuario',
          solicitudId: queueResult.rows[0]?.id || '',
          equipoNombre: solicitud.equipo_nombre || 'Equipo',
          fechaInicio: formatPdfDateTime(queueResult.rows[0]?.fecha_inicio || eligibility.now),
          fechaFin: formatPdfDateTime(queueResult.rows[0]?.fecha_fin || eligibility.endDate),
          appUrl: getMilabAppUrl(),
          seguimientoPath: '/prestamos/mis-solicitudes',
        },
        correlationId: `prestamo-ultima-hora-cola-${queueResult.rows[0]?.id || 'nuevo'}`,
      });

      return res.json({
        success: true,
        message:
          'Prestamo de ultima hora enviado. El usuario debe firmar y enviar desde "Mis solicitudes" para poder entregarlo.',
        colaId: queueResult.rows[0]?.id || null,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error procesando prestamo de ultima hora MiLab:', error);
      return res.status(500).json({
        success: false,
        message: resolveLoanDbErrorMessage(
          error,
          'No fue posible procesar el prestamo de ultima hora.'
        ),
      });
    } finally {
      client.release();
    }
  }
);

router.post(
  '/mis-solicitudes/ultima-hora/:colaId/aceptar',
  requireMisSolicitudesAuthorized,
  async function (req, res) {
    if (!isValidLoanRequestId(req.params.colaId)) {
      return res.status(400).json({
        success: false,
        message: 'La solicitud de ultima hora no es valida.',
      });
    }

    const firmaDigital = sanitizeText(req.body?.firma_digital || req.body?.firmaDigital);
    if (!firmaDigital || firmaDigital.length < 5) {
      return res.status(400).json({
        success: false,
        message: 'La firma digital es obligatoria.',
      });
    }

    try {
      const usuario = await fetchSessionUsuario(req);
      if (!usuario?.id) {
        return res.status(401).json({
          success: false,
          message: 'No fue posible identificar el usuario de la sesion.',
        });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const colaResult = await client.query(
          `
            SELECT
              c.id,
              c.usuario_id,
              c.equipo_id,
              c.fecha_inicio,
              c.fecha_fin,
              c.observaciones,
              c.referencia_id,
              c.estado,
              e.nombre AS equipo_nombre,
              e.codigo AS equipo_codigo,
              e.laboratorio AS equipo_laboratorio,
              COALESCE(e.facultad, f.nombre) AS equipo_facultad
            FROM cola_solicitud c
            JOIN equipo e ON e.id = c.equipo_id
            LEFT JOIN ual u
              ON UPPER(u.nombre) = UPPER(e.laboratorio)
            LEFT JOIN facultad f
              ON f.facultad_id = u.facultad_id
            WHERE c.id = $1
              AND c.tipo = 'prestamo'
              AND c.estado = 'pendiente'
              AND c.usuario_id = $2
            LIMIT 1
          `,
          [req.params.colaId, usuario.id]
        );

        const cola = colaResult.rows[0];
        if (!cola) {
          await client.query('ROLLBACK');
          return res.status(404).json({
            success: false,
            message: 'La solicitud de ultima hora no existe o ya fue procesada.',
          });
        }

        let meta = null;
        if (cola.observaciones) {
          try {
            meta = JSON.parse(String(cola.observaciones));
          } catch {
            meta = null;
          }
        }

        const metaType = sanitizeText(meta?.tipo);
        const sourceSolicitudId = meta?.sourceSolicitudId || cola.referencia_id;
        if (metaType !== 'ultima_hora' || !isValidLoanRequestId(sourceSolicitudId)) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            success: false,
            message: 'Esta solicitud no corresponde a una asignacion de ultima hora.',
          });
        }

        const sourceResult = await client.query(
          `
            SELECT id, categoria_practica
            FROM solicitud_prestamo
            WHERE id = $1
            LIMIT 1
          `,
          [sourceSolicitudId]
        );
        const sourceSolicitud = sourceResult.rows[0] || {};
        const categoria = sourceSolicitud.categoria_practica || 'academica';

        const globalParameters = await fetchGlobalLoanPracticeParameters();
        const monthlyLoanLimit = Number(globalParameters.max_horas_mes_prestamos || 0);
        const requestedHours =
          (new Date(cola.fecha_fin).getTime() - new Date().getTime()) / (1000 * 60 * 60);
        if (Number.isFinite(monthlyLoanLimit) && monthlyLoanLimit > 0) {
          const usedHoursThisMonth = await calculateMonthlyLoanHours(usuario.id);
          if (usedHoursThisMonth + Math.max(0, requestedHours) > monthlyLoanLimit) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: `Superas la cuota mensual de ${monthlyLoanLimit} hora(s) para prestamos.`,
            });
          }
        }

        const fechaInicio = new Date();
        const fechaFin = new Date(cola.fecha_fin);
        if (!fechaFin || Number.isNaN(fechaFin.getTime()) || fechaFin <= fechaInicio) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: 'La franja de ultima hora ya no esta vigente.',
          });
        }

        const insertResult = await client.query(
          `
            INSERT INTO solicitud_prestamo (
              usuario_id,
              equipo_id,
              fecha_inicio,
              fecha_fin,
              justificacion_academica,
              categoria_practica,
              estado,
              tipo_aprobacion,
              firma_digital,
              fecha_firma
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id, fecha_inicio, fecha_fin
          `,
          [
            usuario.id,
            cola.equipo_id,
            fechaInicio,
            fechaFin,
            'Prestamo de ultima hora',
            categoria,
            'aprobado',
            'manual',
            firmaDigital,
            new Date(),
          ]
        );

        const sessionUsuario = await fetchSessionUsuario(req);
        await updateQueueEntryStatusById(client, cola.id, 'atendida', sessionUsuario?.id || null);

        await client.query('COMMIT');

        await registerPrestamosAuditEntry({
          req,
          accion: 'Prestamo de ultima hora',
          persona: `Solicitud base: ${sourceSolicitudId} - Cola: ${cola.id} - Nueva solicitud: ${insertResult.rows[0]?.id || '-'}`,
        });

        sendPrestamosNotification({
          sourceSystem: 'prestamos',
          templateName: 'prestamos/reserva_aprobada',
          recipient: usuario.correo,
          subject: 'Solicitud de prestamo aprobada (Ultima hora)',
          variables: {
            usuarioNombre: usuario.nombre || 'Usuario',
            solicitudId: insertResult.rows[0]?.id || '',
            equipoNombre: cola.equipo_nombre || 'Equipo',
            fechaInicio: formatPdfDateTime(insertResult.rows[0]?.fecha_inicio || fechaInicio),
            fechaFin: formatPdfDateTime(insertResult.rows[0]?.fecha_fin || fechaFin),
            appUrl: getMilabAppUrl(),
          },
          correlationId: `prestamo-ultima-hora-aceptada-${insertResult.rows[0]?.id || 'nuevo'}`,
        });

        return res.json({
          success: true,
          message:
            'Solicitud de ultima hora enviada correctamente. Acercate al laboratorio por el equipo.',
          solicitudId: insertResult.rows[0]?.id || null,
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error aceptando prestamo de ultima hora MiLab:', error);
      return res.status(500).json({
        success: false,
        message: resolveLoanDbErrorMessage(
          error,
          'No fue posible enviar la solicitud de ultima hora.'
        ),
      });
    }
  }
);

router.post(
  '/cola/prestamos/:id/asignar-ultima-hora',
  requireEntregaEquiposAuthorized,
  async function (req, res) {
    if (!isValidLoanRequestId(req.params.id) || !isValidLoanRequestId(req.body?.solicitud_id)) {
      return res.status(400).json({
        success: false,
        message: 'Los datos de la solicitud en cola no son validos.',
      });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const scope = await resolveLoanManagementScope(req);
      const solicitud = await fetchManagedDeliveryLoanRequest(req.body.solicitud_id, scope);

      if (!solicitud) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'La solicitud base no existe o no pertenece a tu alcance de gestion.',
        });
      }

      if (solicitud.estado !== 'aprobado') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: 'Solo las solicitudes aprobadas pueden reasignarse desde cola.',
        });
      }

      const eligibility = buildLastMinuteEligibilityResult(
        solicitud.fecha_inicio,
        solicitud.fecha_fin
      );
      if (!eligibility.allowed) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: eligibility.message,
        });
      }

      const queueResult = await client.query(
        `
          SELECT id, usuario_id, equipo_id, referencia_id
          FROM cola_solicitud
          WHERE id = $1
            AND tipo = 'prestamo'
            AND estado = 'pendiente'
          FOR UPDATE
        `,
        [req.params.id]
      );

      const cola = queueResult.rows[0] || null;
      if (!cola) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'La solicitud en cola no existe o ya fue gestionada.',
        });
      }

      if (!cola.referencia_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'La solicitud en cola no tiene una referencia valida.',
        });
      }

      if (Number(cola.equipo_id || 0) !== Number(solicitud.equipo_id || 0)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'La solicitud en cola no corresponde al mismo equipo.',
        });
      }

      const queuedLoanResult = await client.query(
        `
          SELECT id, usuario_id, equipo_id, fecha_fin
          FROM solicitud_prestamo
          WHERE id = $1
            AND estado = 'en_cola'
          FOR UPDATE
        `,
        [cola.referencia_id]
      );

      const solicitudEnCola = queuedLoanResult.rows[0] || null;
      if (!solicitudEnCola) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'La solicitud en cola ya no se encuentra disponible para reasignacion.',
        });
      }

      if (Number(solicitudEnCola.usuario_id) !== Number(cola.usuario_id)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'La solicitud en cola no coincide con el usuario registrado en la cola.',
        });
      }

      if (Number(solicitudEnCola.equipo_id) !== Number(solicitud.equipo_id)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'La solicitud en cola no corresponde al equipo seleccionado.',
        });
      }

      const globalParameters = await fetchGlobalLoanPracticeParameters();
      const monthlyLoanLimit = Number(globalParameters.max_horas_mes_prestamos || 0);
      const requestedHours =
        (eligibility.endDate.getTime() - eligibility.now.getTime()) / (1000 * 60 * 60);
      if (Number.isFinite(monthlyLoanLimit) && monthlyLoanLimit > 0) {
        const usedHoursThisMonth = await calculateMonthlyLoanHours(solicitudEnCola.usuario_id);
        if (usedHoursThisMonth + requestedHours > monthlyLoanLimit) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: `El usuario destino supera la cuota mensual de ${monthlyLoanLimit} hora(s) para prestamos.`,
          });
        }
      }

      await client.query(
        `
          UPDATE solicitud_prestamo
          SET estado = 'cancelado',
              motivo_rechazo = 'No asistió - asignado desde cola',
              fecha_modificacion = CURRENT_TIMESTAMP
          WHERE id = $1
            AND estado = 'aprobado'
        `,
        [solicitud.id]
      );

      await client.query(
        `
          UPDATE solicitud_prestamo
          SET estado = 'aprobado',
              tipo_aprobacion = 'manual',
              fecha_inicio = CURRENT_TIMESTAMP,
              fecha_fin = $2,
              fecha_modificacion = CURRENT_TIMESTAMP
          WHERE id = $1
            AND estado = 'en_cola'
        `,
        [solicitudEnCola.id, eligibility.endDate]
      );

      const sessionUsuario = await fetchSessionUsuario(req);
      await client.query(
        `
          UPDATE cola_solicitud
          SET estado = 'atendida',
              atendida_por_id = $2,
              fecha_modificacion = CURRENT_TIMESTAMP
          WHERE id = $1
        `,
        [cola.id, sessionUsuario?.id || null]
      );

      await client.query('COMMIT');

      await registerPrestamosAuditEntry({
        req,
        accion: 'Asignar cola prestamo (Ultima hora)',
        persona: `Cola: ${cola.id} - Solicitud: ${solicitudEnCola.id}`,
      });

      const recipientProfile = await fetchUserNotificationProfile(solicitudEnCola.usuario_id);
      sendPrestamosNotification({
        sourceSystem: 'prestamos',
        templateName: 'prestamos/reserva_aprobada',
        recipient: recipientProfile?.correo,
        subject: 'Solicitud de prestamo aprobada',
        variables: {
          usuarioNombre: recipientProfile?.nombre || 'Usuario',
          solicitudId: solicitudEnCola.id,
          equipoNombre: solicitud.equipo_nombre || 'Equipo',
          fechaInicio: formatPdfDateTime(new Date()),
          fechaFin: formatPdfDateTime(eligibility.endDate),
          appUrl: getMilabAppUrl(),
        },
        correlationId: `prestamo-cola-atendida-${solicitudEnCola.id}`,
      });

      return res.json({
        success: true,
        message: 'Solicitud en cola asignada por ultima hora.',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error asignando cola de ultima hora MiLab:', error);
      return res.status(500).json({
        success: false,
        message: resolveLoanDbErrorMessage(error, 'No fue posible asignar la solicitud en cola.'),
      });
    } finally {
      client.release();
    }
  }
);

router.post(
  '/entrega-equipos/:id/recibir',
  requireEntregaEquiposAuthorized,
  async function (req, res) {
    if (!isValidLoanRequestId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'La solicitud seleccionada no es valida.',
      });
    }

    const payload = buildLoanReturnPayload(req.body);
    if (!payload.condicion_devolucion) {
      return res.status(400).json({
        success: false,
        message: 'La condicion de la devolucion es obligatoria.',
      });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const scope = await resolveLoanManagementScope(req);
      const solicitud = await fetchManagedDeliveryLoanRequest(req.params.id, scope);

      if (!solicitud) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'La solicitud no existe o no pertenece a tu alcance de gestion.',
        });
      }

      if (solicitud.estado !== 'activo') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: 'Solo las solicitudes activas pueden registrarse como devueltas.',
        });
      }

      if (solicitud.incidencia_activa || solicitud.equipo_estado === 'mantenimiento') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: 'El equipo tiene una incidencia activa y no puede recibirse hasta resolverla.',
        });
      }

      const updateRequest = await client.query(
        `
          UPDATE solicitud_prestamo
          SET estado = 'finalizado',
              fecha_modificacion = CURRENT_TIMESTAMP
          WHERE id = $1
            AND estado = 'activo'
          RETURNING id
        `,
        [solicitud.id]
      );

      await client.query(
        `
          INSERT INTO entrega_equipo (
            solicitud_prestamo_id,
            fecha_entrega,
            fecha_devolucion_esperada,
            condicion_entrega,
            fecha_devolucion_real,
            condicion_devolucion,
            lista_componentes,
            fecha_modificacion
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            CURRENT_TIMESTAMP,
            $5,
            $6,
            CURRENT_TIMESTAMP
          )
          ON CONFLICT (solicitud_prestamo_id) DO UPDATE
          SET fecha_entrega = EXCLUDED.fecha_entrega,
              fecha_devolucion_esperada = EXCLUDED.fecha_devolucion_esperada,
              condicion_entrega = EXCLUDED.condicion_entrega,
              fecha_devolucion_real = CURRENT_TIMESTAMP,
              condicion_devolucion = EXCLUDED.condicion_devolucion,
              lista_componentes = EXCLUDED.lista_componentes,
              fecha_modificacion = CURRENT_TIMESTAMP
        `,
        [
          solicitud.id,
          solicitud.fecha_entrega || null,
          solicitud.fecha_fin || null,
          solicitud.condicion_entrega || 'Sin registro previo de entrega',
          payload.condicion_devolucion,
          JSON.stringify(payload.lista_componentes),
        ]
      );

      if (!updateRequest.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: 'La solicitud ya fue procesada por otro usuario.',
        });
      }

      await client.query(
        `
          UPDATE equipo
          SET estado = 'disponible',
              fecha_modificacion = CURRENT_TIMESTAMP
          WHERE id = $1
        `,
        [solicitud.equipo_id]
      );

      await client.query('COMMIT');

      await registerPrestamosAuditEntry({
        req,
        accion: 'Recibir equipo (Finalizar Prestamo)',
        persona: `Solicitud: ${solicitud.id}`,
      });

      return res.json({
        success: true,
        message: 'Equipo recibido y devolucion registrada',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error recibiendo equipo MiLab:', error);
      return res.status(500).json({
        success: false,
        message: resolveLoanDbErrorMessage(
          error,
          'No fue posible registrar la devolucion del equipo.'
        ),
      });
    } finally {
      client.release();
    }
  }
);

router.post(
  '/entrega-equipos/:id/incidencia',
  requireEntregaEquiposAuthorized,
  parseIncidentEvidenceUpload,
  async function (req, res) {
    if (!isValidLoanRequestId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'La solicitud seleccionada no es valida.',
      });
    }

    const payload = buildIncidentPayload(req.body);
    if (!payload.tipo_incidencia || !payload.descripcion) {
      return res.status(400).json({
        success: false,
        message: 'El tipo y la descripcion de la incidencia son obligatorios.',
      });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const scope = await resolveLoanManagementScope(req);
      const solicitud = await fetchManagedDeliveryLoanRequest(req.params.id, scope);

      if (!solicitud) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'La solicitud no existe o no pertenece a tu alcance de gestion.',
        });
      }

      if (solicitud.estado !== 'activo') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: 'Solo los prestamos activos pueden reportar incidencias.',
        });
      }

      const sessionUsuario = await fetchSessionUsuario(req);
      const incidentState = resolveIncidentReporterState(sessionUsuario);
      const insertColumns = [
        'equipo_id',
        'solicitud_prestamo_id',
        'entrega_equipo_id',
        'origen',
        'reportado_por_id',
        'documento_que_reporto',
        'nombre_que_reporto',
        'tipo_incidencia',
        'descripcion',
        'estado',
        'evidencia_foto',
        'evidencia_mime',
        'fecha_modificacion',
      ];
      const insertValues = [
        solicitud.equipo_id,
        solicitud.id,
        solicitud.entrega_id,
        'prestamo',
        sessionUsuario?.id || null,
        sessionUsuario?.documento || null,
        sessionUsuario?.nombre || null,
        payload.tipo_incidencia,
        payload.descripcion,
        incidentState,
        req.file?.buffer || null,
        req.file?.mimetype || null,
        new Date(),
      ];

      const incidentResult = await client.query(
        `
          INSERT INTO incidencia (
            ${insertColumns.join(', ')}
          )
          VALUES (${insertValues
            .map(function (_, index) {
              return `$${index + 1}`;
            })
            .join(', ')})
          RETURNING id
        `,
        insertValues
      );

      await client.query(
        `
          UPDATE equipo
          SET estado = 'mantenimiento',
              fecha_modificacion = CURRENT_TIMESTAMP
          WHERE id = $1
        `,
        [solicitud.equipo_id]
      );

      await client.query('COMMIT');

      await registerPrestamosAuditEntry({
        req,
        accion: 'Reportar incidencia',
        persona: `Equipo: ${solicitud.equipo_id}`,
      });

      const recipientProfile = await fetchUserNotificationProfile(solicitud.usuario_id);
      sendPrestamosNotification({
        sourceSystem: 'prestamos',
        templateName: 'prestamos/incidencia_creada',
        recipient: recipientProfile?.correo,
        subject: 'Incidencia registrada en tu prestamo',
        variables: {
          usuarioNombre: recipientProfile?.nombre || 'Usuario',
          solicitudId: solicitud.id,
          equipoNombre: solicitud.equipo_nombre || 'Equipo',
          tipoIncidencia: payload.tipo_incidencia,
          descripcion: payload.descripcion,
          appUrl: getMilabAppUrl(),
        },
        correlationId: `prestamo-incidencia-${incidentResult.rows[0]?.id || solicitud.id}`,
      });

      return res.json({
        success: true,
        message:
          incidentState === 'pendiente_confirmacion'
            ? 'Incidencia registrada en estado pendiente de aprobacion.'
            : 'Incidencia registrada y equipo puesto en mantenimiento.',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error registrando incidencia MiLab:', error);
      return res.status(500).json({
        success: false,
        message: resolveLoanDbErrorMessage(error, 'No fue posible registrar la incidencia.'),
      });
    } finally {
      client.release();
    }
  }
);

router.get('/incidencias', requireIncidenciasAuthorized, async function (req, res) {
  try {
    const scope = await resolveLoanManagementScope(req);
    let incidencias = [];

    if (scope.unrestricted || scope.facultyIds.length) {
      const params = [];
      const whereParts = ['1 = 1'];

      if (!scope.unrestricted) {
        params.push(scope.facultyIds);
        whereParts.push(`f.facultad_id = ANY($${params.length}::int[])`);
      }

      const laboratoryClause = buildLaboratoryNameScopeClause('e.laboratorio', scope, params);
      if (laboratoryClause) {
        whereParts.push(laboratoryClause.replace(/^\s*AND\s+/i, ''));
      }

      const result = await pool.query(
        `
          SELECT
            i.id,
            i.equipo_id,
            i.solicitud_prestamo_id,
            i.entrega_equipo_id,
            i.origen,
            i.tipo_incidencia,
            i.descripcion,
            i.estado,
            i.descripcion_cierre,
            i.sancion_tipo,
            i.sancion_detalle,
            CASE WHEN i.evidencia_foto IS NOT NULL THEN TRUE ELSE FALSE END AS tiene_evidencia,
            i.fecha_creacion,
            i.fecha_modificacion,
            e.codigo AS equipo_codigo,
            e.nombre AS equipo_nombre,
            e.laboratorio,
            COALESCE(e.facultad, f.nombre) AS facultad,
            u.nombre AS reportado_por_nombre,
            u.documento AS reportado_por_documento,
            sp.estado AS solicitud_estado
          FROM incidencia i
          JOIN equipo e
            ON e.id = i.equipo_id
          LEFT JOIN usuario u
            ON u.id = i.reportado_por_id
          LEFT JOIN solicitud_prestamo sp
            ON sp.id = i.solicitud_prestamo_id
          LEFT JOIN ual ul
            ON UPPER(ul.nombre) = UPPER(e.laboratorio)
          LEFT JOIN facultad f
            ON f.facultad_id = ul.facultad_id
          WHERE ${whereParts.join(' AND ')}
          ORDER BY
            CASE i.estado
              WHEN 'pendiente_confirmacion' THEN 1
              WHEN 'abierta' THEN 2
              WHEN 'pendiente_cierre' THEN 3
              ELSE 4
            END ASC,
            i.fecha_creacion DESC,
            i.id DESC
        `,
        params
      );

      incidencias = result.rows || [];
    }

    return res.render('home/prestamos/solicitudes/incidencias', {
      incidencias,
      successMessage: sanitizeText(req.query.success),
      errorMessage: sanitizeText(req.query.error),
      user: req.session?.user || null,
    });
  } catch (error) {
    console.error('Error cargando incidencias MiLab:', error);
    return res.render('home/prestamos/solicitudes/incidencias', {
      incidencias: [],
      successMessage: '',
      errorMessage: resolveLoanDbErrorMessage(error, 'No fue posible cargar las incidencias.'),
      user: req.session?.user || null,
    });
  }
});

router.get('/incidencias/:id/imagen', requireIncidenciasAuthorized, async function (req, res) {
  if (!isValidLoanRequestId(req.params.id)) {
    return res.status(400).send('La incidencia seleccionada no es valida.');
  }

  try {
    const scope = await resolveLoanManagementScope(req);
    const params = [req.params.id];
    const facultyCondition = scope?.unrestricted ? '' : 'AND f.facultad_id = ANY($2::int[])';
    if (!scope?.unrestricted) {
      if (!scope?.facultyIds?.length) {
        return res.status(404).send('La evidencia no existe o no esta disponible.');
      }
      params.push(scope.facultyIds);
    }

    const result = await pool.query(
      `
        SELECT i.evidencia_foto, i.evidencia_mime
        FROM incidencia i
        JOIN equipo e
          ON e.id = i.equipo_id
        LEFT JOIN ual ul
          ON UPPER(ul.nombre) = UPPER(e.laboratorio)
        LEFT JOIN facultad f
          ON f.facultad_id = ul.facultad_id
        WHERE i.id = $1
          ${facultyCondition}
        LIMIT 1
      `,
      params
    );

    const incident = result.rows[0];
    if (!incident?.evidencia_foto) {
      return res.status(404).send('La evidencia no existe o no esta disponible.');
    }

    res.setHeader('Content-Type', incident.evidencia_mime || 'image/jpeg');
    return res.send(incident.evidencia_foto);
  } catch (error) {
    console.error('Error obteniendo evidencia de incidencia MiLab:', error);
    return res.status(500).send('No fue posible obtener la evidencia fotografica.');
  }
});

router.post('/incidencias/:id/aprobar', requireIncidenciasAuthorized, async function (req, res) {
  if (!isValidLoanRequestId(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: 'La incidencia seleccionada no es valida.',
    });
  }

  const sessionUsuario = await fetchSessionUsuario(req);
  if (!canApproveIncident(sessionUsuario)) {
    return res.status(403).json({
      success: false,
      message: 'No tienes permisos para aprobar incidencias.',
    });
  }

  const payload = buildIncidentPayload(req.body);
  if (!payload.sancion_tipo) {
    return res.status(400).json({
      success: false,
      message: 'Debes seleccionar la medida o sancion aplicada.',
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const scope = await resolveLoanManagementScope(req);
    const incidencia = await fetchManagedIncident(req.params.id, scope);

    if (!incidencia) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'La incidencia no existe o no pertenece a tu alcance de gestion.',
      });
    }

    if (incidencia.estado !== 'pendiente_confirmacion') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Solo las incidencias pendientes de aprobacion pueden aprobarse.',
      });
    }

    await client.query(
      `
          UPDATE incidencia
          SET estado = 'abierta',
              sancion_tipo = $2,
              sancion_detalle = $3,
              fecha_modificacion = CURRENT_TIMESTAMP
          WHERE id = $1
        `,
      [incidencia.id, payload.sancion_tipo, payload.sancion_detalle || null]
    );

    await client.query(
      `
        UPDATE equipo
        SET estado = 'mantenimiento',
            fecha_modificacion = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [incidencia.equipo_id]
    );

    await client.query('COMMIT');

    await registerPrestamosAuditEntry({
      req,
      accion: 'Aprobar incidencia (Coordinador)',
      persona: `Incidencia: ${incidencia.id}`,
    });

    return res.json({
      success: true,
      message: 'Incidencia aprobada correctamente.',
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error aprobando incidencia MiLab:', error);
    return res.status(500).json({
      success: false,
      message: resolveLoanDbErrorMessage(error, 'No fue posible aprobar la incidencia.'),
    });
  } finally {
    client.release();
  }
});

router.post(
  '/incidencias/:id/pendiente-cierre',
  requireIncidenciasAuthorized,
  async function (req, res) {
    if (!isValidLoanRequestId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'La incidencia seleccionada no es valida.',
      });
    }

    const sessionUsuario = await fetchSessionUsuario(req);
    if (!canRequestIncidentClose(sessionUsuario)) {
      return res.status(403).json({
        success: false,
        message: 'No tienes permisos para solicitar el cierre de incidencias.',
      });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const scope = await resolveLoanManagementScope(req);
      const incidencia = await fetchManagedIncident(req.params.id, scope);

      if (!incidencia) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'La incidencia no existe o no pertenece a tu alcance de gestion.',
        });
      }

      if (incidencia.estado !== 'abierta') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Solo las incidencias abiertas pueden marcarse como pendientes por cerrar.',
        });
      }

      await client.query(
        `
          UPDATE incidencia
          SET estado = 'pendiente_cierre',
              fecha_modificacion = CURRENT_TIMESTAMP
          WHERE id = $1
        `,
        [incidencia.id]
      );

      await client.query('COMMIT');

      await registerPrestamosAuditEntry({
        req,
        accion: 'Solicitar Cierre Incidencia',
        persona: `Incidencia: ${incidencia.id}`,
      });

      return res.json({
        success: true,
        message: 'Incidencia marcada como pendiente por cerrar.',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error marcando incidencia pendiente por cerrar MiLab:', error);
      return res.status(500).json({
        success: false,
        message: resolveLoanDbErrorMessage(
          error,
          'No fue posible marcar la incidencia como pendiente por cerrar.'
        ),
      });
    } finally {
      client.release();
    }
  }
);

router.post('/incidencias/:id/solucionar', requireIncidenciasAuthorized, async function (req, res) {
  if (!isValidLoanRequestId(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: 'La incidencia seleccionada no es valida.',
    });
  }

  const sessionUsuario = await fetchSessionUsuario(req);
  if (!canFinalizeIncidentClose(sessionUsuario)) {
    return res.status(403).json({
      success: false,
      message: 'No tienes permisos para cerrar incidencias.',
    });
  }

  const payload = buildIncidentPayload(req.body);
  const closeDescription =
    payload.descripcion_cierre || 'Incidencia solucionada sin detalle adicional.';

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const scope = await resolveLoanManagementScope(req);
    const incidencia = await fetchManagedIncident(req.params.id, scope);

    if (!incidencia) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'La incidencia no existe o no pertenece a tu alcance de gestion.',
      });
    }

    if (incidencia.estado === 'cerrada') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'La incidencia ya fue cerrada.',
      });
    }

    if (incidencia.estado !== 'pendiente_cierre') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'La incidencia debe estar pendiente por cerrar antes del cierre final.',
      });
    }

    await client.query(
      `
        UPDATE incidencia
        SET estado = 'cerrada',
            descripcion_cierre = $2,
            fecha_modificacion = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [incidencia.id, closeDescription]
    );

    const openIncidentsResult = await client.query(
      `
        SELECT 1
        FROM incidencia
        WHERE equipo_id = $1
          AND id <> $2
          AND estado <> 'cerrada'
        LIMIT 1
      `,
      [incidencia.equipo_id, incidencia.id]
    );

    if (!openIncidentsResult.rows.length) {
      const restoredState = incidencia.solicitud_estado === 'activo' ? 'prestado' : 'disponible';
      await client.query(
        `
          UPDATE equipo
          SET estado = $2,
              fecha_modificacion = CURRENT_TIMESTAMP
          WHERE id = $1
        `,
        [incidencia.equipo_id, restoredState]
      );
    }

    await client.query('COMMIT');

    await registerPrestamosAuditEntry({
      req,
      accion: 'Solucionar Incidencia (Cerrar)',
      persona: `Incidencia: ${incidencia.id}`,
    });

    return res.json({
      success: true,
      message: 'Incidencia cerrada correctamente.',
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error cerrando incidencia MiLab:', error);
    return res.status(500).json({
      success: false,
      message: resolveLoanDbErrorMessage(error, 'No fue posible cerrar la incidencia.'),
    });
  } finally {
    client.release();
  }
});

router.post('/formatos/audiovisuales/fill', requirePracticasAuthorized, async function (req, res) {
  const payload = sanitizeJsonObject(req.body) || {};
  const archivo = sanitizeInstitutionalFormatFile(payload.archivo);

  if (!archivo) {
    return res.status(400).send('Debes seleccionar un formato valido.');
  }

  try {
    return await renderInstitutionalFormatPdf(
      res,
      archivo,
      payload,
      `Formato_Diligenciado_${path.basename(archivo, '.pdf')}.pdf`
    );
  } catch (error) {
    console.error('Error generando formato audiovisual diligenciado MiLab:', error);
    return res.status(500).send('No fue posible generar el formato diligenciado.');
  }
});

router.get('/practicas/solicitar', requirePracticasAuthorized, async function (req, res) {
  try {
    const roles = normalizeRoles(req.session?.user?.roles || req.session?.user?.tipo);
    const isDocente = roles.includes('docente');
    const editId = sanitizeText(req.query.editar);
    let initialReservation = null;

    if (isDocente && isValidLoanRequestId(editId)) {
      const usuario = await fetchSessionUsuario(req);
      if (usuario?.id) {
        const reservationResult = await pool.query(
          `
            SELECT
              id,
              facultad,
              laboratorio,
              tipo_practica,
              categoria_practica,
              sala_id,
              fecha_inicio,
              fecha_fin,
              justificacion,
              formato_archivo,
              formato_payload,
              motivo_rechazo
            FROM reserva_practica
            WHERE id = $1
              AND usuario_id = $2
              AND tipo_practica = 'docente'
              AND estado = 'con_comentarios'
            LIMIT 1
          `,
          [editId, usuario.id]
        );
        initialReservation = reservationResult.rows[0] || null;
      }
    }

    return res.render('home/prestamos/practicas/solicitar', {
      successMessage: sanitizeText(req.query.success),
      errorMessage: sanitizeText(req.query.error),
      isDocente,
      initialReservation,
    });
  } catch (error) {
    console.error('Error cargando formulario de practicas MiLab:', error);
    const roles = normalizeRoles(req.session?.user?.roles || req.session?.user?.tipo);
    const isDocente = roles.includes('docente');
    return res.render('home/prestamos/practicas/solicitar', {
      successMessage: '',
      errorMessage: 'No fue posible cargar el formulario de practicas.',
      isDocente,
      initialReservation: null,
    });
  }
});

router.get(
  '/practicas/api/salas-disponibles',
  requirePracticasAuthorized,
  async function (req, res) {
    try {
      const roles = normalizeRoles(req.session?.user?.roles || req.session?.user?.tipo);
      const isDocente = roles.includes('docente');
      const requestedDate = sanitizeText(req.query.fecha);
      if (requestedDate) {
        const payloadByDate = {
          facultad: sanitizeText(req.query.facultad),
          laboratorio: sanitizeText(req.query.laboratorio),
          fecha: requestedDate,
          tipo_practica: sanitizeText(req.query.tipo_practica),
        };

        if (!payloadByDate.facultad || !payloadByDate.laboratorio) {
          return res.status(400).json({
            success: false,
            salas: [],
            message: 'La facultad y el laboratorio son obligatorios.',
          });
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(payloadByDate.fecha || '')) {
          return res.status(400).json({
            success: false,
            salas: [],
            message: 'La fecha de la practica no tiene un formato valido.',
          });
        }

        if (!['libre', 'docente'].includes(payloadByDate.tipo_practica)) {
          return res.status(400).json({
            success: false,
            salas: [],
            message: 'El tipo de practica no es valido.',
          });
        }

        if (payloadByDate.tipo_practica === 'docente' && !isDocente) {
          return res.status(403).json({
            success: false,
            salas: [],
            message: 'Solo los docentes pueden consultar practicas docentes.',
          });
        }

        const salas = await fetchPracticeRoomAvailabilityByDate(payloadByDate, {
          unrestricted: true,
          facultyIds: [],
        });

        return res.json({
          success: true,
          salas,
        });
      }

      const payload = buildPracticeReservationPayload(req.query);
      const validationError = validatePracticeReservationPayload({
        ...payload,
        sala_id: payload.sala_id || '1',
      });

      if (validationError && !validationError.includes('Debes seleccionar una sala valida')) {
        return res.status(400).json({
          success: false,
          salas: [],
          message: validationError,
        });
      }

      if (payload.tipo_practica === 'docente' && !isDocente) {
        return res.status(403).json({
          success: false,
          salas: [],
          message: 'Solo los docentes pueden consultar practicas docentes.',
        });
      }

      const salas = await fetchPracticeRoomAvailability(payload, {
        unrestricted: true,
        facultyIds: [],
      });

      return res.json({
        success: true,
        salas,
      });
    } catch (error) {
      console.error('Error consultando salas disponibles para practicas MiLab:', error);
      return res.status(500).json({
        success: false,
        salas: [],
        message: resolveLoanDbErrorMessage(
          error,
          'No fue posible consultar las salas disponibles.'
        ),
      });
    }
  }
);

router.post('/practicas/reservar', requirePracticasAuthorized, async function (req, res) {
  const payload = buildPracticeReservationPayload(req.body);
  const validationError = validatePracticeReservationPayload(payload);

  if (validationError) {
    return res.status(400).json({
      success: false,
      message: validationError,
    });
  }

  try {
    const usuario = await fetchSessionUsuario(req);

    if (!usuario?.id) {
      return res.status(401).json({
        success: false,
        message: 'No fue posible identificar el usuario de la sesion.',
      });
    }

    const roles = normalizeRoles(
      usuario.roles || req.session?.user?.roles || req.session?.user?.tipo
    );
    if (payload.tipo_practica === 'docente' && !roles.includes('docente')) {
      return res.status(403).json({
        success: false,
        message: 'Solo los docentes pueden solicitar practicas docentes.',
      });
    }

    const fechaInicio = parseBogotaDateTime(payload.fecha_inicio);
    const fechaFin = parseBogotaDateTime(payload.fecha_fin);
    const durationHours = (fechaFin.getTime() - fechaInicio.getTime()) / (1000 * 60 * 60);
    const practiceConfig = await fetchPracticeConfigurationByFacultyName(payload.facultad);
    const globalParameters = await fetchGlobalLoanPracticeParameters();

    if (practiceConfig.dias_sancion_no_asistencia > 0) {
      const lastNoShow = await fetchLatestPracticeNoShow(usuario.id);
      if (lastNoShow) {
        const sanctionEnds = new Date(lastNoShow);
        sanctionEnds.setDate(sanctionEnds.getDate() + practiceConfig.dias_sancion_no_asistencia);

        if (new Date() < sanctionEnds) {
          return res.status(400).json({
            success: false,
            message: `Tienes restriccion por inasistencia hasta el ${formatPdfDateTime(sanctionEnds)}.`,
          });
        }
      }
    }

    if (practiceConfig.min_reserva_hours > 0) {
      const diffHours = (fechaInicio.getTime() - new Date().getTime()) / (1000 * 60 * 60);
      if (diffHours < practiceConfig.min_reserva_hours) {
        return res.status(400).json({
          success: false,
          message: `Solo se pueden reservar practicas con al menos ${practiceConfig.min_reserva_hours} hora(s) de anticipacion.`,
        });
      }
    }

    if (payload.tipo_practica === 'docente' && practiceConfig.min_docente_reserva_days > 0) {
      const nowDate = new Date();
      const startDay = new Date(fechaInicio);
      nowDate.setHours(0, 0, 0, 0);
      startDay.setHours(0, 0, 0, 0);
      const diffDays = Math.floor((startDay.getTime() - nowDate.getTime()) / (1000 * 60 * 60 * 24));

      if (diffDays < practiceConfig.min_docente_reserva_days) {
        return res.status(400).json({
          success: false,
          message: `Las practicas docentes deben solicitarse con al menos ${practiceConfig.min_docente_reserva_days} dia(s) de anticipacion.`,
        });
      }
    }

    if (practiceConfig.max_activas_estudiante > 0) {
      const activeReservations = await countUserActivePracticeReservations(
        usuario.id,
        payload.facultad
      );
      if (activeReservations >= practiceConfig.max_activas_estudiante) {
        return res.status(400).json({
          success: false,
          message: `Has alcanzado el maximo de ${practiceConfig.max_activas_estudiante} practica(s) activa(s) para tu facultad.`,
        });
      }
    }

    if (payload.tipo_practica === 'libre') {
      const monthlyFreePracticeLimit = Number(globalParameters.max_horas_mes_practica_libre || 0);
      if (Number.isFinite(monthlyFreePracticeLimit) && monthlyFreePracticeLimit > 0) {
        const usedHoursThisMonth = await calculateMonthlyFreePracticeHours(usuario.id);
        if (usedHoursThisMonth + durationHours > monthlyFreePracticeLimit) {
          return res.status(400).json({
            success: false,
            message: `Has alcanzado el limite mensual de ${monthlyFreePracticeLimit} hora(s) para practicas libres. Llevas ${usedHoursThisMonth.toFixed(2)} hora(s) y esta reserva agrega ${durationHours.toFixed(2)} hora(s).`,
          });
        }
      }
    }

    const overlapOwnResult = await pool.query(
      `
        SELECT 1
        FROM reserva_practica
        WHERE usuario_id = $1
          AND estado IN ('pendiente', 'por_aprobacion', 'con_comentarios', 'en_cola', 'aprobada', 'activa', 'iniciada')
          AND fecha_inicio < $3
          AND fecha_fin > $2
        LIMIT 1
      `,
      [usuario.id, fechaInicio, fechaFin]
    );

    if (overlapOwnResult.rows.length) {
      return res.status(409).json({
        success: false,
        message: 'Ya tienes otra practica registrada en ese horario.',
      });
    }

    const salasDisponibles = await fetchPracticeRoomAvailability(payload, {
      unrestricted: true,
      facultyIds: [],
    });
    const salaSeleccionada = salasDisponibles.find(
      (item) => Number(item.id) === Number(payload.sala_id)
    );

    if (payload.tipo_practica === 'docente' && !salaSeleccionada) {
      return res.status(409).json({
        success: false,
        message: 'La sala ya no tiene disponibilidad para la practica docente seleccionada.',
      });
    }

    const shouldQueueReservation = payload.tipo_practica === 'libre' && !salaSeleccionada;

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const insertColumns = [
        'usuario_id',
        'sala_id',
        'fecha_inicio',
        'fecha_fin',
        'laboratorio',
        'facultad',
        'tipo_practica',
        'categoria_practica',
        'modalidad_libre',
        'estado',
        'justificacion',
        'formato_archivo',
        'formato_payload',
        'firma_digital',
        'fecha_firma',
      ];
      const insertValues = [
        usuario.id,
        Number(payload.sala_id),
        fechaInicio,
        fechaFin,
        payload.laboratorio,
        payload.facultad,
        payload.tipo_practica,
        payload.categoria_practica,
        payload.tipo_practica === 'libre' ? salaSeleccionada?.modalidad_libre || 'uno_a_uno' : null,
        payload.tipo_practica === 'docente'
          ? 'por_aprobacion'
          : shouldQueueReservation
            ? 'en_cola'
            : 'pendiente',
        payload.justificacion,
        payload.formato_archivo,
        payload.formato_payload,
        payload.firma_digital,
        payload.firma_digital ? new Date() : null,
      ];

      const insertPlaceholders = insertValues.map(function (_, index) {
        return `$${index + 1}`;
      });
      const result = await client.query(
        `
          INSERT INTO reserva_practica (
            ${insertColumns.join(', ')}
          )
          VALUES (${insertPlaceholders.join(', ')})
          RETURNING id
        `,
        insertValues
      );

      if (shouldQueueReservation) {
        await client.query(
          `
            INSERT INTO cola_solicitud (
              tipo,
              estado,
              usuario_id,
              laboratorio,
              fecha_inicio,
              fecha_fin,
              observaciones,
              referencia_id
            )
            VALUES ('practica', 'pendiente', $1, $2, $3, $4, $5, $6)
          `,
          [
            usuario.id,
            payload.laboratorio,
            fechaInicio,
            fechaFin,
            payload.justificacion,
            result.rows[0]?.id || null,
          ]
        );
      }

      await client.query('COMMIT');

      sendPrestamosNotification({
        sourceSystem: 'prestamos',
        templateName: shouldQueueReservation
          ? 'prestamos/solicitud_en_cola'
          : 'prestamos/practica_solicitada',
        recipient: usuario.correo,
        subject: shouldQueueReservation
          ? 'Solicitud en cola de espera (Practica)'
          : 'Solicitud de practica registrada',
        variables: {
          usuarioNombre: usuario.nombre || 'Usuario',
          solicitudId: result.rows[0]?.id || '',
          lugar:
            buildPracticeNotificationLocation({
              laboratorio: payload.laboratorio,
              sala_nombre: salaSeleccionada?.nombre || null,
            }) || 'Practica',
          fechaInicio: formatPdfDateTime(fechaInicio),
          fechaFin: formatPdfDateTime(fechaFin),
          appUrl: getMilabAppUrl(),
          seguimientoPath: '/prestamos/practicas/mis-reservas',
        },
        correlationId: `practica-solicitud-${result.rows[0]?.id || 'nueva'}`,
      });

      return res.json({
        success: true,
        en_cola: shouldQueueReservation,
        message: shouldQueueReservation
          ? 'Horario sin cupo disponible. Tu solicitud quedo en cola de espera.'
          : 'Reserva de practica registrada correctamente.',
        reservationId: result.rows[0]?.id || null,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error creando practica MiLab:', error);
    const fallbackMessage = 'No fue posible registrar la practica.';
    const resolvedMessage = resolveLoanDbErrorMessage(error, fallbackMessage);
    const shouldExposeDebugDetails = process.env.NODE_ENV !== 'production';
    const rawDebugMessage = shouldExposeDebugDetails ? String(error?.message || '').trim() : '';
    const debugMessage = rawDebugMessage ? rawDebugMessage.slice(0, 240) : '';
    const debugDetails = shouldExposeDebugDetails
      ? [
          error?.code ? `code=${String(error.code)}` : null,
          error?.constraint ? `constraint=${String(error.constraint)}` : null,
          error?.column ? `column=${String(error.column)}` : null,
          error?.table ? `table=${String(error.table)}` : null,
          error?.name ? `name=${String(error.name)}` : null,
          debugMessage ? `detail=${JSON.stringify(debugMessage)}` : null,
        ]
          .filter(Boolean)
          .join(' ')
      : '';

    return res.status(500).json({
      success: false,
      message:
        shouldExposeDebugDetails && debugDetails
          ? `${resolvedMessage} (${debugDetails})`
          : resolvedMessage,
    });
  }
});

router.post('/practicas/:id/reenviar', requirePracticasAuthorized, async function (req, res) {
  if (!isValidLoanRequestId(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: 'La reserva seleccionada no es valida.',
    });
  }

  const payload = buildPracticeReservationPayload(req.body);

  try {
    const usuario = await fetchSessionUsuario(req);
    if (!usuario?.id) {
      return res.status(401).json({
        success: false,
        message: 'No fue posible identificar el usuario de la sesion.',
      });
    }

    const roles = normalizeRoles(
      usuario.roles || req.session?.user?.roles || req.session?.user?.tipo
    );
    if (!roles.includes('docente')) {
      return res.status(403).json({
        success: false,
        message: 'Solo los docentes pueden reenviar practicas docentes.',
      });
    }

    const reservationResult = await pool.query(
      `
        SELECT
          id,
          usuario_id,
          sala_id,
          fecha_inicio,
          fecha_fin,
          laboratorio,
          facultad,
          tipo_practica,
          categoria_practica,
          estado
        FROM reserva_practica
        WHERE id = $1
          AND usuario_id = $2
          AND tipo_practica = 'docente'
          AND estado = 'con_comentarios'
        LIMIT 1
      `,
      [req.params.id, usuario.id]
    );

    const reserva = reservationResult.rows[0] || null;
    if (!reserva) {
      return res.status(404).json({
        success: false,
        message: 'La reserva no existe o no esta disponible para reenviar.',
      });
    }

    const formatLocal = function (dateValue) {
      return new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'America/Bogota',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
        .format(new Date(dateValue))
        .replace(' ', 'T');
    };

    const merged = {
      facultad: reserva.facultad,
      laboratorio: reserva.laboratorio,
      sala_id: String(reserva.sala_id || ''),
      fecha_inicio: formatLocal(reserva.fecha_inicio),
      fecha_fin: formatLocal(reserva.fecha_fin),
      tipo_practica: 'docente',
      categoria_practica: payload.categoria_practica || reserva.categoria_practica,
      justificacion: payload.justificacion,
      firma_digital: payload.firma_digital,
      modalidad_libre: null,
      formato_archivo: payload.formato_archivo,
      formato_payload: payload.formato_payload,
    };

    const validationError = validatePracticeReservationPayload(merged);
    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError,
      });
    }

    const practiceConfig = await fetchPracticeConfigurationByFacultyName(reserva.facultad);
    if (practiceConfig.min_docente_reserva_days > 0) {
      const fechaInicio = parseBogotaDateTime(merged.fecha_inicio);
      const nowDate = new Date();
      const startDay = new Date(fechaInicio);
      nowDate.setHours(0, 0, 0, 0);
      startDay.setHours(0, 0, 0, 0);
      const diffDays = Math.floor((startDay.getTime() - nowDate.getTime()) / (1000 * 60 * 60 * 24));

      if (diffDays < practiceConfig.min_docente_reserva_days) {
        return res.status(400).json({
          success: false,
          message: `Las practicas docentes deben solicitarse con al menos ${practiceConfig.min_docente_reserva_days} dia(s) de anticipacion.`,
        });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const setParts = [
        "estado = 'por_aprobacion'",
        'motivo_rechazo = NULL',
        'categoria_practica = $2',
        'justificacion = $3',
        'fecha_modificacion = CURRENT_TIMESTAMP',
        'formato_archivo = $4',
        'formato_payload = $5::jsonb',
        'firma_digital = $6',
        'fecha_firma = $7',
      ];
      const params = [
        reserva.id,
        merged.categoria_practica,
        merged.justificacion,
        merged.formato_archivo || null,
        merged.formato_payload || null,
        merged.firma_digital || null,
        merged.firma_digital ? new Date() : null,
      ];

      const updateResult = await client.query(
        `
          UPDATE reserva_practica
          SET ${setParts.join(', ')}
          WHERE id = $1
            AND estado = 'con_comentarios'
          RETURNING id
        `,
        params
      );

      if (!updateResult.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: 'La reserva ya fue actualizada por otro usuario.',
        });
      }

      await client.query('COMMIT');

      await registerPrestamosAuditEntry({
        req,
        accion: 'Reenviar practica docente',
        persona: `Reserva: ${reserva.id}`,
      });

      return res.json({
        success: true,
        message: 'Practica reenviada para aprobacion.',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error reenviando practica docente MiLab:', error);
    return res.status(500).json({
      success: false,
      message: resolveLoanDbErrorMessage(error, 'No fue posible reenviar la practica.'),
    });
  }
});

router.get('/practicas/mis-reservas', requireMisPracticasAuthorized, async function (req, res) {
  try {
    const usuario = await fetchSessionUsuario(req);

    if (!usuario?.id) {
      return res.render('home/prestamos/practicas/mis-reservas', {
        reservas: [],
        successMessage: '',
        errorMessage: 'No fue posible identificar el usuario de la sesion.',
      });
    }

    const result = await pool.query(
      `
        SELECT
          rp.id,
          rp.fecha_inicio,
          rp.fecha_fin,
          rp.laboratorio,
          rp.facultad,
          rp.tipo_practica,
          rp.categoria_practica,
          rp.modalidad_libre,
          rp.estado,
          rp.justificacion,
          rp.motivo_rechazo,
          s.nombre AS sala_nombre
        FROM reserva_practica rp
        LEFT JOIN sala s ON s.id = rp.sala_id
        WHERE rp.usuario_id = $1
        ORDER BY rp.fecha_inicio DESC, rp.id DESC
      `,
      [usuario.id]
    );

    return res.render('home/prestamos/practicas/mis-reservas', {
      reservas: result.rows || [],
      successMessage: sanitizeText(req.query.success),
      errorMessage: sanitizeText(req.query.error),
    });
  } catch (error) {
    console.error('Error cargando mis practicas MiLab:', error);
    return res.render('home/prestamos/practicas/mis-reservas', {
      reservas: [],
      successMessage: '',
      errorMessage: resolveLoanDbErrorMessage(error, 'No fue posible cargar tus practicas.'),
    });
  }
});

router.get(
  '/practicas/:id/comprobante-pdf',
  requirePrestamosDocumentAccess,
  async function (req, res) {
    if (!isValidLoanRequestId(req.params.id)) {
      return res.status(400).send('La reserva seleccionada no es valida.');
    }

    try {
      const reservation = await fetchPracticeDocumentRecord(req, req.params.id);

      if (!reservation) {
        return res.status(404).send('La reserva no existe o no tienes permisos para verla.');
      }

      if (!['activa', 'iniciada', 'completada', 'finalizada'].includes(reservation.estado)) {
        return res
          .status(403)
          .send('El comprobante solo esta disponible para practicas activas o completadas.');
      }

      return sendPracticeComprobantePdf(res, reservation);
    } catch (error) {
      console.error('Error generando comprobante PDF de practica MiLab:', error);
      return res.status(500).send('No fue posible generar el comprobante PDF.');
    }
  }
);

router.get(
  '/practicas/:id/reglamento-pdf',
  requirePrestamosDocumentAccess,
  async function (req, res) {
    if (!isValidLoanRequestId(req.params.id)) {
      return res.status(400).send('La reserva seleccionada no es valida.');
    }

    try {
      const reservation = await fetchPracticeDocumentRecord(req, req.params.id);

      if (!reservation) {
        return res.status(404).send('La reserva no existe o no tienes permisos para verla.');
      }

      return sendPracticeReglamentoPdf(res, reservation);
    } catch (error) {
      console.error('Error generando reglamento PDF de practica MiLab:', error);
      return res.status(500).send('No fue posible generar el reglamento PDF.');
    }
  }
);

router.get(
  '/practicas/:id/formato-llenado-pdf',
  requirePrestamosDocumentAccess,
  async function (req, res) {
    if (!isValidLoanRequestId(req.params.id)) {
      return res.status(400).send('La reserva seleccionada no es valida.');
    }

    try {
      const reservation = await fetchPracticeDocumentRecord(req, req.params.id);

      if (!reservation) {
        return res.status(404).send('La reserva no existe o no tienes permisos para verla.');
      }

      if (!reservation.formato_archivo) {
        return res.status(404).send('La reserva no tiene formato diligenciado disponible.');
      }

      return await sendPracticeInstitutionalReglamentoPdf(res, reservation);
    } catch (error) {
      console.error('Error generando formato diligenciado PDF de practica MiLab:', error);
      return res.status(500).send('No fue posible generar el formato diligenciado PDF.');
    }
  }
);

router.post('/practicas/:id/cancelar', requireMisPracticasAuthorized, async function (req, res) {
  if (!isValidLoanRequestId(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: 'La reserva seleccionada no es valida.',
    });
  }

  try {
    const usuario = await fetchSessionUsuario(req);

    if (!usuario?.id) {
      return res.status(401).json({
        success: false,
        message: 'No fue posible identificar el usuario de la sesion.',
      });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const reservationResult = await client.query(
        `
          SELECT
            rp.id,
            rp.sala_id,
            rp.fecha_inicio,
            rp.fecha_fin,
            rp.facultad,
            rp.laboratorio,
            rp.tipo_practica,
            rp.categoria_practica,
            rp.estado,
            s.nombre AS sala_nombre
          FROM reserva_practica rp
          LEFT JOIN sala s ON s.id = rp.sala_id
          WHERE rp.id = $1
            AND rp.usuario_id = $2
            AND rp.estado IN ('pendiente', 'por_aprobacion', 'con_comentarios', 'aprobada', 'en_cola')
          LIMIT 1
        `,
        [req.params.id, usuario.id]
      );

      const reserva = reservationResult.rows[0];
      if (!reserva) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'La reserva no existe o ya no se puede cancelar.',
        });
      }

      const practiceConfig = await fetchPracticeConfigurationByFacultyName(reserva.facultad);
      if (practiceConfig.min_cancel_hours > 0) {
        const diffHours =
          (new Date(reserva.fecha_inicio).getTime() - new Date().getTime()) / (1000 * 60 * 60);
        if (diffHours < practiceConfig.min_cancel_hours) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: `Solo se pueden cancelar practicas con al menos ${practiceConfig.min_cancel_hours} hora(s) de anticipacion.`,
          });
        }
      }

      await client.query(
        `
          UPDATE reserva_practica
          SET estado = 'cancelada',
              fecha_modificacion = CURRENT_TIMESTAMP
          WHERE id = $1
            AND usuario_id = $2
            AND estado IN ('pendiente', 'por_aprobacion', 'con_comentarios', 'aprobada', 'en_cola')
        `,
        [reserva.id, usuario.id]
      );

      if (reserva.estado === 'en_cola') {
        await updatePracticeQueueEntryStatus(client, reserva.id, 'cancelada', usuario.id);
      }

      await client.query('COMMIT');

      await registerPrestamosAuditEntry({
        req,
        accion: 'Cancelar Reserva Practica',
        persona: `Reserva: ${reserva.id}`,
      });

      sendPrestamosNotification({
        sourceSystem: 'prestamos',
        templateName: 'prestamos/practica_cancelada',
        recipient: usuario.correo,
        subject: 'Reserva de practica cancelada',
        variables: {
          usuarioNombre: usuario.nombre || 'Usuario',
          solicitudId: reserva.id,
          lugar: buildPracticeNotificationLocation(reserva),
          fechaInicio: formatPdfDateTime(reserva.fecha_inicio),
          fechaFin: formatPdfDateTime(reserva.fecha_fin),
          appUrl: getMilabAppUrl(),
        },
        correlationId: `practica-cancelada-${reserva.id}`,
      });

      return res.json({
        success: true,
        message: 'Reserva cancelada correctamente.',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error cancelando practica MiLab:', error);
    return res.status(500).json({
      success: false,
      message: resolveLoanDbErrorMessage(error, 'No fue posible cancelar la practica.'),
    });
  }
});

router.get('/practicas/gestion', requireGestionPracticasAuthorized, async function (req, res) {
  try {
    const scope = await resolveLoanManagementScope(req);
    const requestedDate = sanitizeText(req.query.fecha);
    const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
      ? requestedDate
      : new Date().toISOString().slice(0, 10);
    let reservasDia = [];
    let reservasDiaEstudiante = [];
    let reservasDiaDocente = [];
    let practicasActivas = [];
    let cancelacionesDia = [];
    let colasPractica = [];

    if (scope.unrestricted || scope.facultyIds.length) {
      const dayParams = [selectedDate];
      const dayWhereParts = [
        'DATE(rp.fecha_inicio) = $1::date',
        "rp.estado IN ('pendiente', 'por_aprobacion', 'con_comentarios', 'aprobada')",
      ];

      if (!scope.unrestricted) {
        dayParams.push(scope.facultyIds);
        dayWhereParts.push(`f.facultad_id = ANY($${dayParams.length}::int[])`);
      }

      const dayLaboratoryClause = buildLaboratoryNameScopeClause(
        'rp.laboratorio',
        scope,
        dayParams
      );
      if (dayLaboratoryClause) {
        dayWhereParts.push(dayLaboratoryClause.replace(/^\s*AND\s+/i, ''));
      }

      const reservasDiaResult = await pool.query(
        `
          SELECT
            rp.id,
            rp.fecha_inicio,
            rp.fecha_fin,
            rp.laboratorio,
            rp.facultad,
            rp.sala_id,
            rp.tipo_practica,
            rp.categoria_practica,
            rp.modalidad_libre,
            rp.estado,
            rp.justificacion,
            rp.formato_archivo,
            s.nombre AS sala_nombre,
            u.nombre AS usuario_nombre,
            u.documento AS usuario_documento,
            u.correo AS usuario_correo
          FROM reserva_practica rp
          JOIN usuario u ON u.id = rp.usuario_id
          LEFT JOIN sala s ON s.id = rp.sala_id
          LEFT JOIN facultad f ON UPPER(f.nombre) = UPPER(rp.facultad)
          WHERE ${dayWhereParts.join(' AND ')}
          ORDER BY rp.fecha_inicio ASC, rp.id ASC
        `,
        dayParams
      );

      reservasDia = (reservasDiaResult.rows || []).map(function (item) {
        const eligibility = buildLastMinuteEligibilityResult(item.fecha_inicio, item.fecha_fin);
        return {
          ...item,
          habilitarUltimaHora:
            ['aprobada', 'activa', 'iniciada'].includes(String(item.estado || '')) &&
            eligibility.allowed,
        };
      });

      reservasDiaDocente = reservasDia.filter(function (item) {
        return String(item.tipo_practica || '') === 'docente';
      });

      reservasDiaEstudiante = reservasDia.filter(function (item) {
        return String(item.tipo_practica || '') !== 'docente';
      });

      const activeParams = [];
      const activeWhereParts = ["rp.estado IN ('activa', 'iniciada')"];

      if (!scope.unrestricted) {
        activeParams.push(scope.facultyIds);
        activeWhereParts.push(`f.facultad_id = ANY($${activeParams.length}::int[])`);
      }

      const activeLaboratoryClause = buildLaboratoryNameScopeClause(
        'rp.laboratorio',
        scope,
        activeParams
      );
      if (activeLaboratoryClause) {
        activeWhereParts.push(activeLaboratoryClause.replace(/^\s*AND\s+/i, ''));
      }

      const practicasActivasResult = await pool.query(
        `
          SELECT
            rp.id,
            rp.fecha_inicio,
            rp.fecha_fin,
            rp.laboratorio,
            rp.facultad,
            rp.sala_id,
            rp.tipo_practica,
            rp.categoria_practica,
            rp.modalidad_libre,
            rp.estado,
            rp.justificacion,
            rp.formato_archivo,
            s.nombre AS sala_nombre,
            u.nombre AS usuario_nombre,
            u.documento AS usuario_documento,
            u.correo AS usuario_correo
          FROM reserva_practica rp
          JOIN usuario u ON u.id = rp.usuario_id
          LEFT JOIN sala s ON s.id = rp.sala_id
          LEFT JOIN facultad f ON UPPER(f.nombre) = UPPER(rp.facultad)
          WHERE ${activeWhereParts.join(' AND ')}
          ORDER BY rp.fecha_inicio ASC, rp.id ASC
        `,
        activeParams
      );

      practicasActivas = (practicasActivasResult.rows || []).map(function (item) {
        const eligibility = buildLastMinuteEligibilityResult(item.fecha_inicio, item.fecha_fin);
        return {
          ...item,
          habilitarUltimaHora:
            ['aprobada', 'activa', 'iniciada'].includes(String(item.estado || '')) &&
            eligibility.allowed,
        };
      });

      const cancelParams = [selectedDate];
      const cancelWhereParts = ['DATE(rp.fecha_inicio) = $1::date', "rp.estado = 'cancelada'"];

      if (!scope.unrestricted) {
        cancelParams.push(scope.facultyIds);
        cancelWhereParts.push(`f.facultad_id = ANY($${cancelParams.length}::int[])`);
      }

      const cancelLaboratoryClause = buildLaboratoryNameScopeClause(
        'rp.laboratorio',
        scope,
        cancelParams
      );
      if (cancelLaboratoryClause) {
        cancelWhereParts.push(cancelLaboratoryClause.replace(/^\s*AND\s+/i, ''));
      }

      const cancelacionesResult = await pool.query(
        `
          SELECT
            rp.id,
            rp.fecha_inicio,
            rp.fecha_fin,
            rp.laboratorio,
            rp.facultad,
            rp.tipo_practica,
            rp.categoria_practica,
            rp.modalidad_libre,
            rp.estado,
            s.nombre AS sala_nombre,
            u.nombre AS usuario_nombre,
            u.documento AS usuario_documento
          FROM reserva_practica rp
          JOIN usuario u ON u.id = rp.usuario_id
          LEFT JOIN sala s ON s.id = rp.sala_id
          LEFT JOIN facultad f ON UPPER(f.nombre) = UPPER(rp.facultad)
          WHERE ${cancelWhereParts.join(' AND ')}
          ORDER BY rp.fecha_inicio ASC, rp.id ASC
        `,
        cancelParams
      );

      cancelacionesDia = cancelacionesResult.rows || [];

      const queueParams = [];
      const queueWhereParts = ["c.tipo = 'practica'", "c.estado = 'pendiente'"];

      if (!scope.unrestricted) {
        queueParams.push(scope.facultyIds);
        queueWhereParts.push(`f.facultad_id = ANY($${queueParams.length}::int[])`);
      }

      const queueLaboratoryClause = buildLaboratoryNameScopeClause(
        'COALESCE(rp.laboratorio, c.laboratorio)',
        scope,
        queueParams
      );
      if (queueLaboratoryClause) {
        queueWhereParts.push(queueLaboratoryClause.replace(/^\s*AND\s+/i, ''));
      }

      const queueResult = await pool.query(
        `
          SELECT
            c.id,
            c.referencia_id,
            c.usuario_id,
            c.laboratorio,
            c.fecha_inicio,
            c.fecha_fin,
            c.fecha_creacion,
            c.observaciones,
            rp.tipo_practica,
            rp.categoria_practica,
            u.nombre AS usuario_nombre,
            u.documento AS usuario_documento,
            u.correo AS usuario_correo
          FROM cola_solicitud c
          JOIN usuario u
            ON u.id = c.usuario_id
          LEFT JOIN reserva_practica rp
            ON rp.id = c.referencia_id
          LEFT JOIN facultad f
            ON UPPER(f.nombre) = UPPER(COALESCE(rp.facultad, ''))
          WHERE ${queueWhereParts.join(' AND ')}
          ORDER BY c.fecha_inicio ASC, c.id ASC
        `,
        queueParams
      );

      colasPractica = queueResult.rows || [];
    }

    return res.render('home/prestamos/practicas/gestion', {
      fecha: selectedDate,
      reservasDia,
      reservasDiaEstudiante,
      reservasDiaDocente,
      practicasActivas,
      cancelacionesDia,
      colasPractica,
      successMessage: sanitizeText(req.query.success),
      errorMessage: sanitizeText(req.query.error),
    });
  } catch (error) {
    console.error('Error cargando gestion de practicas MiLab:', error);
    return res.render('home/prestamos/practicas/gestion', {
      fecha: new Date().toISOString().slice(0, 10),
      reservasDia: [],
      reservasDiaEstudiante: [],
      reservasDiaDocente: [],
      practicasActivas: [],
      cancelacionesDia: [],
      colasPractica: [],
      successMessage: '',
      errorMessage: resolveLoanDbErrorMessage(
        error,
        'No fue posible cargar la gestion de practicas.'
      ),
    });
  }
});

router.post('/practicas/:id/aprobar', requireGestionPracticasAuthorized, async function (req, res) {
  if (!isValidLoanRequestId(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: 'La reserva seleccionada no es valida.',
    });
  }

  try {
    const scope = await resolveLoanManagementScope(req);
    const reserva = await fetchManagedPracticeReservation(req.params.id, scope);

    if (!reserva) {
      return res.status(404).json({
        success: false,
        message: 'La reserva no existe o no pertenece a tu alcance de gestion.',
      });
    }

    if (!['pendiente', 'en_cola', 'por_aprobacion'].includes(reserva.estado)) {
      return res.status(409).json({
        success: false,
        message: 'Solo las reservas pendientes o en cola pueden aprobarse.',
      });
    }

    if (!reserva.sala_id) {
      return res.status(409).json({
        success: false,
        message: 'La reserva en cola no tiene sala asignada. Reasigna una sala antes de aprobar.',
      });
    }

    const overlapSalaResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM reserva_practica
        WHERE id <> $1
          AND sala_id = $2
          AND estado IN ('aprobada', 'activa', 'iniciada')
          AND fecha_inicio < $4
          AND fecha_fin > $3
      `,
      [reserva.id, reserva.sala_id, reserva.fecha_inicio, reserva.fecha_fin]
    );

    if (Number(overlapSalaResult.rows[0]?.total || 0) >= Number(reserva.sala_capacidad || 1)) {
      return res.status(409).json({
        success: false,
        message: 'La sala ya no tiene capacidad disponible para aprobar esta practica.',
      });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const result = await client.query(
        `
          UPDATE reserva_practica
          SET estado = 'aprobada',
              motivo_rechazo = NULL,
              fecha_modificacion = CURRENT_TIMESTAMP
          WHERE id = $1
            AND estado IN ('pendiente', 'en_cola', 'por_aprobacion')
          RETURNING id
        `,
        [reserva.id]
      );

      if (!result.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: 'La reserva ya fue procesada por otro usuario.',
        });
      }

      if (reserva.estado === 'en_cola') {
        const sessionUsuario = await fetchSessionUsuario(req);
        await updatePracticeQueueEntryStatus(client, reserva.id, 'atendida', sessionUsuario?.id);
      }

      await client.query('COMMIT');

      await registerPrestamosAuditEntry({
        req,
        accion: 'Aprobar Reserva Practica',
        persona: `Reserva: ${reserva.id}`,
      });

      sendPrestamosNotification({
        sourceSystem: 'prestamos',
        templateName: 'prestamos/practica_aprobada',
        recipient: reserva.usuario_correo,
        subject: 'Reserva de practica aprobada',
        variables: {
          usuarioNombre: reserva.usuario_nombre || 'Usuario',
          solicitudId: reserva.id,
          lugar: buildPracticeNotificationLocation(reserva),
          fechaInicio: formatPdfDateTime(reserva.fecha_inicio),
          fechaFin: formatPdfDateTime(reserva.fecha_fin),
          appUrl: getMilabAppUrl(),
        },
        correlationId: `practica-aprobada-${reserva.id}`,
      });

      return res.json({
        success: true,
        message: 'Reserva aprobada correctamente.',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error aprobando practica MiLab:', error);
    return res.status(500).json({
      success: false,
      message: resolveLoanDbErrorMessage(error, 'No fue posible aprobar la practica.'),
    });
  }
});

router.post(
  '/practicas/:id/comentarios',
  requireGestionPracticasAuthorized,
  async function (req, res) {
    if (!isValidLoanRequestId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'La reserva seleccionada no es valida.',
      });
    }

    const comentario = sanitizeText(
      req.body.comentario || req.body.motivo || req.body.motivo_rechazo
    );
    if (!comentario) {
      return res.status(400).json({
        success: false,
        message: 'Debes ingresar un comentario.',
      });
    }

    try {
      const scope = await resolveLoanManagementScope(req);
      const reserva = await fetchManagedPracticeReservation(req.params.id, scope);

      if (!reserva) {
        return res.status(404).json({
          success: false,
          message: 'La reserva no existe o no pertenece a tu alcance de gestion.',
        });
      }

      if (reserva.tipo_practica !== 'docente') {
        return res.status(409).json({
          success: false,
          message: 'Los comentarios solo aplican para practicas docentes.',
        });
      }

      if (reserva.estado !== 'por_aprobacion') {
        return res.status(409).json({
          success: false,
          message: 'Solo las practicas docentes en por aprobacion pueden enviarse con comentarios.',
        });
      }

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const result = await client.query(
          `
            UPDATE reserva_practica
            SET estado = 'con_comentarios',
                motivo_rechazo = $2,
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $1
              AND estado = 'por_aprobacion'
            RETURNING id
          `,
          [reserva.id, comentario]
        );

        if (!result.rows.length) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            success: false,
            message: 'La reserva ya fue procesada por otro usuario.',
          });
        }

        await client.query('COMMIT');

        await registerPrestamosAuditEntry({
          req,
          accion: 'Practica docente con comentarios',
          persona: `Reserva: ${reserva.id}`,
        });

        sendPrestamosNotification({
          sourceSystem: 'prestamos',
          templateName: 'prestamos/practica_rechazada',
          recipient: reserva.usuario_correo,
          subject: 'Practica docente con comentarios',
          variables: {
            usuarioNombre: reserva.usuario_nombre || 'Usuario',
            solicitudId: reserva.id,
            lugar: buildPracticeNotificationLocation(reserva),
            fechaInicio: formatPdfDateTime(reserva.fecha_inicio),
            fechaFin: formatPdfDateTime(reserva.fecha_fin),
            motivoRechazo: comentario,
            appUrl: getMilabAppUrl(),
          },
          correlationId: `practica-comentarios-${reserva.id}`,
        });

        return res.json({
          success: true,
          message: 'Comentarios enviados correctamente.',
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error enviando comentarios de practica docente MiLab:', error);
      return res.status(500).json({
        success: false,
        message: resolveLoanDbErrorMessage(error, 'No fue posible enviar los comentarios.'),
      });
    }
  }
);

router.post(
  '/practicas/:id/rechazar',
  requireGestionPracticasAuthorized,
  async function (req, res) {
    if (!isValidLoanRequestId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'La reserva seleccionada no es valida.',
      });
    }

    try {
      const scope = await resolveLoanManagementScope(req);
      const reserva = await fetchManagedPracticeReservation(req.params.id, scope);

      if (!reserva) {
        return res.status(404).json({
          success: false,
          message: 'La reserva no existe o no pertenece a tu alcance de gestion.',
        });
      }

      if (!['pendiente', 'en_cola', 'por_aprobacion', 'con_comentarios'].includes(reserva.estado)) {
        return res.status(409).json({
          success: false,
          message: 'Solo las reservas pendientes o en cola pueden rechazarse.',
        });
      }

      const rejectionReason = sanitizeText(req.body.motivo_rechazo || req.body.motivoRechazo);

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const result = await client.query(
          `
          UPDATE reserva_practica
          SET estado = 'rechazada',
              motivo_rechazo = $2,
              fecha_modificacion = CURRENT_TIMESTAMP
          WHERE id = $1
            AND estado IN ('pendiente', 'en_cola', 'por_aprobacion', 'con_comentarios')
          RETURNING id
        `,
          [reserva.id, rejectionReason || 'Sin motivo especificado']
        );

        if (!result.rows.length) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            success: false,
            message: 'La reserva ya fue procesada por otro usuario.',
          });
        }

        if (reserva.estado === 'en_cola') {
          const sessionUsuario = await fetchSessionUsuario(req);
          await updatePracticeQueueEntryStatus(client, reserva.id, 'cancelada', sessionUsuario?.id);
        }

        await client.query('COMMIT');

        await registerPrestamosAuditEntry({
          req,
          accion: 'Rechazar Reserva Practica',
          persona: `Reserva: ${reserva.id}`,
        });

        sendPrestamosNotification({
          sourceSystem: 'prestamos',
          templateName: 'prestamos/practica_rechazada',
          recipient: reserva.usuario_correo,
          subject: 'Reserva de practica rechazada',
          variables: {
            usuarioNombre: reserva.usuario_nombre || 'Usuario',
            solicitudId: reserva.id,
            lugar: buildPracticeNotificationLocation(reserva),
            fechaInicio: formatPdfDateTime(reserva.fecha_inicio),
            fechaFin: formatPdfDateTime(reserva.fecha_fin),
            motivoRechazo: rejectionReason || 'Sin motivo especificado',
            appUrl: getMilabAppUrl(),
          },
          correlationId: `practica-rechazada-${reserva.id}`,
        });

        return res.json({
          success: true,
          message: 'Reserva rechazada correctamente.',
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error rechazando practica MiLab:', error);
      return res.status(500).json({
        success: false,
        message: resolveLoanDbErrorMessage(error, 'No fue posible rechazar la practica.'),
      });
    }
  }
);

router.post('/practicas/:id/iniciar', requireGestionPracticasAuthorized, async function (req, res) {
  if (!isValidLoanRequestId(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: 'La reserva seleccionada no es valida.',
    });
  }

  try {
    const scope = await resolveLoanManagementScope(req);
    const reserva = await fetchManagedPracticeReservation(req.params.id, scope);

    if (!reserva) {
      return res.status(404).json({
        success: false,
        message: 'La reserva no existe o no pertenece a tu alcance de gestion.',
      });
    }

    if (reserva.estado !== 'aprobada') {
      return res.status(409).json({
        success: false,
        message: 'Solo las reservas aprobadas pueden iniciarse.',
      });
    }

    const nextState = reserva.tipo_practica === 'docente' ? 'iniciada' : 'activa';
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const result = await client.query(
        `
          UPDATE reserva_practica
          SET estado = $2,
              fecha_modificacion = CURRENT_TIMESTAMP
          WHERE id = $1
            AND estado = 'aprobada'
          RETURNING id
        `,
        [reserva.id, nextState]
      );

      if (!result.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: 'La reserva ya fue procesada por otro usuario.',
        });
      }

      await client.query('COMMIT');

      await registerPrestamosAuditEntry({
        req,
        accion: 'Iniciar Practica',
        persona: `Reserva: ${reserva.id}`,
      });

      sendPrestamosNotification({
        sourceSystem: 'prestamos',
        templateName: 'prestamos/practica_estado',
        recipient: reserva.usuario_correo,
        subject: 'Practica iniciada',
        variables: {
          titulo: 'Tu practica fue iniciada',
          estadoEtiqueta: reserva.tipo_practica === 'docente' ? 'INICIADA' : 'ACTIVA',
          usuarioNombre: reserva.usuario_nombre || 'Usuario',
          solicitudId: reserva.id,
          lugar: buildPracticeNotificationLocation(reserva),
          fechaInicio: formatPdfDateTime(reserva.fecha_inicio),
          fechaFin: formatPdfDateTime(reserva.fecha_fin),
          appUrl: getMilabAppUrl(),
        },
        correlationId: `practica-iniciada-${reserva.id}`,
      });

      return res.json({
        success: true,
        message: 'Practica iniciada correctamente.',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error iniciando practica MiLab:', error);
    return res.status(500).json({
      success: false,
      message: resolveLoanDbErrorMessage(error, 'No fue posible iniciar la practica.'),
    });
  }
});

router.post(
  '/practicas/:id/reasignar-sala',
  requireGestionPracticasAuthorized,
  async function (req, res) {
    if (!isValidLoanRequestId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'La reserva seleccionada no es valida.',
      });
    }

    const payload = buildPracticeManagementPayload(req.body);

    if (!isValidSalaId(payload.sala_id)) {
      return res.status(400).json({
        success: false,
        message: 'Debes seleccionar una sala valida.',
      });
    }

    try {
      const scope = await resolveLoanManagementScope(req);
      const reserva = await fetchManagedPracticeReservation(req.params.id, scope);

      if (!reserva) {
        return res.status(404).json({
          success: false,
          message: 'La reserva no existe o no pertenece a tu alcance de gestion.',
        });
      }

      if (!['pendiente', 'en_cola', 'aprobada'].includes(reserva.estado)) {
        return res.status(409).json({
          success: false,
          message: 'Solo las reservas pendientes, en cola o aprobadas pueden reasignarse.',
        });
      }

      const salasDisponibles = await fetchPracticeRoomAvailability(
        {
          facultad: reserva.facultad,
          laboratorio: reserva.laboratorio,
          fecha_inicio: new Date(reserva.fecha_inicio).toISOString().slice(0, 16),
          fecha_fin: new Date(reserva.fecha_fin).toISOString().slice(0, 16),
          tipo_practica: reserva.tipo_practica,
          categoria_practica: reserva.categoria_practica,
        },
        { unrestricted: true, facultyIds: [] }
      );
      const salaSeleccionada = salasDisponibles.find(
        (item) => Number(item.id) === Number(payload.sala_id)
      );

      if (!salaSeleccionada) {
        return res.status(409).json({
          success: false,
          message: 'La nueva sala no esta disponible para ese horario.',
        });
      }

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const result = await client.query(
          `
            UPDATE reserva_practica
            SET sala_id = $2,
                modalidad_libre = CASE
                  WHEN tipo_practica = 'libre' THEN $3
                  ELSE NULL
                END,
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING id
          `,
          [reserva.id, Number(payload.sala_id), salaSeleccionada.modalidad_libre || null]
        );

        if (!result.rows.length) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            success: false,
            message: 'La reserva ya fue actualizada por otro usuario.',
          });
        }

        await client.query('COMMIT');

        return res.json({
          success: true,
          message: 'Sala reasignada correctamente.',
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error reasignando sala de practica MiLab:', error);
      return res.status(500).json({
        success: false,
        message: resolveLoanDbErrorMessage(error, 'No fue posible reasignar la sala.'),
      });
    }
  }
);

router.post(
  '/practicas/:id/no-asistio',
  requireGestionPracticasAuthorized,
  async function (req, res) {
    if (!isValidLoanRequestId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'La reserva seleccionada no es valida.',
      });
    }

    try {
      const scope = await resolveLoanManagementScope(req);
      const reserva = await fetchManagedPracticeReservation(req.params.id, scope);

      if (!reserva) {
        return res.status(404).json({
          success: false,
          message: 'La reserva no existe o no pertenece a tu alcance de gestion.',
        });
      }

      if (!['aprobada', 'activa', 'iniciada'].includes(reserva.estado)) {
        return res.status(409).json({
          success: false,
          message: 'Solo las practicas aprobadas o activas pueden marcarse como no asistio.',
        });
      }

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const result = await client.query(
          `
            UPDATE reserva_practica
            SET estado = 'no_asistio',
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $1
              AND estado IN ('aprobada', 'activa', 'iniciada')
            RETURNING id
          `,
          [reserva.id]
        );

        if (!result.rows.length) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            success: false,
            message: 'La reserva ya fue procesada por otro usuario.',
          });
        }

        await client.query('COMMIT');

        await registerPrestamosAuditEntry({
          req,
          accion: 'Marcar No Asistio',
          persona: `Reserva: ${reserva.id}`,
        });

        return res.json({
          success: true,
          message: 'La practica fue marcada como no asistio.',
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error marcando practica como no asistio MiLab:', error);
      return res.status(500).json({
        success: false,
        message: resolveLoanDbErrorMessage(
          error,
          'No fue posible marcar la practica como no asistio.'
        ),
      });
    }
  }
);

router.post(
  '/practicas/:id/ultima-hora',
  requireGestionPracticasAuthorized,
  async function (req, res) {
    if (!isValidLoanRequestId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'La reserva seleccionada no es valida.',
      });
    }

    const documento = sanitizeText(
      req.body.documento || req.body.usuario_documento || req.body.codigo
    );

    if (!documento) {
      return res.status(400).json({
        success: false,
        message: 'Debes indicar el documento o codigo del usuario destino.',
      });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const scope = await resolveLoanManagementScope(req);
      const reserva = await fetchManagedPracticeReservation(req.params.id, scope);

      if (!reserva) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'La reserva no existe o no pertenece a tu alcance de gestion.',
        });
      }

      if (!['aprobada', 'activa', 'iniciada'].includes(reserva.estado)) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: 'Solo las reservas aprobadas o activas pueden reasignarse por ultima hora.',
        });
      }

      const eligibility = buildLastMinuteEligibilityResult(reserva.fecha_inicio, reserva.fecha_fin);
      if (!eligibility.allowed) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: eligibility.message,
        });
      }

      const usuarioDestino = await fetchUserByDocumentOrCode(documento);
      if (!usuarioDestino?.id) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'El usuario destino no existe en el sistema.',
        });
      }

      if (reserva.tipo_practica === 'libre') {
        const globalParameters = await fetchGlobalLoanPracticeParameters();
        const monthlyFreePracticeLimit = Number(globalParameters.max_horas_mes_practica_libre || 0);
        const requestedHours =
          (new Date(reserva.fecha_fin).getTime() - new Date(reserva.fecha_inicio).getTime()) /
          (1000 * 60 * 60);

        if (Number.isFinite(monthlyFreePracticeLimit) && monthlyFreePracticeLimit > 0) {
          const usedHoursThisMonth = await calculateMonthlyFreePracticeHours(usuarioDestino.id);
          if (usedHoursThisMonth + requestedHours > monthlyFreePracticeLimit) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: `El usuario destino supera la cuota mensual de ${monthlyFreePracticeLimit} hora(s) para practicas libres.`,
            });
          }
        }
      }

      const overlapResult = await client.query(
        `
          SELECT 1
          FROM reserva_practica
          WHERE usuario_id = $1
            AND estado IN ('pendiente', 'por_aprobacion', 'con_comentarios', 'en_cola', 'aprobada', 'activa', 'iniciada')
            AND fecha_inicio < $3
            AND fecha_fin > $2
          LIMIT 1
        `,
        [usuarioDestino.id, eligibility.now, eligibility.endDate]
      );

      if (overlapResult.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: 'El usuario destino ya tiene otra practica en ese horario.',
        });
      }

      await client.query(
        `
          UPDATE reserva_practica
          SET estado = 'no_asistio',
              fecha_modificacion = CURRENT_TIMESTAMP
          WHERE id = $1
            AND estado IN ('aprobada', 'activa', 'iniciada')
        `,
        [reserva.id]
      );

      const insertResult = await client.query(
        `
          INSERT INTO reserva_practica (
            usuario_id,
            sala_id,
            fecha_inicio,
            fecha_fin,
            laboratorio,
            facultad,
            tipo_practica,
            categoria_practica,
            modalidad_libre,
            estado,
            justificacion,
            formato_archivo,
            formato_payload,
            firma_digital,
            fecha_firma
          )
          VALUES (
            $1,
            $2,
            CURRENT_TIMESTAMP,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $12,
            $9,
            $10,
            $11,
            NULL,
            NULL
          )
          RETURNING id, fecha_inicio, fecha_fin
        `,
        [
          usuarioDestino.id,
          reserva.sala_id,
          eligibility.endDate,
          reserva.laboratorio,
          reserva.facultad,
          reserva.tipo_practica,
          reserva.categoria_practica,
          reserva.modalidad_libre,
          'Practica de ultima hora',
          reserva.formato_archivo || null,
          reserva.formato_payload || null,
          reserva.tipo_practica === 'docente' ? 'iniciada' : 'activa',
        ]
      );

      await client.query('COMMIT');

      await registerPrestamosAuditEntry({
        req,
        accion: 'Practica de ultima hora',
        persona: `Reserva base: ${reserva.id} - Nueva reserva: ${insertResult.rows[0]?.id || '-'}`,
      });

      sendPrestamosNotification({
        sourceSystem: 'prestamos',
        templateName: 'prestamos/practica_aprobada',
        recipient: usuarioDestino.correo,
        subject: 'Reserva de practica aprobada',
        variables: {
          usuarioNombre: usuarioDestino.nombre || 'Usuario',
          solicitudId: insertResult.rows[0]?.id || '',
          lugar: buildPracticeNotificationLocation(reserva),
          fechaInicio: formatPdfDateTime(insertResult.rows[0]?.fecha_inicio || eligibility.now),
          fechaFin: formatPdfDateTime(insertResult.rows[0]?.fecha_fin || eligibility.endDate),
          appUrl: getMilabAppUrl(),
        },
        correlationId: `practica-ultima-hora-${insertResult.rows[0]?.id || 'nueva'}`,
      });

      return res.json({
        success: true,
        message: 'Prestamo de ultima hora aplicado correctamente.',
        reservationId: insertResult.rows[0]?.id || null,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error prestamo de ultima hora practica MiLab:', error);
      return res.status(500).json({
        success: false,
        message: resolveLoanDbErrorMessage(
          error,
          'No fue posible procesar el prestamo de ultima hora de la practica.'
        ),
      });
    } finally {
      client.release();
    }
  }
);

router.post(
  '/cola/practicas/:id/asignar-ultima-hora',
  requireGestionPracticasAuthorized,
  async function (req, res) {
    if (!isValidLoanRequestId(req.params.id) || !isValidLoanRequestId(req.body?.reserva_id)) {
      return res.status(400).json({
        success: false,
        message: 'Los datos de la solicitud en cola no son validos.',
      });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const scope = await resolveLoanManagementScope(req);
      const reserva = await fetchManagedPracticeReservation(req.body.reserva_id, scope);

      if (!reserva) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'La reserva base no existe o no pertenece a tu alcance de gestion.',
        });
      }

      if (!['aprobada', 'activa'].includes(reserva.estado)) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: 'La reserva no es elegible para asignacion de ultima hora.',
        });
      }

      const eligibility = buildLastMinuteEligibilityResult(reserva.fecha_inicio, reserva.fecha_fin);
      if (!eligibility.allowed) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: eligibility.message,
        });
      }

      const queueResult = await client.query(
        `
          SELECT id, usuario_id, referencia_id
          FROM cola_solicitud
          WHERE id = $1
            AND tipo = 'practica'
            AND estado = 'pendiente'
          FOR UPDATE
        `,
        [req.params.id]
      );

      const cola = queueResult.rows[0] || null;
      if (!cola?.referencia_id) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'La solicitud en cola no existe o ya fue gestionada.',
        });
      }

      const reservationQueueResult = await client.query(
        `
          SELECT id, usuario_id
          FROM reserva_practica
          WHERE id = $1
            AND estado = 'en_cola'
          FOR UPDATE
        `,
        [cola.referencia_id]
      );

      const reservaEnCola = reservationQueueResult.rows[0] || null;
      if (!reservaEnCola) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'La reserva en cola ya no se encuentra disponible para reasignacion.',
        });
      }

      if (Number(reservaEnCola.usuario_id) !== Number(cola.usuario_id)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'La reserva en cola no corresponde al usuario registrado.',
        });
      }

      const overlapResult = await client.query(
        `
          SELECT 1
          FROM reserva_practica
          WHERE usuario_id = $1
            AND id <> $2
            AND estado IN ('pendiente', 'por_aprobacion', 'con_comentarios', 'en_cola', 'aprobada', 'activa', 'iniciada')
            AND fecha_inicio < $4
            AND fecha_fin > $3
          LIMIT 1
        `,
        [cola.usuario_id, reservaEnCola.id, eligibility.now, eligibility.endDate]
      );

      if (overlapResult.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: 'El usuario de la cola ya tiene otra practica en ese horario.',
        });
      }

      await client.query(
        `
          UPDATE reserva_practica
          SET estado = 'no_asistio',
              fecha_modificacion = CURRENT_TIMESTAMP
          WHERE id = $1
            AND estado IN ('aprobada', 'activa', 'iniciada')
        `,
        [reserva.id]
      );

      await client.query(
        `
          UPDATE reserva_practica
          SET estado = 'activa',
              sala_id = $2,
              fecha_inicio = CURRENT_TIMESTAMP,
              fecha_fin = $3,
              laboratorio = $4,
              facultad = $5,
              tipo_practica = $6,
              categoria_practica = $7,
              modalidad_libre = $8,
              fecha_modificacion = CURRENT_TIMESTAMP
          WHERE id = $1
            AND estado = 'en_cola'
        `,
        [
          reservaEnCola.id,
          reserva.sala_id,
          eligibility.endDate,
          reserva.laboratorio,
          reserva.facultad,
          reserva.tipo_practica,
          reserva.categoria_practica,
          reserva.modalidad_libre,
        ]
      );

      const sessionUsuario = await fetchSessionUsuario(req);
      await client.query(
        `
          UPDATE cola_solicitud
          SET estado = 'atendida',
              atendida_por_id = $2,
              fecha_modificacion = CURRENT_TIMESTAMP
          WHERE id = $1
        `,
        [cola.id, sessionUsuario?.id || null]
      );

      await client.query('COMMIT');

      await registerPrestamosAuditEntry({
        req,
        accion: 'Asignar cola practica (Ultima hora)',
        persona: `Cola: ${cola.id} - Reserva: ${reservaEnCola.id}`,
      });

      const recipientProfile = await fetchUserNotificationProfile(cola.usuario_id);
      sendPrestamosNotification({
        sourceSystem: 'prestamos',
        templateName: 'prestamos/practica_aprobada',
        recipient: recipientProfile?.correo,
        subject: 'Reserva de practica aprobada',
        variables: {
          usuarioNombre: recipientProfile?.nombre || 'Usuario',
          solicitudId: reservaEnCola.id,
          lugar: buildPracticeNotificationLocation(reserva),
          fechaInicio: formatPdfDateTime(new Date()),
          fechaFin: formatPdfDateTime(eligibility.endDate),
          appUrl: getMilabAppUrl(),
        },
        correlationId: `practica-cola-atendida-${reservaEnCola.id}`,
      });

      return res.json({
        success: true,
        message: 'Solicitud en cola asignada por ultima hora.',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error asignando cola de ultima hora practica MiLab:', error);
      return res.status(500).json({
        success: false,
        message: resolveLoanDbErrorMessage(
          error,
          'No fue posible asignar la solicitud en cola de practica.'
        ),
      });
    } finally {
      client.release();
    }
  }
);

router.post(
  '/cola/practicas/:id/cancelar',
  requireGestionPracticasAuthorized,
  async function (req, res) {
    if (!isValidLoanRequestId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'La solicitud en cola seleccionada no es valida.',
      });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const scope = await resolveLoanManagementScope(req);
      if (!scope.unrestricted && !scope.facultyIds.length) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          success: false,
          message: 'No tienes permisos para cancelar esta solicitud en cola.',
        });
      }

      const params = [req.params.id];
      const facultyCondition = scope.unrestricted ? '' : 'AND f.facultad_id = ANY($2::int[])';

      if (!scope.unrestricted) {
        params.push(scope.facultyIds);
      }

      const laboratoryCondition = buildLaboratoryNameScopeClause(
        'COALESCE(rp.laboratorio, c.laboratorio)',
        scope,
        params
      );

      const queueResult = await client.query(
        `
          SELECT
            c.id,
            c.usuario_id,
            c.referencia_id,
            c.laboratorio,
            c.fecha_inicio,
            c.fecha_fin,
            rp.id AS reserva_id,
            rp.facultad,
            s.nombre AS sala_nombre
          FROM cola_solicitud c
          LEFT JOIN reserva_practica rp
            ON rp.id = c.referencia_id
          LEFT JOIN facultad f
            ON UPPER(f.nombre) = UPPER(COALESCE(rp.facultad, ''))
          LEFT JOIN sala s
            ON s.id = rp.sala_id
          WHERE c.id = $1
            AND c.tipo = 'practica'
            AND c.estado = 'pendiente'
            ${facultyCondition}
            ${laboratoryCondition}
          FOR UPDATE
        `,
        params
      );

      const cola = queueResult.rows[0] || null;
      if (!cola) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'La solicitud en cola no existe o ya fue gestionada.',
        });
      }

      if (cola.referencia_id) {
        await client.query(
          `
            UPDATE reserva_practica
            SET estado = 'cancelada',
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $1
              AND estado = 'en_cola'
          `,
          [cola.referencia_id]
        );
      }

      const sessionUsuario = await fetchSessionUsuario(req);
      await client.query(
        `
          UPDATE cola_solicitud
          SET estado = 'cancelada',
              atendida_por_id = $2,
              fecha_modificacion = CURRENT_TIMESTAMP
          WHERE id = $1
            AND estado = 'pendiente'
        `,
        [cola.id, sessionUsuario?.id || null]
      );

      await client.query('COMMIT');

      const recipientProfile = await fetchUserNotificationProfile(cola.usuario_id);
      sendPrestamosNotification({
        sourceSystem: 'prestamos',
        templateName: 'prestamos/reserva_rechazada',
        recipient: recipientProfile?.correo,
        subject: 'Solicitud en cola cancelada (Practica)',
        variables: {
          usuarioNombre: recipientProfile?.nombre || 'Usuario',
          solicitudId: cola.referencia_id || cola.id,
          equipoNombre: buildPracticeNotificationLocation(cola),
          fechaInicio: formatPdfDateTime(cola.fecha_inicio),
          fechaFin: formatPdfDateTime(cola.fecha_fin),
          motivoRechazo: 'La solicitud en cola fue cancelada por gestion operativa.',
          appUrl: getMilabAppUrl(),
        },
        correlationId: `practica-cola-cancelada-${cola.id}`,
      });

      return res.json({
        success: true,
        message: 'Solicitud en cola cancelada correctamente.',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error cancelando solicitud en cola de practica MiLab:', error);
      return res.status(500).json({
        success: false,
        message: resolveLoanDbErrorMessage(error, 'No fue posible cancelar la solicitud en cola.'),
      });
    } finally {
      client.release();
    }
  }
);

router.post(
  '/practicas/:id/completar',
  requireGestionPracticasAuthorized,
  async function (req, res) {
    if (!isValidLoanRequestId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'La reserva seleccionada no es valida.',
      });
    }

    try {
      const scope = await resolveLoanManagementScope(req);
      const reserva = await fetchManagedPracticeReservation(req.params.id, scope);

      if (!reserva) {
        return res.status(404).json({
          success: false,
          message: 'La reserva no existe o no pertenece a tu alcance de gestion.',
        });
      }

      if (!['activa', 'iniciada'].includes(reserva.estado)) {
        return res.status(409).json({
          success: false,
          message: 'Solo las practicas activas pueden completarse.',
        });
      }

      const nextState = reserva.tipo_practica === 'docente' ? 'finalizada' : 'completada';
      const currentState = reserva.tipo_practica === 'docente' ? 'iniciada' : 'activa';
      const incidenciaTipo = sanitizeText(
        req.body?.incidencia_tipo || req.body?.incidenciaTipo || req.body?.tipo_incidencia
      );
      const incidenciaDescripcion = sanitizeText(
        req.body?.incidencia_descripcion ||
          req.body?.incidenciaDescripcion ||
          req.body?.descripcion_incidencia
      );
      const shouldCreateIncidencia =
        reserva.tipo_practica === 'docente' && Boolean(incidenciaTipo || incidenciaDescripcion);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const result = await client.query(
          `
          UPDATE reserva_practica
          SET estado = $2,
              fecha_modificacion = CURRENT_TIMESTAMP
          WHERE id = $1
            AND estado = $3
          RETURNING id
        `,
          [reserva.id, nextState, currentState]
        );

        if (!result.rows.length) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            success: false,
            message: 'La reserva ya fue procesada por otro usuario.',
          });
        }

        if (shouldCreateIncidencia) {
          if (!incidenciaTipo || !incidenciaDescripcion) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: 'Para registrar la incidencia debes indicar tipo y descripcion.',
            });
          }

          await ensurePracticeIncidenceSchema(client);
          const sessionUsuario = await fetchSessionUsuario(req);
          await client.query(
            `
              INSERT INTO incidencia (
                origen,
                reserva_practica_id,
                practica_tipo,
                reportado_por_id,
                tipo_incidencia,
                descripcion,
                fecha_modificacion
              )
              VALUES ('practica', $1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
            `,
            [
              reserva.id,
              reserva.tipo_practica === 'docente' ? 'docente' : 'libre',
              sessionUsuario?.id || null,
              incidenciaTipo,
              incidenciaDescripcion,
            ]
          );
        }

        await client.query('COMMIT');

        await registerPrestamosAuditEntry({
          req,
          accion: 'Finalizar Practica (Recibida)',
          persona: `Reserva: ${reserva.id}`,
        });

        if (shouldCreateIncidencia) {
          await registerPrestamosAuditEntry({
            req,
            accion: 'Registrar Incidencia Practica Docente',
            persona: `Reserva: ${reserva.id}`,
          });
        }

        sendPrestamosNotification({
          sourceSystem: 'prestamos',
          templateName: 'prestamos/practica_estado',
          recipient: reserva.usuario_correo,
          subject: nextState === 'finalizada' ? 'Practica finalizada' : 'Practica completada',
          variables: {
            titulo:
              nextState === 'finalizada'
                ? 'Tu practica fue finalizada'
                : 'Tu practica fue completada',
            estadoEtiqueta: nextState === 'finalizada' ? 'FINALIZADA' : 'COMPLETADA',
            mensaje: shouldCreateIncidencia
              ? 'Se registró una incidencia docente asociada al cierre de la practica.'
              : '',
            usuarioNombre: reserva.usuario_nombre || 'Usuario',
            solicitudId: reserva.id,
            lugar: buildPracticeNotificationLocation(reserva),
            fechaInicio: formatPdfDateTime(reserva.fecha_inicio),
            fechaFin: formatPdfDateTime(reserva.fecha_fin),
            appUrl: getMilabAppUrl(),
          },
          correlationId: `practica-${nextState}-${reserva.id}`,
        });

        return res.json({
          success: true,
          message:
            nextState === 'finalizada'
              ? 'Practica finalizada correctamente.'
              : 'Practica completada correctamente.',
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error completando practica MiLab:', error);
      return res.status(500).json({
        success: false,
        message: resolveLoanDbErrorMessage(error, 'No fue posible completar la practica.'),
      });
    }
  }
);

router.get('/salas/api/facultades', requireSalasAuthorized, async function (req, res) {
  try {
    const scope = await resolveLoanManagementScope(req);
    const params = [];
    const whereParts = ['1 = 1'];

    if (!scope.unrestricted) {
      params.push(scope.facultyIds);
      whereParts.push(`f.facultad_id = ANY($${params.length}::int[])`);
    }

    const result = await pool.query(
      `
        SELECT DISTINCT f.nombre AS facultad
        FROM facultad f
        WHERE ${whereParts.join(' AND ')}
        ORDER BY f.nombre ASC
      `,
      params
    );

    return res.json({
      success: true,
      facultades: result.rows || [],
    });
  } catch (error) {
    console.error('Error cargando facultades de salas MiLab:', error);
    return res.status(500).json({
      success: false,
      facultades: [],
      message: 'No fue posible cargar las facultades.',
    });
  }
});

router.get('/salas/api/laboratorios/:facultad', requireSalasAuthorized, async function (req, res) {
  try {
    const scope = await resolveLoanManagementScope(req);
    const facultad = sanitizeText(req.params.facultad);

    if (!facultad) {
      return res.status(400).json({
        success: false,
        laboratorios: [],
        message: 'La facultad es obligatoria.',
      });
    }

    const params = [facultad];
    const whereParts = ['UPPER(f.nombre) = UPPER($1)'];

    if (!scope.unrestricted) {
      params.push(scope.facultyIds);
      whereParts.push(`f.facultad_id = ANY($${params.length}::int[])`);
    }

    const result = await pool.query(
      `
        SELECT DISTINCT u.nombre AS laboratorio
        FROM ual u
        JOIN facultad f ON f.facultad_id = u.facultad_id
        WHERE ${whereParts.join(' AND ')}
        ORDER BY u.nombre ASC
      `,
      params
    );

    return res.json({
      success: true,
      laboratorios: result.rows || [],
    });
  } catch (error) {
    console.error('Error cargando laboratorios de salas MiLab:', error);
    return res.status(500).json({
      success: false,
      laboratorios: [],
      message: 'No fue posible cargar los laboratorios.',
    });
  }
});

router.get(
  '/admin/parametrizaciones',
  requireParametrizacionesAuthorized,
  async function (req, res) {
    try {
      const config = await fetchGlobalLoanPracticeParameters();
      return res.render('home/prestamos/config/parametrizaciones', {
        config,
        successMessage: sanitizeText(req.query.success),
        errorMessage: sanitizeText(req.query.error),
      });
    } catch (error) {
      console.error('Error cargando parametrizaciones MiLab:', error);
      return res.render('home/prestamos/config/parametrizaciones', {
        config: { ...DEFAULT_PRACTICE_CONFIGURATION },
        successMessage: '',
        errorMessage: resolveLoanDbErrorMessage(
          error,
          'No fue posible cargar las parametrizaciones.'
        ),
      });
    }
  }
);

router.post(
  '/admin/parametrizaciones',
  requireParametrizacionesAuthorized,
  async function (req, res) {
    const maxHorasPracticaLibre = normalizeNonNegativeInteger(
      req.body?.max_horas_mes_practica_libre,
      0
    );
    const maxHorasPrestamos = normalizeNonNegativeInteger(req.body?.max_horas_mes_prestamos, 0);

    try {
      await pool.query(
        `
          INSERT INTO parametrizacion (
            id,
            max_horas_mes_practica_libre,
            max_horas_mes_prestamos,
            fecha_modificacion
          )
          VALUES (1, $1, $2, CURRENT_TIMESTAMP)
          ON CONFLICT (id)
          DO UPDATE SET
            max_horas_mes_practica_libre = EXCLUDED.max_horas_mes_practica_libre,
            max_horas_mes_prestamos = EXCLUDED.max_horas_mes_prestamos,
            fecha_modificacion = CURRENT_TIMESTAMP
        `,
        [maxHorasPracticaLibre, maxHorasPrestamos]
      );

      await registerPrestamosAuditEntry({
        req,
        accion: 'Configurar Parametrizaciones (Admin)',
        persona: 'Cuotas mensuales',
      });

      return res.redirect(
        '/milab/prestamos/admin/parametrizaciones?success=Parametrizaciones actualizadas correctamente.'
      );
    } catch (error) {
      console.error('Error guardando parametrizaciones MiLab:', error);
      return res.redirect(
        `/milab/prestamos/admin/parametrizaciones?error=${encodeURIComponent(
          resolveLoanDbErrorMessage(error, 'No fue posible guardar las parametrizaciones.')
        )}`
      );
    }
  }
);

router.get(
  '/coordinador/practicas/config',
  requirePracticasConfigAuthorized,
  async function (req, res) {
    try {
      await ensureAcademicPracticeSchema();
      const facultades = await fetchScopedPracticeConfigurationFaculties(req);
      const selectedId = Number(req.query?.facultad_id || facultades[0]?.facultad_id || 0);
      const selectedFaculty = facultades.find((item) => Number(item.facultad_id) === selectedId);
      const laboratorios = selectedFaculty
        ? await fetchScopedPracticeConfigurationLaboratories(req, selectedFaculty.facultad_id)
        : [];
      const selectedUalId = Number(req.query?.ual_id || laboratorios[0]?.ual_id || 0);
      const selectedLaboratory = laboratorios.find((item) => Number(item.ual_id) === selectedUalId);
      const dynamicPracticeSchema = selectedLaboratory
        ? await fetchDynamicPracticeSchemaByUalId(selectedLaboratory.ual_id)
        : { ...DEFAULT_DYNAMIC_PRACTICE_SCHEMA };
      const academicPractices = selectedLaboratory
        ? await fetchAcademicPracticesByUalId(selectedLaboratory.ual_id)
        : [];

      return res.render('home/prestamos/practicas/configuracion', {
        facultades,
        selectedFacultyId: selectedFaculty?.facultad_id || null,
        selectedFacultyName: selectedFaculty?.nombre || '',
        laboratorios,
        selectedUalId: selectedLaboratory?.ual_id || null,
        selectedLaboratoryName: selectedLaboratory?.nombre || '',
        config: selectedFaculty
          ? await fetchPracticeConfigurationByFacultyId(selectedFaculty.facultad_id)
          : { ...DEFAULT_PRACTICE_CONFIGURATION },
        dynamicPracticeSchema,
        academicPractices,
        successMessage: sanitizeText(req.query.success),
        errorMessage:
          sanitizeText(req.query.error) ||
          (!facultades.length ? 'No hay facultades asociadas para configurar practicas.' : ''),
      });
    } catch (error) {
      console.error('Error cargando configuracion de practicas MiLab:', error);
      return res.render('home/prestamos/practicas/configuracion', {
        facultades: [],
        selectedFacultyId: null,
        selectedFacultyName: '',
        laboratorios: [],
        selectedUalId: null,
        selectedLaboratoryName: '',
        config: { ...DEFAULT_PRACTICE_CONFIGURATION },
        dynamicPracticeSchema: { ...DEFAULT_DYNAMIC_PRACTICE_SCHEMA },
        academicPractices: [],
        successMessage: '',
        errorMessage: resolveLoanDbErrorMessage(
          error,
          'No fue posible cargar la configuracion de practicas.'
        ),
      });
    }
  }
);

router.post(
  '/coordinador/practicas/config',
  requirePracticasConfigAuthorized,
  async function (req, res) {
    try {
      const facultades = await fetchScopedPracticeConfigurationFaculties(req);
      const selectedId = Number(req.body?.facultad_id || 0);
      const selectedUalId = Number(req.body?.ual_id || req.query?.ual_id || 0);
      const selectedFaculty = facultades.find((item) => Number(item.facultad_id) === selectedId);

      if (!selectedFaculty) {
        return res.redirect(
          '/milab/prestamos/coordinador/practicas/config?error=La facultad seleccionada no es valida'
        );
      }

      const minCancelHours = normalizePositiveInteger(
        req.body?.min_cancel_hours,
        DEFAULT_PRACTICE_CONFIGURATION.min_cancel_hours
      );
      const minReservaHours = normalizePositiveInteger(
        req.body?.min_reserva_hours,
        DEFAULT_PRACTICE_CONFIGURATION.min_reserva_hours
      );
      const minDocenteReservaDays = normalizeNonNegativeInteger(
        req.body?.min_docente_reserva_days,
        DEFAULT_PRACTICE_CONFIGURATION.min_docente_reserva_days
      );
      const maxActivasEstudiante = normalizePositiveInteger(
        req.body?.max_activas_estudiante,
        DEFAULT_PRACTICE_CONFIGURATION.max_activas_estudiante
      );
      const diasSancion = normalizeNonNegativeInteger(
        req.body?.dias_sancion_no_asistencia,
        DEFAULT_PRACTICE_CONFIGURATION.dias_sancion_no_asistencia
      );

      await pool.query(
        `
          INSERT INTO practica_config (
            facultad_id,
            min_cancel_hours,
            min_reserva_hours,
            min_docente_reserva_days,
            max_activas_estudiante,
            dias_sancion_no_asistencia,
            fecha_modificacion
          )
          VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
          ON CONFLICT (facultad_id)
          DO UPDATE SET
            min_cancel_hours = EXCLUDED.min_cancel_hours,
            min_reserva_hours = EXCLUDED.min_reserva_hours,
            min_docente_reserva_days = EXCLUDED.min_docente_reserva_days,
            max_activas_estudiante = EXCLUDED.max_activas_estudiante,
            dias_sancion_no_asistencia = EXCLUDED.dias_sancion_no_asistencia,
            fecha_modificacion = CURRENT_TIMESTAMP
        `,
        [
          selectedFaculty.facultad_id,
          minCancelHours,
          minReservaHours,
          minDocenteReservaDays,
          maxActivasEstudiante,
          diasSancion,
        ]
      );

      await registerPrestamosAuditEntry({
        req,
        accion: 'Configurar Practicas (Coordinador)',
        persona: `Facultad: ${selectedFaculty.nombre || selectedFaculty.facultad_id}`,
      });

      return res.redirect(
        `/milab/prestamos/coordinador/practicas/config?facultad_id=${encodeURIComponent(
          String(selectedFaculty.facultad_id)
        )}&ual_id=${encodeURIComponent(String(selectedUalId || ''))}&success=${encodeURIComponent(
          'Configuracion actualizada correctamente.'
        )}`
      );
    } catch (error) {
      console.error('Error guardando configuracion de practicas MiLab:', error);
      return res.redirect(
        `/milab/prestamos/coordinador/practicas/config?error=${encodeURIComponent(
          resolveLoanDbErrorMessage(error, 'No fue posible guardar la configuracion de practicas.')
        )}`
      );
    }
  }
);

router.post(
  '/coordinador/practicas/config/schema',
  requirePracticasConfigAuthorized,
  async function (req, res) {
    const payload = buildDynamicPracticeSchemaPayload(req.body);
    const schemaError = validateDynamicPracticeSchema(payload.schema_json);

    if (!/^\d+$/.test(String(payload.ual_id || ''))) {
      return res.status(400).json({
        success: false,
        message: 'Debes seleccionar un laboratorio valido para guardar el esquema.',
      });
    }

    if (schemaError) {
      return res.status(400).json({
        success: false,
        message: schemaError,
      });
    }

    try {
      await ensureAcademicPracticeSchema();
      const scope = await resolveLoanManagementScope(req);
      const managedUal = await fetchManagedUalById(payload.ual_id, scope);
      const sessionUsuario = await fetchSessionUsuario(req);

      if (!managedUal) {
        return res.status(403).json({
          success: false,
          message: 'El laboratorio seleccionado no pertenece a tu alcance de gestion.',
        });
      }

      await pool.query(
        `
          INSERT INTO configuracion_practica (
            ual_id,
            schema_json,
            creado_por_id,
            fecha_modificacion
          )
          VALUES ($1, $2::jsonb, $3, CURRENT_TIMESTAMP)
          ON CONFLICT (ual_id)
          DO UPDATE SET
            schema_json = EXCLUDED.schema_json,
            creado_por_id = EXCLUDED.creado_por_id,
            activo = TRUE,
            fecha_modificacion = CURRENT_TIMESTAMP
        `,
        [managedUal.ual_id, payload.schema_json, sessionUsuario?.id || null]
      );

      await registerPrestamosAuditEntry({
        req,
        accion: 'Configurar Practicas (Coordinador)',
        persona: `Esquema dinamico: ${managedUal.laboratorio || managedUal.ual_id}`,
      });

      return res.json({
        success: true,
        message: 'Esquema dinamico guardado correctamente.',
        schema: payload.schema_json,
      });
    } catch (error) {
      console.error('Error guardando esquema dinamico de practicas MiLab:', error);
      return res.status(500).json({
        success: false,
        message: resolveLoanDbErrorMessage(
          error,
          'No fue posible guardar el esquema dinamico de la practica.'
        ),
      });
    }
  }
);

router.post(
  '/coordinador/practicas/catalogo',
  requirePracticasConfigAuthorized,
  async function (req, res) {
    const payload = buildAcademicPracticePayload(req.body);

    try {
      await ensureAcademicPracticeSchema();
      const scope = await resolveLoanManagementScope(req);
      const managedUal = await fetchManagedUalById(payload.ual_id, scope);
      const sessionUsuario = await fetchSessionUsuario(req);

      if (!managedUal) {
        return res.status(403).json({
          success: false,
          message: 'El laboratorio seleccionado no pertenece a tu alcance de gestion.',
        });
      }

      const dynamicSchema = await fetchDynamicPracticeSchemaByUalId(managedUal.ual_id);
      const validationError = validateAcademicPracticePayload(payload, dynamicSchema);
      if (validationError) {
        return res.status(400).json({
          success: false,
          message: validationError,
        });
      }

      const validatedDocuments = await validatePracticeDocumentLinks(payload.documentos);
      const documentWarnings = validatedDocuments
        .filter((item) => !item.validacion?.available)
        .map((item) => item.validacion?.warning)
        .filter(Boolean);

      const configuracionJson = {
        documentos: validatedDocuments.map(function (item) {
          return { url: item.url };
        }),
        insumos: payload.insumos,
        equipos: payload.equipos,
        duracion: payload.duracion ? Number(payload.duracion) : null,
        competencias: payload.competencias,
        guias_trabajo: payload.guias_trabajo,
        recomendaciones_seguridad: payload.recomendaciones_seguridad,
        parametros_evaluacion: payload.parametros_evaluacion,
        recomendaciones: payload.recomendaciones,
        observaciones: payload.observaciones,
        configuracion_dinamica: payload.configuracion_dinamica,
        schema_aplicado: dynamicSchema,
      };

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        let practiceId = null;
        if (/^\d+$/.test(String(payload.practica_id || ''))) {
          const existingPractice = await fetchManagedAcademicPractice(payload.practica_id, scope);

          if (!existingPractice) {
            await client.query('ROLLBACK');
            return res.status(404).json({
              success: false,
              message: 'La practica seleccionada no existe o no pertenece a tu alcance.',
            });
          }

          practiceId = Number(payload.practica_id);
          await client.query(
            `
              UPDATE practica
              SET
                ual_id = $2,
                nombre = $3,
                descripcion = $4,
                tipo_practica = $5,
                estado = $6,
                configuracion_json = $7::jsonb,
                activo = TRUE,
                fecha_modificacion = CURRENT_TIMESTAMP
              WHERE id = $1
            `,
            [
              practiceId,
              managedUal.ual_id,
              payload.nombre,
              payload.descripcion,
              payload.tipo_practica,
              payload.estado,
              configuracionJson,
            ]
          );
        } else {
          const insertResult = await client.query(
            `
              INSERT INTO practica (
                ual_id,
                nombre,
                descripcion,
                tipo_practica,
                estado,
                configuracion_json,
                creado_por_id,
                fecha_modificacion
              )
              VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, CURRENT_TIMESTAMP)
              RETURNING id
            `,
            [
              managedUal.ual_id,
              payload.nombre,
              payload.descripcion,
              payload.tipo_practica,
              payload.estado,
              configuracionJson,
              sessionUsuario?.id || null,
            ]
          );
          practiceId = insertResult.rows[0]?.id || null;
        }

        await upsertAcademicPracticeSubjects(client, practiceId, payload.asignaturas);

        await client.query('COMMIT');

        await registerPrestamosAuditEntry({
          req,
          accion: 'Configurar Practicas (Coordinador)',
          persona: `Practica academica: ${payload.nombre}`,
        });

        return res.json({
          success: true,
          message: /^\d+$/.test(String(payload.practica_id || ''))
            ? 'Practica academica actualizada correctamente.'
            : 'Practica academica creada correctamente.',
          warnings: documentWarnings,
          practiceId,
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error guardando practica academica MiLab:', error);
      return res.status(500).json({
        success: false,
        message: resolveLoanDbErrorMessage(error, 'No fue posible guardar la practica academica.'),
      });
    }
  }
);

router.get('/salas', requireSalasAuthorized, async function (req, res) {
  try {
    const scope = await resolveLoanManagementScope(req);
    const facultad = sanitizeText(req.query.facultad);
    const laboratorio = sanitizeText(req.query.laboratorio);
    const params = [];
    const whereParts = ['1 = 1'];
    const salasColumns = await fetchTableColumns('sala');
    const equiposSelect = salasColumns.has('equipos_nombres') ? 's.equipos_nombres' : 'NULL::text';

    if (!scope.unrestricted) {
      params.push(scope.facultyIds);
      whereParts.push(`f.facultad_id = ANY($${params.length}::int[])`);
    }

    if (facultad) {
      params.push(facultad);
      whereParts.push(`UPPER(f.nombre) = UPPER($${params.length})`);
    }

    if (laboratorio) {
      params.push(laboratorio);
      whereParts.push(`UPPER(u.nombre) = UPPER($${params.length})`);
    }

    const result = await pool.query(
      `
        SELECT
          s.id,
          s.nombre,
          s.tipo_espacio,
          s.permite_practica_libre,
          s.permite_practica_docente,
          s.formato_practica_libre,
          s.formato_practica_docente,
          s.capacidad,
          s.descripcion,
          ${equiposSelect} AS equipos_nombres,
          s.activo,
          u.nombre AS laboratorio,
          f.nombre AS facultad,
          (
            SELECT COUNT(*)
            FROM horario_sala h
            WHERE h.sala_id = s.id
          ) AS total_horarios
        FROM sala s
        JOIN ual u ON u.ual_id = s.ual_id
        JOIN facultad f ON f.facultad_id = u.facultad_id
        WHERE ${whereParts.join(' AND ')}
        ORDER BY f.nombre ASC, u.nombre ASC, s.nombre ASC
      `,
      params
    );

    return res.render('home/prestamos/salas/index', {
      salas: result.rows || [],
      selectedFacultad: facultad || '',
      selectedLaboratorio: laboratorio || '',
      successMessage: sanitizeText(req.query.success),
      errorMessage: sanitizeText(req.query.error),
    });
  } catch (error) {
    console.error('Error cargando salas MiLab:', error);
    return res.render('home/prestamos/salas/index', {
      salas: [],
      selectedFacultad: '',
      selectedLaboratorio: '',
      successMessage: '',
      errorMessage: resolveLoanDbErrorMessage(error, 'No fue posible cargar las salas.'),
    });
  }
});

router.post('/salas', requireSalasAuthorized, async function (req, res) {
  const payload = buildSalaPayload(req.body);
  const validationError = validateSalaPayload(payload);

  if (validationError) {
    return res.status(400).json({
      success: false,
      message: validationError,
    });
  }

  try {
    const scope = await resolveLoanManagementScope(req);
    const managedUal = await resolveManagedUal(payload, scope);

    if (!managedUal?.ual_id) {
      return res.status(403).json({
        success: false,
        message: 'La facultad y el laboratorio no pertenecen a tu alcance de gestion.',
      });
    }

    const salasColumns = await fetchTableColumns('sala');
    const insertColumns = [
      'ual_id',
      'nombre',
      'tipo_espacio',
      'permite_practica_libre',
      'permite_practica_docente',
      'formato_practica_libre',
      'formato_practica_docente',
      'capacidad',
      'descripcion',
      'activo',
    ];
    const insertValues = [
      managedUal.ual_id,
      payload.nombre,
      payload.tipo_espacio || 'Sala',
      payload.permite_practica_libre,
      payload.permite_practica_docente,
      payload.formato_practica_libre || 'PL_REGLAMENTO_GENERAL',
      payload.formato_practica_docente || 'DOC_PRACTICA_DOCENTE_SOLICITUD',
      Number(payload.capacidad),
      payload.descripcion,
      payload.activo,
    ];

    if (salasColumns.has('equipos_nombres')) {
      insertColumns.push('equipos_nombres');
      insertValues.push(payload.equipos_nombres);
    }

    const placeholders = insertValues.map(function (_, index) {
      return `$${index + 1}`;
    });

    const result = await pool.query(
      `
        INSERT INTO sala (
          ${insertColumns.join(', ')},
          fecha_modificacion
        )
        VALUES (${placeholders.join(', ')}, CURRENT_TIMESTAMP)
        RETURNING id
      `,
      insertValues
    );

    return res.json({
      success: true,
      message: 'Sala creada correctamente.',
      salaId: result.rows[0]?.id || null,
    });
  } catch (error) {
    console.error('Error creando sala MiLab:', error);
    return res.status(500).json({
      success: false,
      message: resolveLoanDbErrorMessage(error, 'No fue posible crear la sala.'),
    });
  }
});

router.post('/salas/:id', requireSalasAuthorized, async function (req, res) {
  if (!isValidSalaId(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: 'La sala seleccionada no es valida.',
    });
  }

  const payload = buildSalaPayload(req.body);
  const validationError = validateSalaPayload(payload);

  if (validationError) {
    return res.status(400).json({
      success: false,
      message: validationError,
    });
  }

  try {
    const scope = await resolveLoanManagementScope(req);
    const managedUal = await resolveManagedUal(payload, scope);
    const sala = await fetchManagedSala(req.params.id, scope);

    if (!managedUal?.ual_id || !sala) {
      return res.status(404).json({
        success: false,
        message: 'La sala no existe o no pertenece a tu alcance de gestion.',
      });
    }

    const salasColumns = await fetchTableColumns('sala');
    const updateParts = [];
    const updateValues = [sala.id];
    let updateIndex = 1;

    function pushSalaUpdate(column, value) {
      updateIndex += 1;
      updateParts.push(`${column} = $${updateIndex}`);
      updateValues.push(value);
    }

    pushSalaUpdate('ual_id', managedUal.ual_id);
    pushSalaUpdate('nombre', payload.nombre);
    pushSalaUpdate('tipo_espacio', payload.tipo_espacio || 'Sala');
    pushSalaUpdate('permite_practica_libre', payload.permite_practica_libre);
    pushSalaUpdate('permite_practica_docente', payload.permite_practica_docente);
    pushSalaUpdate(
      'formato_practica_libre',
      payload.formato_practica_libre || 'PL_REGLAMENTO_GENERAL'
    );
    pushSalaUpdate(
      'formato_practica_docente',
      payload.formato_practica_docente || 'DOC_PRACTICA_DOCENTE_SOLICITUD'
    );
    pushSalaUpdate('capacidad', Number(payload.capacidad));
    pushSalaUpdate('descripcion', payload.descripcion);
    pushSalaUpdate('activo', payload.activo);

    if (salasColumns.has('equipos_nombres')) {
      pushSalaUpdate('equipos_nombres', payload.equipos_nombres);
    }

    updateParts.push('fecha_modificacion = CURRENT_TIMESTAMP');

    const result = await pool.query(
      `
        UPDATE sala
        SET ${updateParts.join(', ')}
        WHERE id = $1
        RETURNING id
      `,
      updateValues
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: 'La sala no existe.',
      });
    }

    return res.json({
      success: true,
      message: 'Sala actualizada correctamente.',
    });
  } catch (error) {
    console.error('Error actualizando sala MiLab:', error);
    return res.status(500).json({
      success: false,
      message: resolveLoanDbErrorMessage(error, 'No fue posible actualizar la sala.'),
    });
  }
});

router.post('/salas/:id/eliminar', requireSalasAuthorized, async function (req, res) {
  if (!isValidSalaId(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: 'La sala seleccionada no es valida.',
    });
  }

  try {
    const scope = await resolveLoanManagementScope(req);
    const sala = await fetchManagedSala(req.params.id, scope);

    if (!sala) {
      return res.status(404).json({
        success: false,
        message: 'La sala no existe o no pertenece a tu alcance de gestion.',
      });
    }

    await pool.query('DELETE FROM sala WHERE id = $1', [sala.id]);

    return res.json({
      success: true,
      message: 'Sala eliminada correctamente.',
    });
  } catch (error) {
    console.error('Error eliminando sala MiLab:', error);
    return res.status(500).json({
      success: false,
      message: resolveLoanDbErrorMessage(error, 'No fue posible eliminar la sala.'),
    });
  }
});

router.get('/salas/:id/horarios', requireSalasAuthorized, async function (req, res) {
  if (!isValidSalaId(req.params.id)) {
    return res.redirect('/milab/prestamos/salas?error=La sala seleccionada no es valida');
  }

  try {
    const scope = await resolveLoanManagementScope(req);
    const sala = await fetchManagedSala(req.params.id, scope);

    if (!sala) {
      return res.redirect(
        '/milab/prestamos/salas?error=La sala no existe o no pertenece a tu alcance'
      );
    }

    const result = await pool.query(
      `
        SELECT
          id,
          dia_semana,
          hora_inicio,
          hora_fin,
          fecha,
          activo,
          tipo_practica,
          modalidad_libre
        FROM horario_sala
        WHERE sala_id = $1
        ORDER BY fecha ASC NULLS LAST, dia_semana ASC NULLS LAST, hora_inicio ASC
      `,
      [sala.id]
    );

    return res.render('home/prestamos/salas/horarios', {
      sala,
      horarios: result.rows || [],
      successMessage: sanitizeText(req.query.success),
      errorMessage: sanitizeText(req.query.error),
    });
  } catch (error) {
    console.error('Error cargando horarios de sala MiLab:', error);
    return res.redirect(
      `/milab/prestamos/salas?error=${encodeURIComponent(
        resolveLoanDbErrorMessage(error, 'No fue posible cargar los horarios de la sala.')
      )}`
    );
  }
});

router.post('/salas/:id/horarios', requireSalasAuthorized, async function (req, res) {
  if (!isValidSalaId(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: 'La sala seleccionada no es valida.',
    });
  }

  const payload = buildSalaSchedulePayload(req.body);
  const validationError = validateSalaSchedulePayload(payload);

  if (validationError) {
    return res.status(400).json({
      success: false,
      message: validationError,
    });
  }

  try {
    const scope = await resolveLoanManagementScope(req);
    const sala = await fetchManagedSala(req.params.id, scope);

    if (!sala) {
      return res.status(404).json({
        success: false,
        message: 'La sala no existe o no pertenece a tu alcance de gestion.',
      });
    }

    const overlapResult = await pool.query(
      `
        SELECT 1
        FROM horario_sala
        WHERE sala_id = $1
          AND (
            (fecha = $2 AND $2 IS NOT NULL) OR
            (fecha IS NULL AND dia_semana = $3 AND $2 IS NULL)
          )
          AND hora_inicio < $5
          AND hora_fin > $4
        LIMIT 1
      `,
      [
        sala.id,
        payload.fecha || null,
        payload.fecha ? null : Number(payload.dia_semana),
        payload.hora_inicio,
        payload.hora_fin,
      ]
    );

    if (overlapResult.rows.length) {
      return res.status(409).json({
        success: false,
        message: 'El horario se solapa con otro ya registrado.',
      });
    }

    await pool.query(
      `
        INSERT INTO horario_sala (
          sala_id,
          dia_semana,
          hora_inicio,
          hora_fin,
          fecha,
          activo,
          tipo_practica,
          modalidad_libre,
          fecha_modificacion
        )
        VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7, CURRENT_TIMESTAMP)
      `,
      [
        sala.id,
        payload.fecha ? null : Number(payload.dia_semana),
        payload.hora_inicio,
        payload.hora_fin,
        payload.fecha || null,
        payload.tipo_practica || 'libre',
        payload.tipo_practica === 'libre' ? payload.modalidad_libre || 'uno_a_uno' : null,
      ]
    );

    return res.json({
      success: true,
      message: 'Horario agregado correctamente.',
    });
  } catch (error) {
    console.error('Error creando horario de sala MiLab:', error);
    return res.status(500).json({
      success: false,
      message: resolveLoanDbErrorMessage(error, 'No fue posible guardar el horario.'),
    });
  }
});

router.post('/salas/horarios/:id/eliminar', requireSalasAuthorized, async function (req, res) {
  if (!isValidSalaId(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: 'El horario seleccionado no es valido.',
    });
  }

  try {
    const scope = await resolveLoanManagementScope(req);
    const payload = buildPracticeManagementPayload(req.body);
    const affected = await fetchAffectedPracticeReservationsBySchedule(req.params.id, scope);
    const horario = affected.horario;

    if (!horario) {
      return res.status(404).json({
        success: false,
        message: 'El horario no existe o no pertenece a tu alcance de gestion.',
      });
    }

    if (affected.reservas.length && !payload.confirmar_cierre) {
      return res.status(409).json({
        success: false,
        requiere_confirmacion: true,
        message:
          'Este horario tiene practicas asociadas. Confirma el cierre para cancelar las reservas pendientes, aprobadas o activas afectadas.',
        reservas_afectadas: affected.reservas,
      });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      if (affected.reservas.length) {
        await client.query(
          `
            UPDATE reserva_practica
            SET estado = 'cancelada',
                motivo_rechazo = COALESCE(motivo_rechazo, 'Reserva cancelada por cierre del horario de la sala.'),
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = ANY($1::bigint[])
          `,
          [affected.reservas.map((item) => Number(item.id))]
        );
      }

      await client.query('DELETE FROM horario_sala WHERE id = $1', [horario.id]);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return res.json({
      success: true,
      message: affected.reservas.length
        ? 'Horario eliminado y reservas afectadas canceladas correctamente.'
        : 'Horario eliminado correctamente.',
    });
  } catch (error) {
    console.error('Error eliminando horario de sala MiLab:', error);
    return res.status(500).json({
      success: false,
      message: resolveLoanDbErrorMessage(error, 'No fue posible eliminar el horario.'),
    });
  }
});

router.get('/reportes/export/:dataset', requireReportesAuthorized, async function (req, res) {
  try {
    const scope = await resolveLoanManagementScope(req);
    const range = resolveReportDateRange(req.query);
    const dataset = sanitizeText(req.params.dataset);

    if (!range.isValid) {
      return res.redirect(
        `/milab/prestamos/reportes?error=${encodeURIComponent(
          'La fecha inicial no puede ser posterior a la fecha final.'
        )}`
      );
    }

    if (!dataset) {
      return res.redirect(
        `/milab/prestamos/reportes?error=${encodeURIComponent(
          'Debes indicar el dataset que deseas exportar.'
        )}`
      );
    }

    if (dataset === 'solicitudes') {
      const params = [range.fechaInicio, range.fechaFin];
      const scopeClause = buildFacultyNameScopeClause('e.facultad', scope, params);
      const result = await pool.query(
        `
          SELECT
            sp.id,
            sp.fecha_creacion,
            sp.fecha_inicio,
            sp.fecha_fin,
            sp.estado,
            sp.categoria_practica,
            sp.firma_digital,
            e.codigo AS equipo_codigo,
            e.nombre AS equipo_nombre,
            COALESCE(e.facultad, f.nombre) AS facultad,
            e.laboratorio,
            u.documento AS usuario_documento,
            u.nombre AS usuario_nombre,
            u.correo AS usuario_correo
          FROM solicitud_prestamo sp
          JOIN equipo e ON e.id = sp.equipo_id
          JOIN usuario u ON u.id = sp.usuario_id
          LEFT JOIN ual ual_item ON UPPER(ual_item.nombre) = UPPER(e.laboratorio)
          LEFT JOIN facultad f ON f.facultad_id = ual_item.facultad_id
          WHERE sp.fecha_inicio >= $1::date
            AND sp.fecha_inicio < ($2::date + INTERVAL '1 day')
            ${scopeClause}
          ORDER BY sp.fecha_inicio DESC, sp.id DESC
        `,
        params
      );

      return sendCsvResponse(
        res,
        `reportes-solicitudes-${range.fechaInicio}-${range.fechaFin}.csv`,
        [
          { key: 'id', label: 'ID' },
          { key: 'fecha_creacion', label: 'Fecha creacion' },
          { key: 'fecha_inicio', label: 'Fecha inicio' },
          { key: 'fecha_fin', label: 'Fecha fin' },
          { key: 'estado', label: 'Estado' },
          { key: 'categoria_practica', label: 'Categoria' },
          { key: 'equipo_codigo', label: 'Codigo equipo' },
          { key: 'equipo_nombre', label: 'Equipo' },
          { key: 'facultad', label: 'Facultad' },
          { key: 'laboratorio', label: 'Laboratorio' },
          { key: 'usuario_documento', label: 'Documento solicitante' },
          { key: 'usuario_nombre', label: 'Solicitante' },
          { key: 'usuario_correo', label: 'Correo' },
          { key: 'firma_digital', label: 'Firma digital' },
        ],
        result.rows || []
      );
    }

    if (dataset === 'practicas') {
      const params = [range.fechaInicio, range.fechaFin];
      const scopeClause = buildFacultyNameScopeClause('rp.facultad', scope, params);
      const result = await pool.query(
        `
          SELECT
            rp.id,
            rp.fecha_creacion,
            rp.fecha_inicio,
            rp.fecha_fin,
            rp.estado,
            rp.tipo_practica,
            rp.categoria_practica,
            rp.modalidad_libre,
            rp.facultad,
            rp.laboratorio,
            rp.justificacion,
            rp.firma_digital,
            s.nombre AS sala_nombre,
            u.documento AS usuario_documento,
            u.nombre AS usuario_nombre,
            u.correo AS usuario_correo
          FROM reserva_practica rp
          JOIN usuario u ON u.id = rp.usuario_id
          LEFT JOIN sala s ON s.id = rp.sala_id
          WHERE rp.fecha_inicio >= $1::date
            AND rp.fecha_inicio < ($2::date + INTERVAL '1 day')
            ${scopeClause}
          ORDER BY rp.fecha_inicio DESC, rp.id DESC
        `,
        params
      );

      return sendCsvResponse(
        res,
        `reportes-practicas-${range.fechaInicio}-${range.fechaFin}.csv`,
        [
          { key: 'id', label: 'ID' },
          { key: 'fecha_creacion', label: 'Fecha creacion' },
          { key: 'fecha_inicio', label: 'Fecha inicio' },
          { key: 'fecha_fin', label: 'Fecha fin' },
          { key: 'estado', label: 'Estado' },
          { key: 'tipo_practica', label: 'Tipo practica' },
          { key: 'categoria_practica', label: 'Categoria' },
          { key: 'modalidad_libre', label: 'Modalidad libre' },
          { key: 'facultad', label: 'Facultad' },
          { key: 'laboratorio', label: 'Laboratorio' },
          { key: 'sala_nombre', label: 'Sala' },
          { key: 'usuario_documento', label: 'Documento solicitante' },
          { key: 'usuario_nombre', label: 'Solicitante' },
          { key: 'usuario_correo', label: 'Correo' },
          { key: 'firma_digital', label: 'Firma digital' },
          { key: 'justificacion', label: 'Justificacion' },
        ],
        result.rows || []
      );
    }

    if (dataset === 'incidencias') {
      const params = [range.fechaInicio, range.fechaFin];
      const scopeClause = buildFacultyNameScopeClause('e.facultad', scope, params);
      const result = await pool.query(
        `
          SELECT
            i.id,
            i.fecha_creacion,
            i.estado,
            i.tipo_incidencia,
            i.descripcion,
            i.descripcion_cierre,
            e.codigo AS equipo_codigo,
            e.nombre AS equipo_nombre,
            e.facultad,
            e.laboratorio,
            i.documento_que_reporto,
            i.nombre_que_reporto
          FROM incidencia i
          JOIN equipo e ON e.id = i.equipo_id
          WHERE i.fecha_creacion >= $1::date
            AND i.fecha_creacion < ($2::date + INTERVAL '1 day')
            ${scopeClause}
          ORDER BY i.fecha_creacion DESC, i.id DESC
        `,
        params
      );

      return sendCsvResponse(
        res,
        `reportes-incidencias-${range.fechaInicio}-${range.fechaFin}.csv`,
        [
          { key: 'id', label: 'ID' },
          { key: 'fecha_creacion', label: 'Fecha creacion' },
          { key: 'estado', label: 'Estado' },
          { key: 'tipo_incidencia', label: 'Tipo incidencia' },
          { key: 'descripcion', label: 'Descripcion' },
          { key: 'descripcion_cierre', label: 'Descripcion cierre' },
          { key: 'equipo_codigo', label: 'Codigo equipo' },
          { key: 'equipo_nombre', label: 'Equipo' },
          { key: 'facultad', label: 'Facultad' },
          { key: 'laboratorio', label: 'Laboratorio' },
          { key: 'documento_que_reporto', label: 'Documento reporta' },
          { key: 'nombre_que_reporto', label: 'Nombre reporta' },
        ],
        result.rows || []
      );
    }

    if (dataset === 'equipos-top') {
      const params = [range.fechaInicio, range.fechaFin];
      const scopeClause = buildFacultyNameScopeClause('e.facultad', scope, params);
      const result = await pool.query(
        `
          SELECT
            e.codigo,
            e.nombre,
            e.facultad,
            e.laboratorio,
            COUNT(*)::int AS cantidad
          FROM solicitud_prestamo sp
          JOIN equipo e ON e.id = sp.equipo_id
          WHERE sp.fecha_inicio >= $1::date
            AND sp.fecha_inicio < ($2::date + INTERVAL '1 day')
            ${scopeClause}
          GROUP BY e.id, e.codigo, e.nombre, e.facultad, e.laboratorio
          ORDER BY cantidad DESC, e.nombre ASC
        `,
        params
      );

      return sendCsvResponse(
        res,
        `reportes-equipos-top-${range.fechaInicio}-${range.fechaFin}.csv`,
        [
          { key: 'codigo', label: 'Codigo' },
          { key: 'nombre', label: 'Equipo' },
          { key: 'facultad', label: 'Facultad' },
          { key: 'laboratorio', label: 'Laboratorio' },
          { key: 'cantidad', label: 'Cantidad' },
        ],
        result.rows || []
      );
    }

    if (dataset === 'salas-top') {
      const params = [range.fechaInicio, range.fechaFin];
      const scopeClause = buildFacultyIdScopeClause('u.facultad_id', scope, params);
      const result = await pool.query(
        `
          SELECT
            s.nombre,
            f.nombre AS facultad,
            u.nombre AS laboratorio,
            COUNT(*)::int AS cantidad
          FROM reserva_practica rp
          JOIN sala s ON s.id = rp.sala_id
          JOIN ual u ON u.ual_id = s.ual_id
          JOIN facultad f ON f.facultad_id = u.facultad_id
          WHERE rp.fecha_inicio >= $1::date
            AND rp.fecha_inicio < ($2::date + INTERVAL '1 day')
            ${scopeClause}
          GROUP BY s.id, s.nombre, f.nombre, u.nombre
          ORDER BY cantidad DESC, s.nombre ASC
        `,
        params
      );

      return sendCsvResponse(
        res,
        `reportes-salas-top-${range.fechaInicio}-${range.fechaFin}.csv`,
        [
          { key: 'nombre', label: 'Sala' },
          { key: 'facultad', label: 'Facultad' },
          { key: 'laboratorio', label: 'Laboratorio' },
          { key: 'cantidad', label: 'Cantidad' },
        ],
        result.rows || []
      );
    }

    return res.redirect(
      `/milab/prestamos/reportes?error=${encodeURIComponent(
        'El tipo de exportacion solicitado no existe.'
      )}`
    );
  } catch (error) {
    console.error('Error exportando reportes de prestamos MiLab:', error);
    return res.redirect(
      `/milab/prestamos/reportes?error=${encodeURIComponent(
        resolveLoanDbErrorMessage(error, 'No fue posible exportar el reporte solicitado.')
      )}`
    );
  }
});

router.get('/reportes/print', requireReportesAuthorized, async function (req, res) {
  try {
    const scope = await resolveLoanManagementScope(req);
    const range = resolveReportDateRange(req.query);

    if (!range.isValid) {
      return res.redirect(
        `/milab/prestamos/reportes?error=${encodeURIComponent(
          'La fecha inicial no puede ser posterior a la fecha final.'
        )}`
      );
    }

    const reportData = await fetchLoanReportsViewData(scope, range);

    return res.render('home/prestamos/reportes/print', {
      ...reportData,
      generatedAt: new Date().toLocaleString('es-CO'),
      autoPrint: toBoolean(req.query.autoprint),
    });
  } catch (error) {
    console.error('Error cargando vista imprimible de reportes MiLab:', error);
    return res.redirect(
      `/milab/prestamos/reportes?error=${encodeURIComponent(
        resolveLoanDbErrorMessage(error, 'No fue posible generar la vista imprimible del reporte.')
      )}`
    );
  }
});

router.get('/coordinador/firma', requireCoordinatorSignatureAuthorized, async function (req, res) {
  try {
    const coordinator = await fetchCoordinatorSignatureRecord(req);

    return res.render('home/prestamos/coordinador/firma', {
      coordinator,
      firmaActual: coordinator?.firma_digital || null,
      fechaFirma: coordinator?.fecha_firma
        ? new Date(coordinator.fecha_firma).toLocaleString('es-CO')
        : null,
      successMessage: sanitizeText(req.query.success),
      errorMessage: sanitizeText(req.query.error),
      signatureRoute: COORDINADOR_FIRMA_ROUTE,
    });
  } catch (error) {
    console.error('Error cargando firma del coordinador MiLab:', error);
    return res.render('home/prestamos/coordinador/firma', {
      coordinator: null,
      firmaActual: null,
      fechaFirma: null,
      successMessage: '',
      errorMessage: resolveLoanDbErrorMessage(
        error,
        'No fue posible cargar la firma del coordinador.'
      ),
      signatureRoute: COORDINADOR_FIRMA_ROUTE,
    });
  }
});

router.post('/coordinador/firma', requireCoordinatorSignatureAuthorized, async function (req, res) {
  try {
    const sessionUser = req.session?.user;
    const authDocument = sanitizeText(sessionUser?.documento_real || sessionUser?.documento);
    const firmaDigital = sanitizeText(req.body?.firma_digital);

    if (!authDocument) {
      return res.status(401).json({
        success: false,
        message: 'Usuario no autenticado.',
      });
    }

    if (
      !firmaDigital ||
      typeof firmaDigital !== 'string' ||
      !firmaDigital.startsWith('data:image')
    ) {
      return res.status(400).json({
        success: false,
        message: 'La firma digital enviada no es valida.',
      });
    }

    const scope = await resolveCoordinatorScope(pool, authDocument);
    if (!scope.coordinatorDocument) {
      return res.status(404).json({
        success: false,
        message: 'No se encontro el coordinador asociado a la sesion.',
      });
    }

    const result = await pool.query(
      `
        UPDATE coordinador
        SET firma_digital = $1,
            fecha_firma = CURRENT_TIMESTAMP,
            fecha_modificacion = CURRENT_TIMESTAMP
        WHERE documento = $2
        RETURNING documento, firma_digital, fecha_firma
      `,
      [firmaDigital, scope.coordinatorDocument]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: 'No fue posible actualizar la firma del coordinador.',
      });
    }

    return res.json({
      success: true,
      message: 'Firma del coordinador actualizada correctamente.',
      firma: result.rows[0],
    });
  } catch (error) {
    console.error('Error guardando firma del coordinador MiLab:', error);
    return res.status(500).json({
      success: false,
      message: resolveLoanDbErrorMessage(error, 'No fue posible guardar la firma del coordinador.'),
    });
  }
});

router.get('/reportes', requireReportesAuthorized, async function (req, res) {
  try {
    const scope = await resolveLoanManagementScope(req);
    const range = resolveReportDateRange(req.query);

    if (!range.isValid) {
      return res.render('home/prestamos/reportes/index', {
        filters: {
          fecha_inicio: range.defaultFechaInicio,
          fecha_fin: range.defaultFechaFin,
        },
        stats: {
          equipos: 0,
          solicitudes_activas: 0,
          solicitudes_pendientes: 0,
          practicas_activas: 0,
          incidencias_abiertas: 0,
          salas_activas: 0,
        },
        solicitudesPorEstado: [],
        practicasPorEstado: [],
        incidenciasPorEstado: [],
        solicitudesPorMes: [],
        practicasPorMes: [],
        equiposTop: [],
        salasTop: [],
        successMessage: sanitizeText(req.query.success),
        errorMessage:
          sanitizeText(req.query.error) ||
          'La fecha inicial no puede ser posterior a la fecha final.',
      });
    }

    const reportData = await fetchLoanReportsViewData(scope, range);

    return res.render('home/prestamos/reportes/index', {
      ...reportData,
      successMessage: sanitizeText(req.query.success),
      errorMessage: sanitizeText(req.query.error),
    });
  } catch (error) {
    console.error('Error cargando reportes de prestamos MiLab:', error);
    return res.render('home/prestamos/reportes/index', {
      filters: {
        fecha_inicio: getShiftedDateKey(-5),
        fecha_fin: getCurrentDateKey(),
      },
      stats: {
        equipos: 0,
        solicitudes_activas: 0,
        solicitudes_pendientes: 0,
        practicas_activas: 0,
        incidencias_abiertas: 0,
        salas_activas: 0,
      },
      solicitudesPorEstado: [],
      practicasPorEstado: [],
      incidenciasPorEstado: [],
      solicitudesPorMes: [],
      practicasPorMes: [],
      equiposTop: [],
      salasTop: [],
      successMessage: sanitizeText(req.query.success),
      errorMessage: resolveLoanDbErrorMessage(
        error,
        'No fue posible cargar los reportes del modulo.'
      ),
    });
  }
});

router.get('/auditoria', requireAuditoriaAuthorized, async function (req, res) {
  try {
    const result = await pool.query(
      `
        SELECT nombre, documento, fecha_creacion AS fecha_hora, accion, persona
        FROM log
        WHERE accion = ANY($1::text[])
        ORDER BY fecha_creacion DESC
        LIMIT 500
      `,
      [PRESTAMOS_AUDIT_ACTIONS]
    );

    return res.render('home/prestamos/auditoria/index', {
      logs: result.rows || [],
      successMessage: sanitizeText(req.query.success),
      errorMessage: sanitizeText(req.query.error),
    });
  } catch (error) {
    console.error('Error cargando auditoria de prestamos MiLab:', error);
    return res.render('home/prestamos/auditoria/index', {
      logs: [],
      successMessage: '',
      errorMessage: resolveLoanDbErrorMessage(error, 'No fue posible cargar la auditoria.'),
    });
  }
});

router.__private = {
  normalizeDynamicPracticeSchema,
  validateDynamicPracticeSchema,
  validateDynamicPracticeValues,
  buildAcademicPracticePayload,
  validateAcademicPracticePayload,
  normalizePracticeDocumentList,
};

module.exports = router;
