const express = require('express');

const pool = require('../../libs/db');
const {
  findEmailConflict,
  isInstitutionalEmail,
  isUniqueViolation,
  normalizeInstitutionalEmail,
  normalizeLogDocument,
} = require('../../libs/account-email');
const { resolveAcademicFacultyName, resolveCoordinatorScope } = require('../../libs/faculty-scope');
const { getAcademicServicePath, requestOati } = require('../../libs/oati-client');
const { normalizeRoles } = require('../../libs/roles');
const { buildSessionUser, fetchUserById } = require('../../libs/user-identity');
const { requireJsonRoles, requireRoles } = require('../middlewares/auth');
const { renderApplicationError, wantsJson } = require('../middlewares/error-handler');

const router = express.Router();

async function resolveExistingColumn(client, tableName, candidateColumns) {
  const candidates = Array.isArray(candidateColumns) ? candidateColumns : [];
  if (!candidates.length) {
    return null;
  }

  const result = await client.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = ANY (current_schemas(true))
       AND table_name = $1
       AND column_name = ANY($2::text[])
     ORDER BY array_position($2::text[], column_name)
     LIMIT 1`,
    [tableName, candidates]
  );

  return result.rows[0]?.column_name || null;
}

async function resolveDashboardSchemaColumns(client) {
  const ualIdColumn = await resolveExistingColumn(client, 'ual', ['ual_id', 'id_ual']);
  const facultadIdColumn = await resolveExistingColumn(client, 'facultad', [
    'facultad_id',
    'id_facultad',
  ]);
  const multaUalIdColumn = await resolveExistingColumn(client, 'multa', ['ual_id', 'id_ual']);
  const laboratoristaUalIdColumn = await resolveExistingColumn(client, 'laboratorista_ual', [
    'ual_id',
    'id_ual',
  ]);
  const laboratoristaUalDocumentColumn = await resolveExistingColumn(client, 'laboratorista_ual', [
    'laboratorista_documento_id',
    'documento_laboratorista',
  ]);
  const coordinadorFacultadIdColumn = await resolveExistingColumn(client, 'coordinador_facultad', [
    'facultad_id',
    'id_facultad',
  ]);
  const coordinadorFacultadDocumentColumn = await resolveExistingColumn(
    client,
    'coordinador_facultad',
    ['coordinador_documento_id', 'documento_coordinador', 'documento']
  );

  return {
    ualIdColumn,
    facultadIdColumn,
    multaUalIdColumn,
    laboratoristaUalIdColumn,
    laboratoristaUalDocumentColumn,
    coordinadorFacultadIdColumn,
    coordinadorFacultadDocumentColumn,
  };
}

const requireDashboardAccess = requireRoles(['admin', 'coordinador', 'laboratorista'], {
  message: '¡Acceso denegado!',
  message2: 'No tienes permisos para ver el dashboard',
  limit: 'noSession',
});

const requireDashboardAdminJson = requireJsonRoles(['admin'], {
  message: 'No tienes permisos para realizar esta acción.',
});

const CHART_DEFINITIONS = {
  certificadosEstudiantes: {
    id: 'certificadosEstudiantes',
    optionLabel: 'Certificados de estudiantes',
    cardLabel: 'Certificados estudiantes',
    tone: 'tone-students',
    title: 'Certificados de estudiantes',
    summary:
      'Mide la emisión de certificados de estudiantes dentro del alcance disponible para tu rol.',
  },
  certificadosDocentes: {
    id: 'certificadosDocentes',
    optionLabel: 'Certificados de docentes',
    cardLabel: 'Certificados docentes',
    tone: 'tone-teachers',
    title: 'Certificados de docentes',
    summary:
      'Visualiza el comportamiento de los certificados emitidos para docentes en el periodo elegido.',
  },
  estudiantes: {
    id: 'estudiantes',
    optionLabel: 'Estudiantes registrados',
    cardLabel: 'Estudiantes',
    tone: 'tone-students',
    title: 'Estudiantes registrados',
    summary:
      'Perfiles académicos de estudiantes consolidados desde la tabla usuario con rol estudiante activo.',
  },
  docentes: {
    id: 'docentes',
    optionLabel: 'Docentes registrados',
    cardLabel: 'Docentes',
    tone: 'tone-teachers',
    title: 'Docentes registrados',
    summary:
      'Perfiles académicos de docentes consolidados desde la tabla usuario con rol docente activo.',
  },
  sanciones: {
    id: 'sanciones',
    optionLabel: 'Sanciones totales',
    cardLabel: 'Sanciones',
    tone: 'tone-sanctions',
    title: 'Sanciones totales',
    summary:
      'Compara el total de sanciones con sus estados activos y saldados dentro del alcance actual.',
  },
  sancionesActivas: {
    id: 'sancionesActivas',
    optionLabel: 'Sanciones activas',
    cardLabel: 'Sanciones activas',
    tone: 'tone-alert',
    title: 'Sanciones activas',
    summary: 'Enfoca la lectura en los casos que continúan abiertos y requieren seguimiento.',
  },
  sancionesSaldadas: {
    id: 'sancionesSaldadas',
    optionLabel: 'Sanciones saldadas',
    cardLabel: 'Sanciones saldadas',
    tone: 'tone-info',
    title: 'Sanciones saldadas',
    summary: 'Evalúa el ritmo de cierre y normalización de sanciones registradas.',
  },
  laboratoristas: {
    id: 'laboratoristas',
    optionLabel: 'Laboratoristas',
    cardLabel: 'Laboratoristas',
    tone: 'tone-labs',
    title: 'Laboratoristas',
    summary: 'Sigue los perfiles laboratoristas disponibles en el alcance consultado.',
  },
  coordinadores: {
    id: 'coordinadores',
    optionLabel: 'Coordinadores',
    cardLabel: 'Coordinadores',
    tone: 'tone-coords',
    title: 'Coordinadores',
    summary: 'Observa la cobertura de coordinación asociada al alcance consultado.',
  },
  usuariosRegistrados: {
    id: 'usuariosRegistrados',
    optionLabel: 'Usuarios registrados',
    cardLabel: 'Usuarios',
    tone: 'tone-users',
    title: 'Usuarios registrados',
    summary: 'Consolida las cuentas registradas relacionadas con el alcance actual.',
  },
};

function getDashboardRole(user) {
  const roles = normalizeRoles(user?.roles || user?.tipo);
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('coordinador')) return 'coordinador';
  if (roles.includes('laboratorista')) return 'laboratorista';
  return '';
}

function getAvailableChartIds(role) {
  if (role === 'admin') {
    return [
      'certificadosEstudiantes',
      'certificadosDocentes',
      'estudiantes',
      'docentes',
      'sanciones',
      'sancionesActivas',
      'sancionesSaldadas',
      'laboratoristas',
      'coordinadores',
      'usuariosRegistrados',
    ];
  }

  if (role === 'coordinador') {
    return [
      'certificadosEstudiantes',
      'estudiantes',
      'docentes',
      'sanciones',
      'sancionesActivas',
      'sancionesSaldadas',
      'laboratoristas',
      'coordinadores',
      'usuariosRegistrados',
    ];
  }

  return ['sanciones', 'sancionesActivas', 'sancionesSaldadas', 'laboratoristas'];
}

function getStartOfBucket(rawDate, filtro) {
  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) return null;

  if (filtro === 'anio') {
    return new Date(date.getFullYear(), 0, 1);
  }

  if (filtro === 'mes') {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  if (filtro === 'semana') {
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    const day = normalized.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    normalized.setDate(normalized.getDate() + diff);
    return normalized;
  }

  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

function formatBucketLabel(bucketDate, filtro) {
  if (filtro === 'anio') {
    return bucketDate.getFullYear().toString();
  }

  if (filtro === 'mes') {
    return bucketDate.toLocaleDateString('es-CO', {
      year: 'numeric',
      month: '2-digit',
    });
  }

  if (filtro === 'semana') {
    const startOfYear = new Date(bucketDate.getFullYear(), 0, 1);
    const daysFromStart = Math.floor((bucketDate - startOfYear) / (24 * 60 * 60 * 1000));
    const weekNumber = Math.ceil((daysFromStart + startOfYear.getDay() + 1) / 7);
    return `S${weekNumber}/${bucketDate.getFullYear()}`;
  }

  return bucketDate.toLocaleDateString('es-CO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function buildSeriesFromDates(rawDates, filtro) {
  const buckets = new Map();

  rawDates.forEach((rawDate) => {
    const bucketDate = getStartOfBucket(rawDate, filtro);
    if (!bucketDate) return;

    const bucketKey = bucketDate.getTime();
    buckets.set(bucketKey, (buckets.get(bucketKey) || 0) + 1);
  });

  const sortedKeys = Array.from(buckets.keys()).sort((a, b) => a - b);
  return {
    labels: sortedKeys.map((key) => formatBucketLabel(new Date(Number(key)), filtro)),
    data: sortedKeys.map((key) => buckets.get(key)),
  };
}

function totalFromSeries(series) {
  return (series?.data || []).reduce((sum, value) => sum + Number(value || 0), 0);
}

async function resolveLaboratoristaScope(client, authDocument) {
  const columns = await resolveDashboardSchemaColumns(client);
  if (
    !columns.ualIdColumn ||
    !columns.facultadIdColumn ||
    !columns.laboratoristaUalIdColumn ||
    !columns.laboratoristaUalDocumentColumn
  ) {
    return {
      laboratoristaDocument: null,
      ualIds: [],
      facultyIds: [],
      ualNames: [],
      facultyNames: [],
    };
  }

  const laboratoristaRes = await client.query(
    'SELECT documento FROM laboratorista WHERE documento = $1 OR n_usuario = $1 LIMIT 1',
    [authDocument]
  );

  if (!laboratoristaRes.rows.length) {
    return {
      laboratoristaDocument: null,
      ualIds: [],
      facultyIds: [],
      ualNames: [],
      facultyNames: [],
    };
  }

  const laboratorista = laboratoristaRes.rows[0];
  const assignedUalsRes = await client.query(
    `SELECT ${columns.laboratoristaUalIdColumn} AS ual_id
     FROM laboratorista_ual
     WHERE ${columns.laboratoristaUalDocumentColumn} = $1
     ORDER BY ${columns.laboratoristaUalIdColumn} ASC`,
    [laboratorista.documento]
  );

  const ualIds = assignedUalsRes.rows.map((row) => Number(row.ual_id)).filter(Boolean);

  let ualNames = [];
  let facultyIds = [];
  let facultyNames = [];

  if (ualIds.length) {
    const ualInfoRes = await client.query(
      `SELECT ${columns.ualIdColumn} AS ual_id,
              nombre,
              ${columns.facultadIdColumn} AS facultad_id
       FROM ual
       WHERE ${columns.ualIdColumn} = ANY($1::int[])
       ORDER BY nombre ASC`,
      [ualIds]
    );
    ualNames = ualInfoRes.rows.map((row) => row.nombre).filter(Boolean);
    facultyIds = [
      ...new Set(ualInfoRes.rows.map((row) => Number(row.facultad_id)).filter(Boolean)),
    ];
  }

  if (facultyIds.length) {
    const facultyInfoRes = await client.query(
      `SELECT nombre
       FROM facultad
       WHERE ${columns.facultadIdColumn} = ANY($1::int[])
       ORDER BY nombre ASC`,
      [facultyIds]
    );
    facultyNames = facultyInfoRes.rows.map((row) => row.nombre).filter(Boolean);
  }

  return {
    laboratoristaDocument: laboratorista.documento,
    ualIds: [...new Set(ualIds)],
    facultyIds: [...new Set(facultyIds)],
    ualNames: [...new Set(ualNames)],
    facultyNames: [...new Set(facultyNames)],
  };
}

function buildScopePresentation(role, scope) {
  if (role === 'admin') {
    return {
      badge: 'Vista global',
      title: 'Monitoreo plataforma',
      subtitle:
        'Estadísticas generales del sistema con capacidad de filtrar todos los indicadores disponibles.',
      chips: ['Toda la plataforma'],
    };
  }

  if (role === 'coordinador') {
    return {
      badge: 'Vista por facultad',
      title: 'Monitoreo de facultades asignadas',
      subtitle:
        'La información se limita a las facultades asociadas al coordinador y a los registros derivados de ese alcance.',
      chips: scope.facultyNames.length ? scope.facultyNames : ['Sin facultades asignadas'],
    };
  }

  return {
    badge: 'Vista por laboratorio',
    title: 'Monitoreo de laboratorios asignados',
    subtitle:
      'La información se limita a los laboratorios asignados al laboratorista y a los eventos vinculados a esas UAL.',
    chips: scope.ualNames.length ? scope.ualNames : ['Sin laboratorios asignados'],
  };
}

async function fetchStudentCertificateRows() {
  const result = await pool.query(
    `SELECT ce.*
     FROM certificado_estudiante ce
     WHERE ce.fecha_creacion IS NOT NULL
     ORDER BY ce.fecha_creacion DESC
     LIMIT 300`
  );
  return result.rows;
}

async function fetchTeacherCertificateRows() {
  const result = await pool.query(
    `SELECT cd.*
     FROM certificado_docente cd
     WHERE cd.fecha_creacion IS NOT NULL
     ORDER BY cd.fecha_creacion DESC
     LIMIT 300`
  );
  return result.rows;
}

async function fetchSanctionRows() {
  const result = await pool.query(
    `SELECT m.*
     FROM multa m
     WHERE m.fecha_multa IS NOT NULL
     ORDER BY m.fecha_multa DESC
     LIMIT 500`
  );
  return result.rows;
}

async function fetchLaboratoristaRows() {
  const result = await pool.query(
    `SELECT
       l.fecha_creacion,
       l.nombre,
       l.documento,
       l.n_usuario,
       l.correo,
       l.contrato,
       l.usuario_id,
       l.activo,
       ARRAY_REMOVE(ARRAY_AGG(DISTINCT u.ual_id), NULL) AS ual_ids,
       ARRAY_REMOVE(ARRAY_AGG(DISTINCT u.facultad_id), NULL) AS faculty_ids
     FROM laboratorista l
     LEFT JOIN laboratorista_ual lu
       ON lu.laboratorista_documento_id = l.documento
      AND (lu.activo IS DISTINCT FROM FALSE)
     LEFT JOIN ual u
       ON u.ual_id = lu.ual_id
      AND u.activo = TRUE
     GROUP BY
       l.fecha_creacion,
       l.nombre,
       l.documento,
       l.n_usuario,
       l.correo,
       l.contrato,
       l.usuario_id,
       l.activo
     ORDER BY l.fecha_creacion DESC NULLS LAST
     LIMIT 300`
  );
  return result.rows;
}

async function fetchCoordinatorRows() {
  const result = await pool.query(
    `SELECT
       c.fecha_creacion,
       c.nombre,
       c.documento,
       c.correo,
       c.numero_resolucion_coordinador,
       c.soporte_resolucion,
       c.nombre_u,
       c.usuario_id,
       ARRAY_REMOVE(ARRAY_AGG(DISTINCT cf.facultad_id), NULL) AS faculty_ids
     FROM coordinador c
     LEFT JOIN coordinador_facultad cf
       ON cf.coordinador_documento_id = c.documento
     GROUP BY
       c.fecha_creacion,
       c.nombre,
       c.documento,
       c.correo,
       c.numero_resolucion_coordinador,
       c.soporte_resolucion,
       c.nombre_u,
       c.usuario_id
     ORDER BY c.fecha_creacion DESC NULLS LAST
     LIMIT 300`
  );
  return result.rows;
}

async function fetchUsuarioRows() {
  const result = await pool.query(
    `WITH usuarios_base AS (
       SELECT
         u.id,
         COALESCE(NULLIF(TRIM(u.documento), ''), CONCAT('usuario:', u.id::text)) AS identity_key,
         u.fecha_creacion,
         u.nombre,
         u.documento,
         u.codigo::text AS codigo,
         u.correo,
         u.carrera,
         COALESCE(NULLIF(TRIM(u.estado), ''), 'ACTIVO') AS estado
       FROM usuario u
       WHERE EXISTS (
         SELECT 1
         FROM usuario_rol ur
         JOIN rol r ON r.id = ur.rol_id
         WHERE ur.usuario_id = u.id
           AND ur.activo = TRUE
           AND r.nombre IN ('admin', 'estudiante', 'docente')
       )
     ),
     coordinadores_base AS (
       SELECT
         c.usuario_id AS id,
         COALESCE(
           NULLIF(TRIM(c.documento), ''),
           NULLIF(TRIM(c.correo), ''),
           CONCAT('coordinador:', COALESCE(NULLIF(TRIM(c.nombre_u), ''), c.documento))
         ) AS identity_key,
         c.fecha_creacion,
         c.nombre,
         c.documento,
         NULL::text AS codigo,
         c.correo,
         NULL::text AS carrera,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT cf.facultad_id), NULL) AS faculty_ids,
         ARRAY[]::int[] AS ual_ids,
         CASE
           WHEN COALESCE(role_state.activo, FALSE) THEN 'ACTIVO'
           ELSE 'INACTIVO'
         END AS estado
       FROM coordinador c
       JOIN coordinador_facultad cf ON cf.coordinador_documento_id = c.documento
       LEFT JOIN usuario u
         ON u.id = c.usuario_id
         OR u.documento = c.documento
         OR (c.nombre_u IS NOT NULL AND u.documento = c.nombre_u)
         OR (c.correo IS NOT NULL AND LOWER(u.correo) = LOWER(c.correo))
       LEFT JOIN LATERAL (
         SELECT ur.activo
         FROM usuario_rol ur
         JOIN rol r ON r.id = ur.rol_id
         WHERE ur.usuario_id = u.id
           AND r.nombre = 'coordinador'
         LIMIT 1
       ) role_state ON true
       GROUP BY
         c.usuario_id,
         c.fecha_creacion,
         c.nombre,
         c.documento,
         c.correo,
         c.nombre_u,
         role_state.activo
     ),
     laboratoristas_base AS (
       SELECT
         l.usuario_id AS id,
         COALESCE(
           NULLIF(TRIM(l.documento), ''),
           NULLIF(TRIM(l.correo), ''),
           NULLIF(TRIM(l.n_usuario), ''),
           CONCAT('laboratorista:', NULLIF(TRIM(l.nombre), ''))
         ) AS identity_key,
         l.fecha_creacion,
         l.nombre,
         l.documento,
         NULL::text AS codigo,
         l.correo,
         NULL::text AS carrera,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT u.facultad_id), NULL) AS faculty_ids,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT u.ual_id), NULL) AS ual_ids,
         CASE
           WHEN COALESCE(l.activo, FALSE) THEN 'ACTIVO'
           ELSE 'INACTIVO'
         END AS estado
       FROM laboratorista l
       LEFT JOIN laboratorista_ual lu
         ON lu.laboratorista_documento_id = l.documento
        AND (lu.activo IS DISTINCT FROM FALSE)
       LEFT JOIN ual u
         ON u.ual_id = lu.ual_id
        AND u.activo = TRUE
       GROUP BY
         l.usuario_id,
         l.fecha_creacion,
         l.nombre,
         l.documento,
         l.correo,
         l.n_usuario,
         l.activo
     ),
     usuarios_consolidados AS (
       SELECT
         id,
         identity_key,
         fecha_creacion,
         nombre,
         documento,
         codigo,
         correo,
         carrera,
         ARRAY[]::int[] AS faculty_ids,
         ARRAY[]::int[] AS ual_ids,
         estado
       FROM usuarios_base
       UNION ALL
       SELECT * FROM coordinadores_base
       UNION ALL
       SELECT * FROM laboratoristas_base
     ),
     usuarios_ranked AS (
       SELECT
         id,
         fecha_creacion,
         nombre,
         documento,
         codigo,
         correo,
         carrera,
         faculty_ids,
         ual_ids,
         estado,
         ROW_NUMBER() OVER (
           PARTITION BY identity_key
           ORDER BY fecha_creacion DESC NULLS LAST
         ) AS identity_rank
       FROM usuarios_consolidados
     )
     SELECT
       id,
       fecha_creacion,
       nombre,
       documento,
       codigo,
       correo,
       carrera,
       faculty_ids,
       ual_ids,
       estado
     FROM usuarios_ranked
     WHERE identity_rank = 1
     ORDER BY fecha_creacion DESC NULLS LAST
     LIMIT 500`
  );
  return result.rows;
}

async function fetchUsuariosRegistradosRows() {
  const result = await pool.query(
    `SELECT u.*
     FROM usuario u
     WHERE u.correo IS NOT NULL
       AND TRIM(u.correo) <> ''
       AND LOWER(u.correo) NOT LIKE '%no-email%'
     ORDER BY u.fecha_creacion DESC NULLS LAST, u.id DESC`
  );

  return {
    rows: result.rows || [],
    columns: Array.isArray(result.fields) ? result.fields.map((field) => field.name) : [],
  };
}

async function fetchUsuariosPlaceholderRows() {
  const result = await pool.query(
    `SELECT u.*
     FROM usuario u
     WHERE u.correo IS NULL
        OR TRIM(COALESCE(u.correo, '')) = ''
        OR LOWER(u.correo) LIKE '%no-email%'
        OR LOWER(u.correo) LIKE '%@placeholder.milab.local'
     ORDER BY u.fecha_creacion DESC NULLS LAST, u.id DESC`
  );

  return result.rows || [];
}

async function fetchUsuarioRolesRows() {
  const result = await pool.query(
    `SELECT ur.usuario_id, r.nombre AS rol_nombre
     FROM usuario_rol ur
     JOIN rol r ON r.id = ur.rol_id
     WHERE ur.activo = TRUE`
  );
  return result.rows;
}

function buildUsuarioRoleIndex(roleRows) {
  const index = new Map();
  for (const row of roleRows) {
    const key = Number(row.usuario_id);
    if (!Number.isFinite(key)) continue;
    const set = index.get(key) || new Set();
    set.add(
      String(row.rol_nombre || '')
        .trim()
        .toLowerCase()
    );
    index.set(key, set);
  }
  return index;
}

function isUsuarioEstudiante(usuarioRow, roleIndex) {
  const usuarioId = Number(usuarioRow?.id);
  if (!Number.isFinite(usuarioId)) return false;
  const roles = roleIndex.get(usuarioId);
  return !!(roles && roles.has('estudiante'));
}

function isUsuarioDocente(usuarioRow, roleIndex) {
  const usuarioId = Number(usuarioRow?.id);
  if (!Number.isFinite(usuarioId)) return false;
  const roles = roleIndex.get(usuarioId);
  return !!(roles && roles.has('docente'));
}

function filterStudentRowsByScope(rows, role, scope) {
  if (role === 'admin') {
    return rows;
  }

  const facultyNamesSet = new Set(
    (scope.facultyNames || []).map((name) => String(name || '').trim())
  );
  return rows.filter((row) => facultyNamesSet.has(resolveAcademicFacultyName(row.carrera || '')));
}

function filterSanctionRowsByScope(rows, role, scope) {
  if (role === 'admin') {
    return rows;
  }

  if (role === 'coordinador') {
    const facultyIds = new Set(scope.facultyIds || []);
    return rows.filter((row) => {
      const fid = Number(row.facultad_id || row.faculty_id);
      if (Number.isFinite(fid)) return facultyIds.has(fid);
      return false;
    });
  }

  const ualIds = new Set(scope.ualIds || []);
  return rows.filter((row) => {
    const uid = Number(row.ual_id || row.id_ual);
    if (Number.isFinite(uid)) return ualIds.has(uid);
    return false;
  });
}

function toNumericSet(values) {
  return new Set((values || []).map((value) => Number(value)).filter(Number.isInteger));
}

function hasIntersection(leftValues, rightSet) {
  return (leftValues || [])
    .map((value) => Number(value))
    .some((value) => Number.isInteger(value) && rightSet.has(value));
}

function filterLaboratoristaRowsByScope(rows, role, scope) {
  if (role === 'admin') {
    return rows;
  }

  if (role === 'coordinador') {
    const facultyIds = toNumericSet(scope.facultyIds);
    return rows.filter((row) => hasIntersection(row.faculty_ids, facultyIds));
  }

  if (role === 'laboratorista') {
    const scopeUalIds = toNumericSet(scope.ualIds);
    return rows.filter((row) => hasIntersection(row.ual_ids, scopeUalIds));
  }

  return [];
}

function filterCoordinatorRowsByScope(rows, role, scope) {
  if (role === 'admin') {
    return rows;
  }

  if (role !== 'coordinador') {
    return [];
  }

  const facultyIds = toNumericSet(scope.facultyIds);
  return rows.filter((row) => hasIntersection(row.faculty_ids, facultyIds));
}

function filterUsuarioRowsByScope(rows, role, scope) {
  if (role === 'admin') {
    return rows;
  }

  if (role === 'coordinador') {
    const facultyNamesSet = new Set(
      (scope.facultyNames || []).map((name) => String(name || '').trim())
    );
    const facultyIds = toNumericSet(scope.facultyIds);
    return rows.filter((row) => {
      const resolvedFacultyName = resolveAcademicFacultyName(row.carrera || '');
      if (resolvedFacultyName && facultyNamesSet.has(resolvedFacultyName)) {
        return true;
      }

      return hasIntersection(row.faculty_ids, facultyIds);
    });
  }

  if (role === 'laboratorista') {
    const scopeUalIds = toNumericSet(scope.ualIds);
    return rows.filter((row) => hasIntersection(row.ual_ids, scopeUalIds));
  }

  return [];
}

async function writeDashboardAuditLog(actor, accion, persona) {
  const actorDocument = normalizeLogDocument(actor?.documento || actor?.documento_real || '');
  await pool.query('INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)', [
    actor?.tipo || 'admin',
    actorDocument,
    accion,
    persona || null,
  ]);
}

function normalizeEmail(value) {
  return (value || '').toString().trim().toLowerCase();
}

function resolveOatiEmail(payload) {
  return normalizeEmail(
    payload?.correo ||
      payload?.email ||
      payload?.correo_institucional ||
      payload?.email_institucional ||
      payload?.correoInstitucional ||
      payload?.emailInstitucional ||
      ''
  );
}

async function lookupEnrollmentStudentData(documento) {
  try {
    const studentData = await requestOati(
      getAcademicServicePath(`datos_basicos_activos_cedula/${documento}`)
    );
    const rawCollection = studentData?.datosEstudianteCollection?.datosBasicosEstudiante;
    const collection = Array.isArray(rawCollection)
      ? rawCollection
      : rawCollection
        ? [rawCollection]
        : [];

    if (!collection.length) return null;

    const item = collection[collection.length - 1] || {};
    const estadoCodigo = String(item.estado || '').trim();
    const carreraCodigo = String(item.carrera || '').trim();

    let estadoNombre = estadoCodigo;
    let carreraNombre = '';

    if (estadoCodigo) {
      try {
        const estadoData = await requestOati(
          getAcademicServicePath(`estados_codigo/${estadoCodigo}`)
        );
        estadoNombre = estadoData?.estado?.nombre || estadoCodigo;
      } catch {
        estadoNombre = estadoCodigo;
      }
    }

    if (carreraCodigo) {
      try {
        const carreraData = await requestOati(getAcademicServicePath(`carrera/${carreraCodigo}`));
        carreraNombre =
          carreraData?.carrerasCollection?.carrera?.[0]?.nombre ||
          carreraData?.carrerasCollection?.carrera?.nombre ||
          '';
      } catch {
        carreraNombre = '';
      }
    }

    return {
      nombre: String(item.nombre || '').trim(),
      correo: resolveOatiEmail(item),
      codigo: item.codigo ? String(item.codigo).trim() : null,
      estado: String(estadoNombre || '').trim() || 'ACTIVO',
      carrera: String(carreraNombre || '').trim() || null,
    };
  } catch {
    return null;
  }
}

async function lookupEnrollmentTeacherData(documento) {
  try {
    const teacherData = await requestOati(
      getAcademicServicePath(`consultar_estado_docente/${documento}`)
    );
    const rawDocente = teacherData?.docentesCollection?.docente;
    const docente = Array.isArray(rawDocente) ? rawDocente[0] : rawDocente;

    if (!docente) return null;

    return {
      nombre: String(docente.nombre || '').trim(),
      correo: resolveOatiEmail(docente),
      codigo: null,
      estado: String(docente.estado_docente || '').trim() || 'ACTIVO',
      carrera: null,
    };
  } catch {
    return null;
  }
}

async function enrollUserFromDashboardEdit(client, target, tipoUsuario, correo) {
  const normalizedType = String(tipoUsuario || '')
    .trim()
    .toLowerCase();
  const documento = String(target?.documento || '').trim();

  if (!documento) {
    throw new Error('El usuario no tiene documento para completar el enrolamiento.');
  }

  const enrollmentData =
    normalizedType === 'estudiante'
      ? await lookupEnrollmentStudentData(documento)
      : await lookupEnrollmentTeacherData(documento);

  const resolvedNombre =
    String(enrollmentData?.nombre || target?.nombre || '').trim() || 'Sin nombre';
  const resolvedEstado =
    String(enrollmentData?.estado || target?.estado || 'ACTIVO').trim() || 'ACTIVO';
  const resolvedCodigo =
    normalizedType === 'estudiante'
      ? String(enrollmentData?.codigo || target?.codigo || '').trim() || null
      : null;
  const resolvedCarrera =
    normalizedType === 'estudiante'
      ? String(enrollmentData?.carrera || target?.carrera || '').trim() || null
      : null;

  await client.query(
    `UPDATE usuario
     SET nombre = $1,
         correo = $2,
         estado = $3,
         codigo = $4,
         carrera = $5,
         fecha_modificacion = CURRENT_TIMESTAMP
     WHERE id = $6`,
    [resolvedNombre, correo, resolvedEstado, resolvedCodigo, resolvedCarrera, Number(target.id)]
  );

  await client.query(
    `INSERT INTO usuario_rol (usuario_id, rol_id)
     SELECT $1, id
     FROM rol
     WHERE nombre = $2
     ON CONFLICT (usuario_id, rol_id) DO UPDATE
     SET activo = TRUE,
         fecha_modificacion = CURRENT_TIMESTAMP`,
    [Number(target.id), normalizedType]
  );

  if (normalizedType === 'estudiante') {
    await client.query(
      `INSERT INTO perfil_estudiante (usuario_id, documento, codigo, programa, estado)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (usuario_id) DO UPDATE
       SET documento = EXCLUDED.documento,
           codigo = EXCLUDED.codigo,
           programa = EXCLUDED.programa,
           estado = EXCLUDED.estado,
           fecha_modificacion = CURRENT_TIMESTAMP`,
      [Number(target.id), documento, resolvedCodigo, resolvedCarrera, resolvedEstado]
    );
  }

  if (normalizedType === 'docente') {
    await client.query(
      `INSERT INTO perfil_docente (usuario_id, documento, estado)
       VALUES ($1, $2, $3)
       ON CONFLICT (usuario_id) DO UPDATE
       SET documento = EXCLUDED.documento,
           estado = EXCLUDED.estado,
           fecha_modificacion = CURRENT_TIMESTAMP`,
      [Number(target.id), documento, resolvedEstado]
    );
  }
}

router.post('/usuarios/:id/correo', requireDashboardAdminJson, async (req, res) => {
  const usuarioId = Number(req.params.id);
  const correo = normalizeInstitutionalEmail(req.body?.correo);
  const tipoUsuario = String(req.body?.tipoUsuario || '')
    .trim()
    .toLowerCase();

  if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
    return res.status(400).json({
      ok: false,
      message: 'Debes indicar un ID de usuario valido.',
    });
  }

  if (!isInstitutionalEmail(correo)) {
    return res.status(400).json({
      ok: false,
      message: 'Solo se permiten correos institucionales @udistrital.edu.co.',
    });
  }

  if (!['estudiante', 'docente'].includes(tipoUsuario)) {
    return res.status(400).json({
      ok: false,
      message: 'Debes confirmar si la cuenta se debe enrolar como estudiante o docente.',
    });
  }

  let client;
  try {
    client = await pool.connect();
    const userResult = await client.query(
      'SELECT id, documento, correo, nombre, codigo, carrera, estado FROM usuario WHERE id = $1 LIMIT 1',
      [usuarioId]
    );

    if (!userResult.rows.length) {
      client.release();
      return res.status(404).json({
        ok: false,
        message: 'No encontramos la cuenta seleccionada.',
      });
    }

    const target = userResult.rows[0];
    const conflict = await findEmailConflict(client, correo, target.documento);
    if (conflict) {
      client.release();
      return res.status(409).json({
        ok: false,
        message: 'Ese correo ya existe vinculado a otra cuenta.',
      });
    }

    await client.query('BEGIN');
    await enrollUserFromDashboardEdit(client, target, tipoUsuario, correo);
    await client.query(
      'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
      [
        req.session?.user?.tipo || 'admin',
        normalizeLogDocument(
          req.session?.user?.documento || req.session?.user?.documento_real || ''
        ),
        `Actualizar correo y enrolar como ${tipoUsuario} desde dashboard`,
        String(target.documento || usuarioId),
      ]
    );
    await client.query('COMMIT');
    client.release();

    return res.json({
      ok: true,
      id: usuarioId,
      documento: target.documento,
      correo,
      tipoUsuario,
    });
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error al revertir actualización de correo:', rollbackError);
      }
      client.release();
    }

    console.error('Error actualizando correo de usuario desde dashboard:', error);

    if (isUniqueViolation(error)) {
      return res.status(409).json({
        ok: false,
        message: 'Ese correo ya existe vinculado a otra cuenta.',
      });
    }

    return res.status(500).json({
      ok: false,
      message: 'No fue posible actualizar el correo. Inténtalo nuevamente.',
    });
  }
});

router.post('/impersonacion/iniciar', requireDashboardAdminJson, async (req, res) => {
  const usuarioId = Number(req.body?.usuarioId);
  if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
    return res.status(400).json({
      ok: false,
      message: 'Debes indicar un usuario válido para impersonar.',
    });
  }

  if (req.session?.impersonationAdminUser) {
    return res.status(409).json({
      ok: false,
      message: 'Ya tienes una sesión impersonada activa.',
    });
  }

  try {
    const target = await fetchUserById(usuarioId);
    if (!target) {
      return res.status(404).json({
        ok: false,
        message: 'No encontramos el usuario seleccionado.',
      });
    }

    const targetRoles = normalizeRoles(target.roles || target.tipo);
    if (targetRoles.includes('admin')) {
      return res.status(403).json({
        ok: false,
        message: 'No se permite impersonar cuentas administrativas.',
      });
    }

    const impersonableRoles = targetRoles.filter(
      (role) =>
        role === 'estudiante' ||
        role === 'docente' ||
        role === 'coordinador' ||
        role === 'laboratorista' ||
        role === 'monitor'
    );

    if (!impersonableRoles.length) {
      return res.status(409).json({
        ok: false,
        message:
          'La cuenta seleccionada no tiene roles activos para ingresar. Asigna un rol (estudiante/docente) y vuelve a intentar.',
      });
    }

    req.session.impersonationAdminUser = { ...req.session.user };
    req.session.user = {
      ...buildSessionUser(target),
      __impersonating: true,
      __impersonatedBy: req.session.impersonationAdminUser?.documento || '',
    };

    await writeDashboardAuditLog(
      req.session.impersonationAdminUser,
      'Inicio impersonación desde dashboard',
      target.documento || String(usuarioId)
    );

    return res.json({
      ok: true,
      redirect: '/milab/inicio',
    });
  } catch (error) {
    console.error('Error iniciando impersonación:', error);
    return res.status(500).json({
      ok: false,
      message: 'No fue posible iniciar la impersonación.',
    });
  }
});

router.post(
  '/impersonacion/detener',
  requireRoles(['admin', 'coordinador', 'laboratorista', 'docente', 'estudiante'], {
    message: '¡Acceso denegado!',
    message2: 'No tienes permisos para realizar esta acción',
    limit: 'noSession',
  }),
  async (req, res) => {
    const adminUser = req.session?.impersonationAdminUser;
    if (!adminUser) {
      return res.redirect('/milab/inicio');
    }

    try {
      const currentUser = req.session?.user;
      req.session.user = adminUser;
      delete req.session.impersonationAdminUser;

      await writeDashboardAuditLog(
        adminUser,
        'Fin impersonación desde dashboard',
        currentUser?.documento || currentUser?.id || null
      );
    } catch (error) {
      console.error('Error cerrando impersonación:', error);
    }

    return res.redirect('/milab/api/dashboard');
  }
);

router.get('/', requireDashboardAccess, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const filtro = ['dia', 'semana', 'mes', 'anio'].includes(req.query.filtro)
    ? req.query.filtro
    : 'dia';
  const requestedChart = typeof req.query.grafico === 'string' ? req.query.grafico.trim() : '';
  const dashboardRole = getDashboardRole(req.session?.user);

  let labelFormat = 'Día';
  if (filtro === 'semana') labelFormat = 'Semana';
  if (filtro === 'mes') labelFormat = 'Mes';
  if (filtro === 'anio') labelFormat = 'Año';

  let client;
  try {
    client = await pool.connect();
    const columns = await resolveDashboardSchemaColumns(client);

    let scope = {
      facultyIds: [],
      facultyNames: [],
      ualIds: [],
      ualNames: [],
    };

    if (dashboardRole === 'coordinador') {
      const coordinatorScope = await resolveCoordinatorScope(client, req.session.user.documento);
      scope.coordinatorDocument = coordinatorScope.coordinatorDocument || null;
      scope.facultyIds = coordinatorScope.facultyIds || [];

      if (!coordinatorScope.coordinatorDocument || scope.facultyIds.length === 0) {
        return res.render('home/message_error', {
          message: 'No tienes alcance para monitoreo.',
          message2: 'El coordinador no tiene facultades asociadas.',
          limit: null,
        });
      }

      if (!columns.facultadIdColumn) {
        return res.render('home/message_error', {
          message: 'No fue posible cargar el dashboard.',
          message2: 'No se pudo determinar la estructura de facultades.',
          limit: null,
        });
      }

      const facultiesRes = await client.query(
        `SELECT nombre
         FROM facultad
         WHERE ${columns.facultadIdColumn} = ANY($1::int[])
         ORDER BY nombre ASC`,
        [scope.facultyIds]
      );
      scope.facultyNames = facultiesRes.rows.map((row) => row.nombre).filter(Boolean);
    }

    if (dashboardRole === 'laboratorista') {
      scope = await resolveLaboratoristaScope(client, req.session.user.documento);

      if (!scope.laboratoristaDocument || scope.ualIds.length === 0) {
        return res.render('home/message_error', {
          message: 'No tienes alcance para monitoreo.',
          message2: 'El laboratorista no tiene laboratorios asignados.',
          limit: null,
        });
      }
    }

    const availableChartIds = getAvailableChartIds(dashboardRole);
    const selectedChart = availableChartIds.includes(requestedChart)
      ? requestedChart
      : availableChartIds[0];

    const needsUsuariosByRole =
      availableChartIds.includes('estudiantes') || availableChartIds.includes('docentes');
    const needsUsuariosRegistrados = availableChartIds.includes('usuariosRegistrados');

    const studentCertRows = availableChartIds.includes('certificadosEstudiantes')
      ? await fetchStudentCertificateRows()
      : [];
    const teacherCertRows = availableChartIds.includes('certificadosDocentes')
      ? await fetchTeacherCertificateRows()
      : [];
    const sanctionRows = await fetchSanctionRows();
    const laboratoristaRows = await fetchLaboratoristaRows();
    const coordinatorRows = availableChartIds.includes('coordinadores')
      ? await fetchCoordinatorRows()
      : [];
    const usuarioRows = needsUsuariosByRole ? await fetchUsuarioRows() : [];
    const usuarioRolesRows = needsUsuariosByRole ? await fetchUsuarioRolesRows() : [];
    const usuariosRegistradosResult =
      needsUsuariosRegistrados && dashboardRole === 'admin'
        ? await fetchUsuariosRegistradosRows()
        : { rows: [], columns: [] };
    const usuariosPlaceholderRows =
      needsUsuariosRegistrados && dashboardRole === 'admin'
        ? await fetchUsuariosPlaceholderRows()
        : [];
    const roleIndex = buildUsuarioRoleIndex(usuarioRolesRows);

    const filteredStudentCerts = filterStudentRowsByScope(studentCertRows, dashboardRole, scope);
    const filteredTeacherCerts = teacherCertRows;
    const filteredSanctions = filterSanctionRowsByScope(sanctionRows, dashboardRole, scope);
    const filteredLaboratoristas = filterLaboratoristaRowsByScope(
      laboratoristaRows,
      dashboardRole,
      scope
    );
    const filteredCoordinators = filterCoordinatorRowsByScope(
      coordinatorRows,
      dashboardRole,
      scope
    );
    const filteredUsuarios = filterUsuarioRowsByScope(usuarioRows, dashboardRole, scope);
    const usuariosRegistradosRows =
      dashboardRole === 'admin' ? usuariosRegistradosResult.rows : filteredUsuarios;
    const usuariosRegistradosColumns =
      dashboardRole === 'admin' ? usuariosRegistradosResult.columns : [];
    const filteredEstudiantes = filteredUsuarios
      .filter((row) => isUsuarioEstudiante(row, roleIndex))
      .map((row) => ({ ...row, __tipo: 'estudiante' }));
    const filteredDocentes = filteredUsuarios
      .filter((row) => isUsuarioDocente(row, roleIndex))
      .map((row) => ({ ...row, __tipo: 'docente' }));

    const chartsData = {
      certificadosEstudiantes: buildSeriesFromDates(
        filteredStudentCerts.map((row) => row.fecha_creacion),
        filtro
      ),
      certificadosDocentes: buildSeriesFromDates(
        filteredTeacherCerts.map((row) => row.fecha_creacion),
        filtro
      ),
      estudiantes: buildSeriesFromDates(
        filteredEstudiantes.map((row) => row.fecha_creacion),
        filtro
      ),
      docentes: buildSeriesFromDates(
        filteredDocentes.map((row) => row.fecha_creacion),
        filtro
      ),
      multas: buildSeriesFromDates(
        filteredSanctions.map((row) => row.fecha_multa),
        filtro
      ),
      multasActivas: buildSeriesFromDates(
        filteredSanctions
          .filter((row) => String(row.con_estado_multa || '').toUpperCase() === 'ACTIVA')
          .map((row) => row.fecha_multa),
        filtro
      ),
      multasSaldadas: buildSeriesFromDates(
        filteredSanctions
          .filter((row) =>
            ['SALDADA', 'SALDADO'].includes(String(row.con_estado_multa || '').toUpperCase())
          )
          .map((row) => row.fecha_multa),
        filtro
      ),
      laboratoristas: buildSeriesFromDates(
        filteredLaboratoristas.map((row) => row.fecha_creacion),
        filtro
      ),
      coordinadores: buildSeriesFromDates(
        filteredCoordinators.map((row) => row.fecha_creacion),
        filtro
      ),
      usuariosRegistrados: buildSeriesFromDates(
        usuariosRegistradosRows.map((row) => row.fecha_creacion),
        filtro
      ),
    };

    const availableCharts = availableChartIds.map((chartId) => {
      let series = chartsData[chartId];

      if (chartId === 'sanciones') {
        series = chartsData.multas;
      } else if (chartId === 'sancionesActivas') {
        series = chartsData.multasActivas;
      } else if (chartId === 'sancionesSaldadas') {
        series = chartsData.multasSaldadas;
      }

      if (chartId === 'usuariosRegistrados') {
        return {
          ...CHART_DEFINITIONS[chartId],
          total: usuariosRegistradosRows.length,
        };
      }

      return {
        ...CHART_DEFINITIONS[chartId],
        total: totalFromSeries(series),
      };
    });

    const scopePresentation = buildScopePresentation(dashboardRole, scope);
    let scopeCounter = { label: 'Laboratorios', value: String(scope.ualIds.length) };

    if (dashboardRole === 'admin') {
      scopeCounter = { label: 'Cobertura', value: 'General' };
    } else if (dashboardRole === 'coordinador') {
      scopeCounter = { label: 'Facultades', value: String(scope.facultyIds.length) };
    }

    const scopeCounters = [
      scopeCounter,
      { label: 'Indicadores', value: String(availableCharts.length) },
      { label: 'Sanciones visibles', value: String(totalFromSeries(chartsData.multas)) },
    ];

    const tablesData = {
      certificadosEstudiantes: filteredStudentCerts,
      certificadosDocentes: filteredTeacherCerts,
      estudiantes: filteredEstudiantes,
      docentes: filteredDocentes,
      sanciones: filteredSanctions,
      sancionesActivas: filteredSanctions.filter(
        (row) => String(row.con_estado_multa || '').toUpperCase() === 'ACTIVA'
      ),
      sancionesSaldadas: filteredSanctions.filter((row) =>
        ['SALDADA', 'SALDADO'].includes(String(row.con_estado_multa || '').toUpperCase())
      ),
      laboratoristas: filteredLaboratoristas,
      coordinadores: filteredCoordinators,
      usuariosRegistrados: usuariosRegistradosRows,
      usuariosPlaceholder: usuariosPlaceholderRows,
    };

    return res.render('home/dashboard', {
      filtro,
      labelFormat,
      selectedChart,
      availableCharts,
      dashboardRole,
      scopePresentation,
      scopeCounters,
      chartsData,
      tablesData,
      usuarioTableColumns: usuariosRegistradosColumns,
    });
  } catch (error) {
    console.error('Error en dashboard:', error);

    if (wantsJson(req)) {
      return res.status(500).json({
        ok: false,
        message: 'No fue posible cargar el dashboard.',
        message2: 'Intenta nuevamente en unos minutos.',
      });
    }

    return renderApplicationError(
      res,
      {
        status: 500,
        message: 'No fue posible cargar el dashboard.',
        message2: 'Intenta nuevamente en unos minutos.',
        limit: null,
        error,
        adminErrorDetail: '',
      },
      req,
      error
    );
  } finally {
    if (client) {
      client.release();
    }
  }
});

router.__private = {
  fetchCoordinatorRows,
  fetchUsuarioRows,
  fetchUsuariosRegistradosRows,
  fetchUsuariosPlaceholderRows,
  fetchUsuarioRolesRows,
  fetchSanctionRows,
  fetchLaboratoristaRows,
  fetchStudentCertificateRows,
  fetchTeacherCertificateRows,
  resolveDashboardSchemaColumns,
};

module.exports = router;
