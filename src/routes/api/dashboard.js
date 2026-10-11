const express = require('express');

const pool = require('../../libs/db');
const {
  isInstitutionalEmail,
  isUniqueViolation,
  normalizeInstitutionalEmail,
  normalizeLogDocument,
} = require('../../libs/account-email');
const { sendEmailNotification } = require('../../libs/email-notifications');
const { buildAppUrl } = require('../../libs/app-url');
const {
  resolveFacultyKeyFromName,
  resolveStudentFacultyKey,
} = require('../../libs/academic-faculty');
const { resolveCoordinatorScope } = require('../../libs/faculty-scope');
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
  const facultadIdColumn = await resolveExistingColumn(client, 'dependencia_facultad', [
    'dependencia_facultad_id',
    'facultad_id',
    'id_facultad',
  ]);
  const ualFacultadIdColumn = await resolveExistingColumn(client, 'ual', [
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
    ualFacultadIdColumn,
    multaUalIdColumn,
    laboratoristaUalIdColumn,
    laboratoristaUalDocumentColumn,
    coordinadorFacultadIdColumn,
    coordinadorFacultadDocumentColumn,
  };
}

const requireDashboardAccess = requireRoles(
  ['admin', 'coordinador_general', 'coordinador', 'laboratorista'],
  {
    message: '¡Acceso denegado!',
    message2: 'No tienes permisos para ver el dashboard',
    limit: 'noSession',
  }
);

const requireDashboardAdminJson = requireJsonRoles(['admin'], {
  message: 'No tienes permisos para realizar esta acción.',
});

const CHART_DEFINITIONS = {
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
  if (roles.includes('coordinador_general')) return 'coordinador_general';
  if (roles.includes('coordinador')) return 'coordinador';
  if (roles.includes('laboratorista')) return 'laboratorista';
  return '';
}

function isGlobalDashboardRole(role) {
  return role === 'admin' || role === 'coordinador_general';
}

function getAvailableChartIds(role) {
  if (isGlobalDashboardRole(role) || role === 'coordinador') {
    return ['estudiantes', 'docentes', 'laboratoristas', 'coordinadores', 'usuariosRegistrados'];
  }

  return ['laboratoristas'];
}

function canSeeStudentCertificates(role) {
  return role !== 'laboratorista';
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
    !columns.ualFacultadIdColumn ||
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
              ${columns.ualFacultadIdColumn} AS facultad_id
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
       FROM dependencia_facultad
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

  if (role === 'coordinador_general') {
    return {
      badge: 'Vista global · consulta',
      title: 'Monitoreo institucional',
      subtitle:
        'Indicadores de todas las facultades, dependencias y laboratorios en modo de solo consulta.',
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
    `SELECT ce.*,
            u.codigo::text AS codigo_usuario,
            u.carrera,
            u.nombre AS nombre_usuario,
            u.documento AS documento_usuario
     FROM certificado_estudiante ce
     LEFT JOIN usuario u ON u.id = ce.usuario_id
     WHERE ce.fecha_creacion IS NOT NULL
     ORDER BY ce.fecha_creacion DESC`
  );
  return result.rows;
}

async function fetchTeacherCertificateRows() {
  const result = await pool.query(
    `SELECT cd.*,
            u.nombre AS nombre_usuario,
            u.documento AS documento_usuario
     FROM certificado_docente cd
     LEFT JOIN usuario u ON u.id = cd.usuario_id
     WHERE cd.fecha_creacion IS NOT NULL
     ORDER BY cd.fecha_creacion DESC`
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
     ORDER BY l.fecha_creacion DESC NULLS LAST`
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
       ARRAY_REMOVE(ARRAY_AGG(DISTINCT cf.facultad_id), NULL) AS faculty_ids,
       COALESCE(coordinator_uals.ual_ids, ARRAY[]::int[]) AS ual_ids
     FROM coordinador c
     LEFT JOIN coordinador_facultad cf
       ON cf.coordinador_documento_id = c.documento
      AND cf.activo = TRUE
     LEFT JOIN LATERAL (
       SELECT ARRAY_AGG(DISTINCT a.ual_id::int) AS ual_ids
       FROM usuario_ual_rol_operativo a
       JOIN rol r ON r.id = a.rol_id AND r.nombre = 'coordinador'
       JOIN ual assigned_ual ON assigned_ual.ual_id = a.ual_id AND assigned_ual.activo = TRUE
       WHERE a.usuario_id = c.usuario_id AND a.activo = TRUE
     ) coordinator_uals ON TRUE
     GROUP BY
       c.fecha_creacion,
       c.nombre,
       c.documento,
       c.correo,
       c.numero_resolucion_coordinador,
       c.soporte_resolucion,
       c.nombre_u,
       c.usuario_id,
       coordinator_uals.ual_ids
     ORDER BY c.fecha_creacion DESC NULLS LAST`
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
         ARRAY[]::int[] AS faculty_ids,
         COALESCE((
           SELECT ARRAY_AGG(DISTINCT m.ual_id::int)
           FROM multa m
           WHERE m.usuario_sancionado_id = u.id
         ), ARRAY[]::int[]) AS ual_ids,
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
         COALESCE(coordinator_uals.ual_ids, ARRAY[]::int[]) AS ual_ids,
         CASE
           WHEN COALESCE(role_state.activo, FALSE) THEN 'ACTIVO'
           ELSE 'INACTIVO'
         END AS estado
       FROM coordinador c
       LEFT JOIN coordinador_facultad cf
         ON cf.coordinador_documento_id = c.documento
        AND cf.activo = TRUE
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
       LEFT JOIN LATERAL (
         SELECT ARRAY_AGG(DISTINCT a.ual_id::int) AS ual_ids
         FROM usuario_ual_rol_operativo a
         JOIN rol assigned_role ON assigned_role.id = a.rol_id
                               AND assigned_role.nombre = 'coordinador'
         JOIN ual assigned_ual ON assigned_ual.ual_id = a.ual_id
                              AND assigned_ual.activo = TRUE
         WHERE a.usuario_id = COALESCE(c.usuario_id, u.id)
           AND a.activo = TRUE
       ) coordinator_uals ON TRUE
       GROUP BY
         c.usuario_id,
         c.fecha_creacion,
         c.nombre,
         c.documento,
         c.correo,
         c.nombre_u,
         role_state.activo,
         coordinator_uals.ual_ids
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
         faculty_ids,
         ual_ids,
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
     ORDER BY fecha_creacion DESC NULLS LAST`
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

function isStudentRowInFacultyScope(row, scope) {
  const facultyKeys = new Set(scope.facultyKeys || []);
  if (!facultyKeys.size) return false;

  const facultyKey = resolveStudentFacultyKey({
    codigo: row.codigo_usuario ?? row.codigo,
    carrera: row.carrera,
  });
  return Boolean(facultyKey) && facultyKeys.has(facultyKey);
}

function filterStudentRowsByScope(rows, role, scope) {
  if (isGlobalDashboardRole(role)) {
    return rows;
  }

  return rows.filter((row) => isStudentRowInFacultyScope(row, scope));
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
  if (isGlobalDashboardRole(role)) {
    return rows;
  }

  if (role === 'coordinador') {
    const scopeIds = toNumericSet(scope.scopeType === 'uales' ? scope.ualIds : scope.facultyIds);
    const field = scope.scopeType === 'uales' ? 'ual_ids' : 'faculty_ids';
    return rows.filter((row) => hasIntersection(row[field], scopeIds));
  }

  if (role === 'laboratorista') {
    const scopeUalIds = toNumericSet(scope.ualIds);
    return rows.filter((row) => hasIntersection(row.ual_ids, scopeUalIds));
  }

  return [];
}

function filterCoordinatorRowsByScope(rows, role, scope) {
  if (isGlobalDashboardRole(role)) {
    return rows;
  }

  if (role !== 'coordinador') {
    return [];
  }

  const scopeIds = toNumericSet(scope.scopeType === 'uales' ? scope.ualIds : scope.facultyIds);
  const field = scope.scopeType === 'uales' ? 'ual_ids' : 'faculty_ids';
  return rows.filter((row) => hasIntersection(row[field], scopeIds));
}

function filterUsuarioRowsByScope(rows, role, scope) {
  if (isGlobalDashboardRole(role)) {
    return rows;
  }

  if (role === 'coordinador') {
    if (scope.scopeType === 'uales') {
      const ualIds = toNumericSet(scope.ualIds);
      return rows.filter((row) => hasIntersection(row.ual_ids, ualIds));
    }
    const facultyIds = toNumericSet(scope.facultyIds);
    return rows.filter(
      (row) =>
        isStudentRowInFacultyScope(row, scope) || hasIntersection(row.faculty_ids, facultyIds)
    );
  }

  if (role === 'laboratorista') {
    const scopeUalIds = toNumericSet(scope.ualIds);
    return rows.filter((row) => hasIntersection(row.ual_ids, scopeUalIds));
  }

  return [];
}

const OPEN_SANCTION_STATES = ['ACTIVA', 'Pendiente', 'POR SALDAR'];
const DETAIL_ROW_LIMIT = 500;
const RANKING_LIMIT = 5;

function buildSanctionScopeFilter(role, scope) {
  if (isGlobalDashboardRole(role)) {
    return { condition: 'TRUE', params: [] };
  }

  if (role === 'coordinador') {
    return scope.scopeType === 'uales'
      ? { condition: 'm.ual_id = ANY($1::int[])', params: [scope.ualIds || []] }
      : { condition: 'u.facultad_id = ANY($1::int[])', params: [scope.facultyIds || []] };
  }

  return { condition: 'm.ual_id = ANY($1::int[])', params: [scope.ualIds || []] };
}

function toInt(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function topEntries(map, limit = RANKING_LIMIT) {
  return Array.from(map.values())
    .sort((a, b) => b.abiertas - a.abiertas || a.nombre.localeCompare(b.nombre, 'es'))
    .slice(0, limit);
}

function addToRanking(map, key, nombre, abiertas) {
  if (key === null || key === undefined || !nombre) return;
  const current = map.get(key) || { nombre, abiertas: 0 };
  current.abiertas += abiertas;
  map.set(key, current);
}

async function fetchSanctionPazYSalvoSummary(client, role, scope) {
  const { condition, params } = buildSanctionScopeFilter(role, scope);
  const hasIncidenciaLink = Boolean(
    await resolveExistingColumn(client, 'incidencia', ['paz_y_salvo_multa_id'])
  );
  const loanBlockExpression = hasIncidenciaLink
    ? `COUNT(*) FILTER (
         WHERE EXISTS (
           SELECT 1 FROM incidencia i
           WHERE i.paz_y_salvo_multa_id = m.id AND i.paz_y_salvo_bloquea = TRUE
         )
       )::int`
    : '0';
  const stateParam = params.length + 1;

  const summaryRes = await client.query(
    `SELECT
       COUNT(*)::int AS abiertas,
       COUNT(DISTINCT m.usuario_sancionado_id)::int AS personas_bloqueadas,
       COUNT(*) FILTER (WHERE m.con_estado_multa = 'ACTIVA')::int AS activas,
       COUNT(*) FILTER (WHERE m.con_estado_multa = 'Pendiente')::int AS pendientes,
       COUNT(*) FILTER (WHERE m.con_estado_multa = 'POR SALDAR')::int AS por_saldar,
       COUNT(*) FILTER (WHERE edad.dias <= 30)::int AS hasta_30,
       COUNT(*) FILTER (WHERE edad.dias BETWEEN 31 AND 90)::int AS de_31_a_90,
       COUNT(*) FILTER (WHERE edad.dias > 90)::int AS mas_90,
       COALESCE(MAX(edad.dias), 0)::int AS max_dias,
       ${loanBlockExpression} AS desde_prestamos
     FROM multa m
     JOIN ual u ON u.ual_id = m.ual_id
     CROSS JOIN LATERAL (
       SELECT CURRENT_DATE - COALESCE(m.fecha_multa, m.fecha_creacion::date) AS dias
     ) edad
     WHERE m.con_estado_multa = ANY($${stateParam}::text[])
       AND ${condition}`,
    [...params, OPEN_SANCTION_STATES]
  );

  const rankingRes = await client.query(
    `SELECT
       u.ual_id,
       u.nombre AS ual_nombre,
       d.dependencia_facultad_id AS dependencia_id,
       d.nombre AS dependencia_nombre,
       d.padre_id,
       COALESCE(p.dependencia_facultad_id, d.dependencia_facultad_id) AS facultad_id,
       COALESCE(p.nombre, d.nombre) AS facultad_nombre,
       COUNT(*)::int AS abiertas
     FROM multa m
     JOIN ual u ON u.ual_id = m.ual_id
     LEFT JOIN dependencia_facultad d ON d.dependencia_facultad_id = u.facultad_id
     LEFT JOIN dependencia_facultad p ON p.dependencia_facultad_id = d.padre_id
     WHERE m.con_estado_multa = ANY($${stateParam}::text[])
       AND ${condition}
     GROUP BY u.ual_id, u.nombre, d.dependencia_facultad_id, d.nombre, d.padre_id,
              p.dependencia_facultad_id, p.nombre`,
    [...params, OPEN_SANCTION_STATES]
  );

  const facultades = new Map();
  const dependencias = new Map();
  const uals = new Map();
  rankingRes.rows.forEach((row) => {
    const abiertas = toInt(row.abiertas);
    addToRanking(facultades, row.facultad_id, row.facultad_nombre, abiertas);
    if (row.padre_id !== null && row.padre_id !== undefined) {
      addToRanking(dependencias, row.dependencia_id, row.dependencia_nombre, abiertas);
    }
    addToRanking(uals, row.ual_id, row.ual_nombre, abiertas);
  });

  const summary = summaryRes.rows[0] || {};
  return {
    abiertas: toInt(summary.abiertas),
    personasBloqueadas: toInt(summary.personas_bloqueadas),
    activas: toInt(summary.activas),
    pendientes: toInt(summary.pendientes),
    porSaldar: toInt(summary.por_saldar),
    desdePrestamos: toInt(summary.desde_prestamos),
    maxDias: toInt(summary.max_dias),
    antiguedad: [
      { label: '0 a 30 días', value: toInt(summary.hasta_30), tone: 'ok' },
      { label: '31 a 90 días', value: toInt(summary.de_31_a_90), tone: 'warn' },
      { label: 'Más de 90 días', value: toInt(summary.mas_90), tone: 'danger' },
    ],
    ranking: {
      facultades: topEntries(facultades),
      dependencias: topEntries(dependencias),
      uals: topEntries(uals),
    },
  };
}

async function fetchClaimPazYSalvoSummary(client, role, scope) {
  const hasClaims = Boolean(
    await resolveExistingColumn(client, 'reclamacion_sancion', ['multa_id'])
  );
  if (!hasClaims) return null;

  let condition = 'TRUE';
  let params = [];
  if (role === 'laboratorista') {
    condition = 'r.responsable_documento_id = $1';
    params = [scope.laboratoristaDocument || ''];
  } else if (!isGlobalDashboardRole(role)) {
    ({ condition, params } = buildSanctionScopeFilter(role, scope));
  }

  const result = await client.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE r.fecha_respuesta IS NULL)::int AS pendientes,
       COALESCE(
         MAX(CURRENT_DATE - r.fecha_creacion::date) FILTER (WHERE r.fecha_respuesta IS NULL),
         0
       )::int AS max_dias_espera,
       COUNT(*) FILTER (WHERE r.decision = 'PROCEDE')::int AS procede,
       COUNT(*) FILTER (WHERE r.decision = 'NO_PROCEDE')::int AS no_procede,
       ROUND(
         (AVG(EXTRACT(EPOCH FROM (r.fecha_respuesta - r.fecha_creacion)) / 3600.0)
           FILTER (WHERE r.fecha_respuesta IS NOT NULL))::numeric,
         1
       ) AS horas_promedio
     FROM reclamacion_sancion r
     JOIN multa m ON m.id = r.multa_id
     JOIN ual u ON u.ual_id = m.ual_id
     WHERE ${condition}`,
    params
  );

  const row = result.rows[0] || {};
  const procede = toInt(row.procede);
  const noProcede = toInt(row.no_procede);
  const respondidas = procede + noProcede;
  const horasPromedio =
    row.horas_promedio === null || row.horas_promedio === undefined
      ? null
      : Number(row.horas_promedio);

  return {
    total: toInt(row.total),
    pendientes: toInt(row.pendientes),
    maxDiasEspera: toInt(row.max_dias_espera),
    procede,
    noProcede,
    tasaProcede: respondidas ? Math.round((procede / respondidas) * 100) : null,
    horasPromedio: Number.isFinite(horasPromedio) ? horasPromedio : null,
  };
}

function countBy(rows, resolveKey) {
  const counts = new Map();
  rows.forEach((row) => {
    const key = resolveKey(row);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return Array.from(counts.entries())
    .map(([nombre, total]) => ({ nombre, total }))
    .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, 'es'));
}

function resolveMotivoLabel(row) {
  return String(row.motivo_exp || '').trim() || 'Sin motivo registrado';
}

function isWithinCurrentMonth(rawDate, now) {
  const date = new Date(rawDate);
  return (
    !Number.isNaN(date.getTime()) &&
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth()
  );
}

function buildCertificatePazYSalvoSummary(
  studentRows,
  teacherRows,
  includeTeachers,
  now = new Date()
) {
  const vigentes = studentRows.filter((row) => {
    const vence = new Date(row.fecha_vencimiento);
    return !Number.isNaN(vence.getTime()) && vence >= now;
  }).length;
  const studentSelfService = studentRows.filter(
    (row) => !String(row.motivo_expedicion || '').trim()
  ).length;
  const teacherSelfService = includeTeachers
    ? teacherRows.filter(
        (row) =>
          String(row.origen_descarga || '')
            .trim()
            .toUpperCase() === 'D'
      ).length
    : 0;
  const allRows = includeTeachers ? [...studentRows, ...teacherRows] : studentRows;
  const autogestion = studentSelfService + teacherSelfService;

  return {
    estudiantes: studentRows.length,
    docentes: includeTeachers ? teacherRows.length : null,
    vigentes,
    vencidos: studentRows.length - vigentes,
    emitidosMes: allRows.filter((row) => isWithinCurrentMonth(row.fecha_creacion, now)).length,
    origen: [
      { label: 'Autogestión', value: autogestion, tone: 'ok' },
      { label: 'Generado por personal', value: allRows.length - autogestion, tone: 'info' },
    ],
    motivos: countBy(allRows, resolveMotivoLabel).slice(0, 6),
  };
}

const GENERAL_ACTIVITY_MONTHS = 12;
const GENERAL_TOP_LIMIT = 6;
const GENERAL_USER_TYPES = [
  { key: 'estudiantes', label: 'Estudiantes' },
  { key: 'docentes', label: 'Docentes' },
  { key: 'laboratoristas', label: 'Laboratoristas' },
  { key: 'coordinadores', label: 'Coordinadores' },
];

function toValidDate(rawDate) {
  if (!rawDate) return null;
  const date = new Date(rawDate);
  return Number.isNaN(date.getTime()) ? null : date;
}

function countDated(rows, field) {
  return rows.filter((row) => toValidDate(row[field])).length;
}

function countInCurrentMonth(rows, field, now) {
  return rows.filter((row) => row[field] && isWithinCurrentMonth(row[field], now)).length;
}

function buildMonthWindow(now) {
  const months = [];
  for (let offset = GENERAL_ACTIVITY_MONTHS - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    months.push({
      key: `${date.getFullYear()}-${date.getMonth()}`,
      label: `${date.toLocaleDateString('es-CO', { month: 'short' }).replace('.', '')} ${String(
        date.getFullYear()
      ).slice(-2)}`,
    });
  }
  return months;
}

function buildMonthlyActivity(datasets, now) {
  const months = buildMonthWindow(now);
  const indexByKey = new Map(months.map((month, index) => [month.key, index]));

  return {
    labels: months.map((month) => month.label),
    datasets: datasets.map(({ key, label, dates }) => {
      const data = months.map(() => 0);
      dates.forEach((rawDate) => {
        const date = toValidDate(rawDate);
        if (!date) return;
        const index = indexByKey.get(`${date.getFullYear()}-${date.getMonth()}`);
        if (index !== undefined) data[index] += 1;
      });
      return { key, label, data };
    }),
  };
}

function topWithOthers(entries, limit = GENERAL_TOP_LIMIT) {
  if (entries.length <= limit) return entries;
  const others = entries.slice(limit - 1).reduce((sum, entry) => sum + entry.total, 0);
  return [...entries.slice(0, limit - 1), { nombre: 'Otras', total: others }];
}

function normalizeAccountState(value) {
  const state = String(value || '')
    .trim()
    .toUpperCase();
  return state || 'ACTIVO';
}

function buildGeneralOverview(availableChartIds, rows, now = new Date()) {
  const has = (chartId) => availableChartIds.includes(chartId);
  const rowsByType = Object.fromEntries(
    GENERAL_USER_TYPES.map(({ key }) => [key, has(key) ? rows[key] || [] : []])
  );
  const usuariosRegistrados = has('usuariosRegistrados') ? rows.usuariosRegistrados || [] : [];
  const visibleTypes = GENERAL_USER_TYPES.filter(({ key }) => has(key));
  const { laboratoristas } = rowsByType;
  const activeLaboratoristas = laboratoristas.filter((row) => row.activo !== false).length;
  const newThisMonth = (items) =>
    `${countInCurrentMonth(items, 'fecha_creacion', now)} nuevos este mes`;

  const hints = {
    estudiantes: newThisMonth(rowsByType.estudiantes),
    docentes: newThisMonth(rowsByType.docentes),
    laboratoristas: `${activeLaboratoristas} activos de ${laboratoristas.length}`,
    coordinadores: newThisMonth(rowsByType.coordinadores),
    usuariosRegistrados: newThisMonth(usuariosRegistrados),
  };

  const usuarios = visibleTypes.map(({ key, label }) => ({
    key,
    label,
    value: countDated(rowsByType[key], 'fecha_creacion'),
  }));
  const academicRows = [...rowsByType.estudiantes, ...rowsByType.docentes];

  return {
    hints,
    actividad: buildMonthlyActivity(
      visibleTypes.map(({ key, label }) => ({
        key,
        label,
        dates: rowsByType[key].map((row) => row.fecha_creacion),
      })),
      now
    ),
    usuarios: usuarios.length > 1 ? usuarios : null,
    programas: has('estudiantes')
      ? topWithOthers(
          countBy(
            rowsByType.estudiantes,
            (row) => String(row.carrera || '').trim() || 'Sin programa'
          )
        )
      : null,
    estadosCuenta:
      has('estudiantes') || has('docentes')
        ? topWithOthers(countBy(academicRows, (row) => normalizeAccountState(row.estado)))
        : null,
    laboratoristasEstado: has('laboratoristas')
      ? [
          { key: 'activos', label: 'Activos', value: activeLaboratoristas },
          {
            key: 'inactivos',
            label: 'Inactivos',
            value: laboratoristas.length - activeLaboratoristas,
          },
        ]
      : null,
  };
}

const ACTIVITY_ROLE_LABELS = {
  admin: 'Administrador',
  coordinador_general: 'Coordinador general',
  coordinador: 'Coordinador',
  laboratorista: 'Laboratorista',
  docente: 'Docente',
  estudiante: 'Estudiante',
};
const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const OPERATIONAL_FACULTY_TREE = `
  SELECT
    d.dependencia_facultad_id AS id,
    COALESCE(p.dependencia_facultad_id, d.dependencia_facultad_id) AS facultad_id
  FROM dependencia_facultad d
  LEFT JOIN dependencia_facultad p ON p.dependencia_facultad_id = d.padre_id`;

function percentOf(value, total) {
  return total ? Math.round((value / total) * 100) : null;
}

async function fetchOperationalCoverage(client, now = new Date()) {
  const [facultiesRes, ualRes, labRes, coordRes, totalsRes] = await Promise.all([
    client.query(
      `SELECT dependencia_facultad_id AS facultad_id, nombre
       FROM dependencia_facultad
       WHERE padre_id IS NULL AND activo IS DISTINCT FROM FALSE`
    ),
    client.query(
      `WITH arbol AS (${OPERATIONAL_FACULTY_TREE})
       SELECT
         a.facultad_id,
         COUNT(*)::int AS ual_activas,
         COUNT(*) FILTER (
           WHERE EXISTS (
             SELECT 1
             FROM laboratorista_ual lu
             JOIN laboratorista l ON l.documento = lu.laboratorista_documento_id
             WHERE lu.ual_id = u.ual_id
               AND lu.activo IS DISTINCT FROM FALSE
               AND l.activo IS DISTINCT FROM FALSE
           )
         )::int AS ual_con_laboratorista
       FROM ual u
       JOIN arbol a ON a.id = u.facultad_id
       WHERE u.activo = TRUE
       GROUP BY a.facultad_id`
    ),
    client.query(
      `WITH arbol AS (${OPERATIONAL_FACULTY_TREE})
       SELECT a.facultad_id, COUNT(DISTINCT l.documento)::int AS total
       FROM laboratorista l
       JOIN laboratorista_ual lu
         ON lu.laboratorista_documento_id = l.documento
        AND lu.activo IS DISTINCT FROM FALSE
       JOIN ual u ON u.ual_id = lu.ual_id AND u.activo = TRUE
       JOIN arbol a ON a.id = u.facultad_id
       WHERE l.activo IS DISTINCT FROM FALSE
       GROUP BY a.facultad_id`
    ),
    client.query(
      `WITH arbol AS (${OPERATIONAL_FACULTY_TREE})
       SELECT a.facultad_id, COUNT(DISTINCT c.documento)::int AS total
       FROM coordinador c
       JOIN coordinador_facultad cf
         ON cf.coordinador_documento_id = c.documento
        AND cf.activo IS DISTINCT FROM FALSE
       JOIN arbol a ON a.id = cf.facultad_id
       WHERE c.activo IS DISTINCT FROM FALSE
       GROUP BY a.facultad_id`
    ),
    client.query(
      `SELECT
         (SELECT COUNT(*) FROM laboratorista WHERE activo IS DISTINCT FROM FALSE)::int
           AS laboratoristas,
         (SELECT COUNT(*) FROM coordinador WHERE activo IS DISTINCT FROM FALSE)::int
           AS coordinadores,
         (SELECT COUNT(*) FROM monitor WHERE activo IS DISTINCT FROM FALSE)::int AS monitores,
         (SELECT COUNT(*) FROM monitor
           WHERE activo IS DISTINCT FROM FALSE
             AND fecha_fin BETWEEN $1::date AND ($1::date + 30))::int AS monitores_por_vencer`,
      [now.toISOString().slice(0, 10)]
    ),
  ]);

  const byFaculty = (rows) => new Map(rows.map((row) => [Number(row.facultad_id), row]));
  const ualByFaculty = byFaculty(ualRes.rows);
  const labsByFaculty = byFaculty(labRes.rows);
  const coordsByFaculty = byFaculty(coordRes.rows);

  const facultades = facultiesRes.rows
    .map((row) => {
      const id = Number(row.facultad_id);
      const ual = ualByFaculty.get(id) || {};
      return {
        nombre: String(row.nombre || '').trim() || `Facultad ${id}`,
        ualActivas: toInt(ual.ual_activas),
        ualConLaboratorista: toInt(ual.ual_con_laboratorista),
        laboratoristas: toInt(labsByFaculty.get(id)?.total),
        coordinadores: toInt(coordsByFaculty.get(id)?.total),
      };
    })
    .sort((a, b) => b.ualActivas - a.ualActivas || a.nombre.localeCompare(b.nombre, 'es'));

  const ualActivas = facultades.reduce((sum, item) => sum + item.ualActivas, 0);
  const ualConLaboratorista = facultades.reduce((sum, item) => sum + item.ualConLaboratorista, 0);
  const totals = totalsRes.rows[0] || {};

  return {
    totales: {
      facultades: facultades.length,
      ualActivas,
      ualConLaboratorista,
      porcentajeCubierto: percentOf(ualConLaboratorista, ualActivas),
      laboratoristas: toInt(totals.laboratoristas),
      coordinadores: toInt(totals.coordinadores),
      monitores: toInt(totals.monitores),
      monitoresPorVencer: toInt(totals.monitores_por_vencer),
    },
    facultades,
    facultadesSinCoordinador: facultades.filter((item) => !item.coordinadores).length,
  };
}

function capitalizeLabel(value) {
  const text = String(value || '').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Sin descripción';
}

async function fetchPlatformActivity(client, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const [monthlyRes, summaryRes, actionsRes, rolesRes, weekdayRes, actorsRes] = await Promise.all([
    client.query(
      `SELECT to_char(fecha_creacion, 'YYYY-MM') AS mes, COUNT(*)::int AS total
       FROM log
       WHERE fecha_creacion >= date_trunc('month', $1::date) - INTERVAL '11 months'
       GROUP BY 1`,
      [today]
    ),
    client.query(
      `SELECT
         COUNT(*) FILTER (WHERE fecha_creacion >= $1::date - 29)::int AS acciones_30,
         COUNT(*) FILTER (
           WHERE fecha_creacion >= $1::date - 59 AND fecha_creacion < $1::date - 29
         )::int AS acciones_previas,
         COUNT(DISTINCT documento) FILTER (WHERE fecha_creacion >= $1::date - 29)::int
           AS actores_30
       FROM log
       WHERE fecha_creacion >= $1::date - 59`,
      [today]
    ),
    client.query(
      `SELECT LOWER(TRIM(regexp_replace(COALESCE(accion, ''), '\\s*\\(.*$', ''))) AS accion,
              COUNT(*)::int AS total
       FROM log
       WHERE fecha_creacion >= $1::date - 89
       GROUP BY 1
       ORDER BY total DESC`,
      [today]
    ),
    client.query(
      `SELECT LOWER(TRIM(COALESCE(nombre, ''))) AS rol, COUNT(*)::int AS total
       FROM log
       WHERE fecha_creacion >= $1::date - 89
       GROUP BY 1`,
      [today]
    ),
    client.query(
      `SELECT EXTRACT(ISODOW FROM fecha_creacion)::int AS dia, COUNT(*)::int AS total
       FROM log
       WHERE fecha_creacion >= $1::date - 89
       GROUP BY 1`,
      [today]
    ),
    client.query(
      `SELECT
         COALESCE(us.nombre, lg.documento::text) AS nombre,
         COUNT(*)::int AS total
       FROM log lg
       LEFT JOIN usuario us ON us.documento = lg.documento::text
       WHERE lg.fecha_creacion >= $1::date - 29
       GROUP BY lg.documento, us.nombre
       ORDER BY total DESC
       LIMIT 8`,
      [today]
    ),
  ]);

  const months = buildMonthWindow(now);
  const monthlyByKey = new Map(
    monthlyRes.rows.map((row) => {
      const [year, month] = String(row.mes || '').split('-');
      return [`${Number(year)}-${Number(month) - 1}`, toInt(row.total)];
    })
  );

  const actionCounts = new Map();
  actionsRes.rows.forEach((row) => {
    const label = capitalizeLabel(row.accion);
    actionCounts.set(label, (actionCounts.get(label) || 0) + toInt(row.total));
  });
  const acciones = Array.from(actionCounts.entries())
    .map(([nombre, total]) => ({ nombre, total }))
    .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, 'es'));

  const roleCounts = new Map();
  rolesRes.rows.forEach((row) => {
    const label = ACTIVITY_ROLE_LABELS[row.rol] || 'Otros';
    roleCounts.set(label, (roleCounts.get(label) || 0) + toInt(row.total));
  });

  const weekday = WEEKDAY_LABELS.map(() => 0);
  weekdayRes.rows.forEach((row) => {
    const index = toInt(row.dia) - 1;
    if (index >= 0 && index < weekday.length) weekday[index] += toInt(row.total);
  });

  const summary = summaryRes.rows[0] || {};
  const acciones30 = toInt(summary.acciones_30);
  const accionesPrevias = toInt(summary.acciones_previas);

  return {
    acciones30,
    actores30: toInt(summary.actores_30),
    variacion: accionesPrevias
      ? Math.round(((acciones30 - accionesPrevias) / accionesPrevias) * 100)
      : null,
    mensual: {
      labels: months.map((month) => month.label),
      data: months.map((month) => monthlyByKey.get(month.key) || 0),
    },
    acciones: topWithOthers(acciones),
    roles: Array.from(roleCounts.entries())
      .map(([nombre, total]) => ({ nombre, total }))
      .sort((a, b) => b.total - a.total),
    semana: { labels: WEEKDAY_LABELS, data: weekday },
    actores: actorsRes.rows.map((row) => ({
      nombre: String(row.nombre || '').trim() || 'Sin identificar',
      total: toInt(row.total),
    })),
  };
}

async function safeIndicator(label, loader) {
  try {
    return await loader();
  } catch (error) {
    console.warn(`Dashboard: no fue posible calcular ${label}:`, error.message);
    return null;
  }
}

function buildPazYSalvoCards(role, indicators) {
  const { sanciones, reclamaciones, certificados } = indicators;
  const multasUrl = '/milab/api/get_list_multas';
  const claimsHref =
    role === 'admin' || role === 'laboratorista' ? '/milab/api/sanciones/reclamaciones' : null;
  const cards = [];

  cards.push({
    label: role === 'laboratorista' ? 'Personas bloqueadas por tus UAL' : 'Personas bloqueadas',
    value: sanciones.personasBloqueadas,
    hint: `${sanciones.abiertas} sanciones abiertas les impiden el paz y salvo`,
    tone: sanciones.personasBloqueadas ? 'danger' : 'ok',
    href: multasUrl,
  });

  const pendingApproval = sanciones.pendientes + sanciones.porSaldar;
  cards.push({
    label:
      role === 'coordinador'
        ? 'Pendientes de tu autorización'
        : role === 'laboratorista'
          ? 'Esperando al coordinador'
          : 'Pendientes de autorización',
    value: pendingApproval,
    hint: `${sanciones.pendientes} por crear · ${sanciones.porSaldar} por saldar`,
    tone: pendingApproval ? 'warn' : 'ok',
    href: role === 'coordinador' ? '/milab/api/aprobacion_multa' : multasUrl,
  });

  if (reclamaciones) {
    cards.push({
      label:
        role === 'laboratorista' ? 'Reclamaciones por responder' : 'Reclamaciones sin respuesta',
      value: reclamaciones.pendientes,
      hint: reclamaciones.pendientes
        ? `La más antigua espera hace ${reclamaciones.maxDiasEspera} día(s)`
        : 'Sin reclamaciones en espera',
      tone: reclamaciones.pendientes ? 'warn' : 'ok',
      href: claimsHref,
    });
  }

  const oldSanctions = sanciones.antiguedad[2].value;
  cards.push({
    label: 'Sanciones con más de 90 días',
    value: oldSanctions,
    hint: sanciones.abiertas
      ? `La más antigua lleva ${sanciones.maxDias} día(s) abierta`
      : 'No hay sanciones abiertas',
    tone: oldSanctions ? 'danger' : 'ok',
    href: multasUrl,
  });

  if (certificados) {
    cards.push({
      label: 'Paz y salvos vigentes',
      value: certificados.vigentes,
      hint: `${certificados.emitidosMes} expedidos este mes · ${certificados.vencidos} vencidos`,
      tone: 'info',
      href: null,
    });
  }

  cards.push({
    label: 'Bloqueos desde préstamos',
    value: sanciones.desdePrestamos,
    hint: 'Sanciones abiertas originadas en incidencias de préstamo',
    tone: sanciones.desdePrestamos ? 'warn' : 'ok',
    href: null,
  });

  return cards;
}

async function buildPazYSalvoIndicators(client, role, scope, certificateRows) {
  const sanciones = await fetchSanctionPazYSalvoSummary(client, role, scope);
  const reclamaciones = await fetchClaimPazYSalvoSummary(client, role, scope);
  const certificados =
    role === 'laboratorista'
      ? null
      : buildCertificatePazYSalvoSummary(
          certificateRows.students,
          certificateRows.teachers,
          isGlobalDashboardRole(role)
        );

  let rankingGroups = [{ title: 'UAL', items: sanciones.ranking.uals }];
  if (isGlobalDashboardRole(role)) {
    rankingGroups = [
      { title: 'Facultades', items: sanciones.ranking.facultades },
      ...rankingGroups,
    ];
  } else if (role === 'coordinador') {
    rankingGroups = [
      { title: 'Dependencias', items: sanciones.ranking.dependencias },
      ...rankingGroups,
    ];
  }

  const indicators = { sanciones, reclamaciones, certificados, rankingGroups };
  return { ...indicators, cards: buildPazYSalvoCards(role, indicators) };
}

function limitDetailRows(tablesData, keepFull = []) {
  const limited = {};
  const meta = {};
  Object.entries(tablesData).forEach(([key, rows]) => {
    const list = Array.isArray(rows) ? rows : [];
    const shouldLimit = !keepFull.includes(key) && list.length > DETAIL_ROW_LIMIT;
    limited[key] = shouldLimit ? list.slice(0, DETAIL_ROW_LIMIT) : list;
    meta[key] = { total: list.length, shown: limited[key].length };
  });
  return { limited, meta };
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

async function regenerateSession(req) {
  if (!req?.session || typeof req.session.regenerate !== 'function') {
    return;
  }

  const previousCsrfToken = req.session.csrfToken || '';
  const previousLifetime = req.session.lifetime;

  await new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) {
        reject(error);
        return;
      }

      if (previousCsrfToken) {
        req.session.csrfToken = previousCsrfToken;
      }
      if (previousLifetime) req.session.lifetime = previousLifetime;

      resolve();
    });
  });
}

async function saveSession(req) {
  if (!req?.session || typeof req.session.save !== 'function') {
    return;
  }

  await new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function normalizeEmail(value) {
  return (value || '').toString().trim().toLowerCase();
}

function parseBooleanFlag(value) {
  if (value === true || value === false) {
    return value;
  }

  const normalized = String(value || '')
    .trim()
    .toLowerCase();

  if (['1', 'true', 'yes', 'on', 'si', 'sí', 'activo', 'activa'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off', 'inactivo', 'inactiva'].includes(normalized)) {
    return false;
  }

  return null;
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

function extractOatiStudentRecords(payload) {
  const nested = payload?.datosEstudianteCollection?.datosBasicosEstudiante;
  const flat = payload?.datosBasicosEstudiante;
  const source = nested ?? flat;
  if (Array.isArray(source)) return source.filter(Boolean);
  return source ? [source] : [];
}

async function resolveOatiCatalogNames(codes, fetchName) {
  const uniqueCodes = [...new Set(codes.filter(Boolean))];
  const entries = await Promise.all(
    uniqueCodes.map(async (code) => {
      try {
        return [code, String((await fetchName(code)) || '').trim() || code];
      } catch {
        return [code, code];
      }
    })
  );
  return new Map(entries);
}

async function lookupOatiStudentRecordsByDocumento(documento) {
  const payload = await requestOati(
    getAcademicServicePath(`datos_basicos_activos_cedula/${documento}`)
  );

  const rawRecords = extractOatiStudentRecords(payload).map((item) => ({
    codigo: String(item.codigo ?? '').trim(),
    nombre: String(item.nombre ?? '').trim(),
    documento: String(item.documento ?? documento).trim(),
    correo: resolveOatiEmail(item),
    estadoCodigo: String(item.estado ?? '').trim(),
    carreraCodigo: String(item.carrera ?? '').trim(),
  }));

  const [estados, carreras] = await Promise.all([
    resolveOatiCatalogNames(
      rawRecords.map((record) => record.estadoCodigo),
      async (code) => {
        const data = await requestOati(getAcademicServicePath(`estados_codigo/${code}`));
        return data?.estado?.nombre;
      }
    ),
    resolveOatiCatalogNames(
      rawRecords.map((record) => record.carreraCodigo),
      async (code) => {
        const data = await requestOati(getAcademicServicePath(`carrera/${code}`));
        const carrera = data?.carrerasCollection?.carrera;
        return Array.isArray(carrera) ? carrera[0]?.nombre : carrera?.nombre;
      }
    ),
  ]);

  return rawRecords
    .filter((record) => /^\d+$/.test(record.codigo))
    .map((record) => ({
      ...record,
      estado: estados.get(record.estadoCodigo) || record.estadoCodigo || null,
      carrera: carreras.get(record.carreraCodigo) || record.carreraCodigo || null,
    }));
}

async function findDashboardEmailConflict(client, correo, target) {
  const normalizedCorreo = normalizeInstitutionalEmail(correo);
  const targetDocumento = String(target?.documento || '').trim();
  const targetId = Number(target?.id || 0);

  if (!normalizedCorreo || !targetDocumento || !targetId) {
    return null;
  }

  const conflictResult = await client.query(
    `SELECT source, auth_document, documento_ref, usuario_id
     FROM (
       SELECT
         'usuario' AS source,
         u.documento AS auth_document,
         u.documento AS documento_ref,
         u.id AS usuario_id,
         LOWER(TRIM(u.correo)) AS correo
       FROM usuario u
       WHERE u.correo IS NOT NULL AND TRIM(u.correo) <> ''

       UNION ALL

       SELECT
         'laboratorista' AS source,
         COALESCE(NULLIF(TRIM(l.n_usuario), ''), l.documento) AS auth_document,
         l.documento AS documento_ref,
         l.usuario_id AS usuario_id,
         LOWER(TRIM(l.correo)) AS correo
       FROM laboratorista l
       WHERE l.correo IS NOT NULL AND TRIM(l.correo) <> ''

       UNION ALL

       SELECT
         'coordinador' AS source,
         COALESCE(NULLIF(TRIM(c.nombre_u), ''), c.documento) AS auth_document,
         c.documento AS documento_ref,
         c.usuario_id AS usuario_id,
         LOWER(TRIM(c.correo)) AS correo
       FROM coordinador c
       WHERE c.correo IS NOT NULL AND TRIM(c.correo) <> ''
     ) existing_accounts
     WHERE correo = $1
       AND NOT (
         documento_ref = $2
         OR auth_document = $2
         OR COALESCE(usuario_id, 0) = $3
       )
     LIMIT 1`,
    [normalizedCorreo, targetDocumento, targetId]
  );

  return conflictResult.rows[0] || null;
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

  await client.query(
    `UPDATE coordinador
     SET correo = $1,
         usuario_id = COALESCE(usuario_id, $2),
         nombre_u = CASE
           WHEN nombre_u IS NULL OR TRIM(nombre_u) = '' THEN $3
           ELSE nombre_u
         END,
         fecha_modificacion = CURRENT_TIMESTAMP
     WHERE documento = $3 OR nombre_u = $3 OR usuario_id = $2`,
    [correo, Number(target.id), documento]
  );

  await client.query(
    `UPDATE laboratorista
     SET correo = $1,
         usuario_id = COALESCE(usuario_id, $2),
         n_usuario = CASE
           WHEN n_usuario IS NULL OR TRIM(n_usuario) = '' THEN $3
           ELSE n_usuario
         END,
         fecha_modificacion = CURRENT_TIMESTAMP
     WHERE documento = $3 OR n_usuario = $3 OR usuario_id = $2`,
    [correo, Number(target.id), documento]
  );
}

router.post('/usuarios/:id/correo', requireDashboardAdminJson, async (req, res) => {
  const usuarioId = Number(req.params.id);
  const correo = normalizeInstitutionalEmail(req.body?.correo);
  const tipoUsuario = String(req.body?.tipoUsuario || '')
    .trim()
    .toLowerCase();
  const notificarUsuario = req.body?.notificarUsuario === true;

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
  let sanciones = [];
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
    const conflict = await findDashboardEmailConflict(client, correo, target);
    if (conflict) {
      client.release();
      return res.status(409).json({
        ok: false,
        message: 'Ese correo ya existe vinculado a otra cuenta.',
      });
    }

    await client.query('BEGIN');
    await enrollUserFromDashboardEdit(client, target, tipoUsuario, correo);
    if (notificarUsuario) {
      const sanctionsResult = await client.query(
        `SELECT
           m.id,
           m.cat_multa,
           m.tipo_sancion,
           m.obs_multa,
           m.fecha_multa,
           m.con_estado_multa,
           u.nombre AS laboratorio
         FROM multa m
         LEFT JOIN ual u ON u.ual_id = m.ual_id
         WHERE m.usuario_sancionado_id = $1
           AND (m.activo IS DISTINCT FROM FALSE)
           AND UPPER(TRIM(COALESCE(m.con_estado_multa, ''))) IN ('ACTIVA', 'PENDIENTE', 'POR SALDAR')
         ORDER BY m.fecha_multa DESC NULLS LAST, m.id DESC`,
        [usuarioId]
      );
      sanciones = sanctionsResult.rows;
    }
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

    let notificacion;
    if (notificarUsuario) {
      try {
        notificacion = await sendEmailNotification({
          sourceSystem: 'dashboard',
          templateName: 'dashboard/user-account-notification',
          recipient: correo,
          subject: 'Tu cuenta MILab está habilitada',
          variables: {
            nombre: target.nombre || 'usuario',
            correo,
            tipoUsuario,
            sanciones,
            registrationUrl: buildAppUrl('/register'),
          },
        });
        if (notificacion?.status === 'FAILED') {
          console.error('Error enviando notificación de cuenta desde dashboard:', {
            notificationId: notificacion.id,
            error: notificacion.error,
          });
        }
      } catch (notificationError) {
        console.error('Error enviando notificación de cuenta desde dashboard:', notificationError);
        notificacion = { status: 'FAILED' };
      }
    }

    return res.json({
      ok: true,
      id: usuarioId,
      documento: target.documento,
      correo,
      tipoUsuario,
      ...(notificarUsuario ? { notificacion: { status: notificacion?.status || 'FAILED' } } : {}),
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

router.post('/usuarios/:id/activo', requireDashboardAdminJson, async (req, res) => {
  const usuarioId = Number(req.params.id);
  const activo = parseBooleanFlag(req.body?.activo);

  if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
    return res.status(400).json({
      ok: false,
      message: 'Debes indicar un ID de usuario valido.',
    });
  }

  if (typeof activo !== 'boolean') {
    return res.status(400).json({
      ok: false,
      message: 'Debes indicar un estado activo valido (true o false).',
    });
  }

  const actorUserId = Number(req.session?.user?.id || 0);
  if (actorUserId === usuarioId && activo === false) {
    return res.status(409).json({
      ok: false,
      message: 'No puedes inactivar tu propia cuenta mientras administras el dashboard.',
    });
  }

  let client;
  try {
    client = await pool.connect();

    const targetRes = await client.query(
      'SELECT id, documento, nombre, activo FROM usuario WHERE id = $1 LIMIT 1',
      [usuarioId]
    );

    if (!targetRes.rows.length) {
      client.release();
      return res.status(404).json({
        ok: false,
        message: 'No encontramos la cuenta seleccionada.',
      });
    }

    const target = targetRes.rows[0];
    const updateRes = await client.query(
      `UPDATE usuario
       SET activo = $1,
           fecha_modificacion = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, documento, nombre, activo`,
      [activo, usuarioId]
    );

    const updated = updateRes.rows[0] || target;

    await client.query(
      'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
      [
        req.session?.user?.tipo || 'admin',
        normalizeLogDocument(
          req.session?.user?.documento || req.session?.user?.documento_real || ''
        ),
        activo ? 'Activar usuario desde dashboard' : 'Inactivar usuario desde dashboard',
        String(updated.documento || updated.nombre || usuarioId),
      ]
    );

    client.release();
    return res.json({
      ok: true,
      id: Number(updated.id || usuarioId),
      activo: Boolean(updated.activo),
    });
  } catch (error) {
    if (client) {
      client.release();
    }

    console.error('Error actualizando estado activo de usuario desde dashboard:', error);
    return res.status(500).json({
      ok: false,
      message: 'No fue posible actualizar el estado activo del usuario. Inténtalo nuevamente.',
    });
  }
});

function parseDashboardUsuarioId(value) {
  const usuarioId = Number(value);
  return Number.isInteger(usuarioId) && usuarioId > 0 ? usuarioId : null;
}

async function fetchDashboardEditableUsuario(client, usuarioId) {
  const result = await client.query(
    `SELECT id, documento, correo, nombre, codigo::text AS codigo, carrera, estado, activo
     FROM usuario
     WHERE id = $1
     LIMIT 1`,
    [usuarioId]
  );
  return result.rows[0] || null;
}

router.get('/usuarios/:id/oati-registros', requireDashboardAdminJson, async (req, res) => {
  const usuarioId = parseDashboardUsuarioId(req.params.id);
  if (!usuarioId) {
    return res.status(400).json({ ok: false, message: 'Debes indicar un ID de usuario valido.' });
  }

  let usuario;
  try {
    usuario = await fetchDashboardEditableUsuario(pool, usuarioId);
  } catch (error) {
    console.error('Error consultando usuario para editar desde dashboard:', error);
    return res.status(500).json({
      ok: false,
      message: 'No fue posible cargar los datos del usuario. Inténtalo nuevamente.',
    });
  }

  if (!usuario) {
    return res.status(404).json({ ok: false, message: 'No encontramos la cuenta seleccionada.' });
  }

  const documento = String(usuario.documento || '').trim();
  if (!/^\d+$/.test(documento)) {
    return res.status(422).json({
      ok: false,
      usuario,
      message: 'El usuario no tiene un documento numérico válido para consultar en OATI.',
    });
  }

  try {
    const registros = await lookupOatiStudentRecordsByDocumento(documento);
    return res.json({ ok: true, usuario, registros });
  } catch (error) {
    console.error('Error consultando registros OATI desde dashboard:', error);
    return res.status(502).json({
      ok: false,
      usuario,
      message: 'No fue posible consultar OATI en este momento. Inténtalo nuevamente.',
    });
  }
});

router.post('/usuarios/:id/oati-registro', requireDashboardAdminJson, async (req, res) => {
  const usuarioId = parseDashboardUsuarioId(req.params.id);
  const codigo = String(req.body?.codigo ?? '').trim();

  if (!usuarioId) {
    return res.status(400).json({ ok: false, message: 'Debes indicar un ID de usuario valido.' });
  }

  if (!/^\d+$/.test(codigo)) {
    return res.status(400).json({
      ok: false,
      message: 'Debes seleccionar un registro de OATI con un código válido.',
    });
  }

  let client;
  try {
    client = await pool.connect();
    const target = await fetchDashboardEditableUsuario(client, usuarioId);
    if (!target) {
      return res.status(404).json({ ok: false, message: 'No encontramos la cuenta seleccionada.' });
    }

    const documento = String(target.documento || '').trim();
    if (!/^\d+$/.test(documento)) {
      return res.status(422).json({
        ok: false,
        message: 'El usuario no tiene un documento numérico válido para consultar en OATI.',
      });
    }

    let registros;
    try {
      registros = await lookupOatiStudentRecordsByDocumento(documento);
    } catch (error) {
      console.error('Error consultando registros OATI para asociar desde dashboard:', error);
      return res.status(502).json({
        ok: false,
        message: 'No fue posible consultar OATI en este momento. Inténtalo nuevamente.',
      });
    }

    // Revalida contra OATI para no confiar en datos académicos enviados por el navegador.
    const registro = registros.find((item) => item.codigo === codigo);
    if (!registro) {
      return res.status(409).json({
        ok: false,
        message: 'El registro seleccionado ya no aparece en OATI para este documento.',
      });
    }

    const nombre = registro.nombre || String(target.nombre || '').trim() || 'Sin nombre';
    const estado = registro.estado || null;
    const carrera = registro.carrera || null;

    await client.query('BEGIN');
    const updateResult = await client.query(
      `UPDATE usuario
       SET nombre = $1,
           codigo = $2,
           carrera = $3,
           estado = $4,
           fecha_modificacion = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING id, documento, correo, nombre, codigo::text AS codigo, carrera, estado, activo`,
      [nombre, codigo, carrera, estado, usuarioId]
    );

    await client.query(
      `INSERT INTO usuario_rol (usuario_id, rol_id)
       SELECT $1, id
       FROM rol
       WHERE nombre = 'estudiante'
       ON CONFLICT (usuario_id, rol_id) DO UPDATE
       SET activo = TRUE,
           fecha_modificacion = CURRENT_TIMESTAMP`,
      [usuarioId]
    );

    await client.query(
      `INSERT INTO perfil_estudiante (usuario_id, documento, nombre, codigo, programa, estado)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (usuario_id) DO UPDATE
       SET documento = EXCLUDED.documento,
           nombre = EXCLUDED.nombre,
           codigo = EXCLUDED.codigo,
           programa = EXCLUDED.programa,
           estado = EXCLUDED.estado,
           fecha_modificacion = CURRENT_TIMESTAMP`,
      [usuarioId, documento, nombre, codigo, carrera, estado]
    );

    await client.query(
      'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
      [
        req.session?.user?.tipo || 'admin',
        normalizeLogDocument(
          req.session?.user?.documento || req.session?.user?.documento_real || ''
        ),
        `Asociar registro OATI ${codigo} (antes ${target.codigo || 'sin código'}) desde dashboard`,
        documento,
      ]
    );
    await client.query('COMMIT');

    return res.json({ ok: true, usuario: updateResult.rows[0], registro });
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error al revertir asociación de registro OATI:', rollbackError);
      }
    }

    console.error('Error asociando registro OATI desde dashboard:', error);
    return res.status(500).json({
      ok: false,
      message: 'No fue posible guardar el registro seleccionado. Inténtalo nuevamente.',
    });
  } finally {
    client?.release();
  }
});

router.post('/impersonacion/iniciar', requireDashboardAdminJson, async (req, res) => {
  const usuarioId = Number(req.body?.usuarioId);
  const adminUserSnapshot = { ...(req.session?.user || {}) };

  if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
    return res.status(400).json({
      ok: false,
      message: 'Debes indicar un usuario válido para impersonar.',
    });
  }

  if (req.session?.impersonationAdminUser) {
    return res.status(409).json({
      ok: false,
      message: 'Ya tienes una sesión de impersonación activa.',
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

    await writeDashboardAuditLog(
      adminUserSnapshot,
      'Inicio de impersonación desde dashboard',
      target.documento || String(usuarioId)
    );

    await regenerateSession(req);

    req.session.impersonationAdminUser = adminUserSnapshot;
    req.session.user = {
      ...buildSessionUser(target),
      __impersonating: true,
      __impersonatedBy: adminUserSnapshot?.documento || '',
    };
    await saveSession(req);

    return res.json({
      ok: true,
      redirect: '/milab/inicio',
    });
  } catch (error) {
    if (req?.session && !req.session.user && adminUserSnapshot?.id) {
      req.session.user = adminUserSnapshot;
      try {
        await saveSession(req);
      } catch {
        // Ignored intentionally: preserving original error path.
      }
    }

    console.error('Error iniciando impersonación:', error);
    return res.status(500).json({
      ok: false,
      message: 'No fue posible impersonar la cuenta seleccionada.',
    });
  }
});

router.post(
  '/impersonacion/detener',
  requireRoles(['admin', 'coordinador', 'laboratorista', 'docente', 'estudiante', 'monitor'], {
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
      await writeDashboardAuditLog(
        adminUser,
        'Fin de impersonación desde dashboard',
        currentUser?.documento || currentUser?.id || null
      );

      await regenerateSession(req);
      req.session.user = adminUser;
      await saveSession(req);
    } catch (error) {
      console.error('Error cerrando impersonación:', error);
      return renderApplicationError(res, {
        status: 500,
        message: 'No fue posible volver a tu sesión admin.',
        message2: 'Intenta nuevamente. Si el problema persiste, contacta al soporte de MILab.',
        limit: null,
      });
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
      facultyKeys: [],
      ualIds: [],
      scopeType: null,
      ualNames: [],
    };

    if (dashboardRole === 'coordinador') {
      const coordinatorScope = await resolveCoordinatorScope(client, req.session.user.documento);
      scope.coordinatorDocument = coordinatorScope.coordinatorDocument || null;
      scope.facultyIds = coordinatorScope.facultyIds || [];
      scope.ualIds = coordinatorScope.ualIds || [];
      scope.scopeType = coordinatorScope.scopeType;

      if (
        !coordinatorScope.coordinatorDocument ||
        scope.facultyIds.length === 0 ||
        (scope.scopeType === 'uales' && scope.ualIds.length === 0)
      ) {
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
         FROM dependencia_facultad
         WHERE ${columns.facultadIdColumn} = ANY($1::int[])
         ORDER BY nombre ASC`,
        [scope.facultyIds]
      );
      scope.facultyNames = facultiesRes.rows.map((row) => row.nombre).filter(Boolean);

      const academicFacultiesRes = await client.query(
        `SELECT DISTINCT COALESCE(p.nombre, d.nombre) AS nombre
         FROM dependencia_facultad d
         LEFT JOIN dependencia_facultad p ON p.dependencia_facultad_id = d.padre_id
         WHERE d.dependencia_facultad_id = ANY($1::int[])`,
        [scope.facultyIds]
      );
      scope.facultyKeys = [
        ...new Set(
          academicFacultiesRes.rows
            .map((row) => resolveFacultyKeyFromName(row.nombre))
            .filter(Boolean)
        ),
      ];
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

    const studentCertRows = canSeeStudentCertificates(dashboardRole)
      ? await fetchStudentCertificateRows()
      : [];
    const teacherCertRows = isGlobalDashboardRole(dashboardRole)
      ? await fetchTeacherCertificateRows()
      : [];
    const laboratoristaRows = await fetchLaboratoristaRows();
    const coordinatorRows = availableChartIds.includes('coordinadores')
      ? await fetchCoordinatorRows()
      : [];
    const usuarioRows = needsUsuariosByRole ? await fetchUsuarioRows() : [];
    const usuarioRolesRows = needsUsuariosByRole ? await fetchUsuarioRolesRows() : [];
    const isGlobalRole = isGlobalDashboardRole(dashboardRole);
    const usuariosRegistradosResult =
      needsUsuariosRegistrados && isGlobalRole
        ? await fetchUsuariosRegistradosRows()
        : { rows: [], columns: [] };
    const usuariosPlaceholderRows =
      needsUsuariosRegistrados && dashboardRole === 'admin'
        ? await fetchUsuariosPlaceholderRows()
        : [];
    const roleIndex = buildUsuarioRoleIndex(usuarioRolesRows);

    const filteredStudentCerts = filterStudentRowsByScope(studentCertRows, dashboardRole, scope);
    const filteredTeacherCerts = teacherCertRows;
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
    const usuariosRegistradosRows = isGlobalRole
      ? usuariosRegistradosResult.rows
      : filteredUsuarios;
    const usuariosRegistradosColumns = isGlobalRole ? usuariosRegistradosResult.columns : [];
    const filteredEstudiantes = filteredUsuarios
      .filter((row) => isUsuarioEstudiante(row, roleIndex))
      .map((row) => ({ ...row, __tipo: 'estudiante' }));
    const filteredDocentes = filteredUsuarios
      .filter((row) => isUsuarioDocente(row, roleIndex))
      .map((row) => ({ ...row, __tipo: 'docente' }));

    const chartsData = {
      estudiantes: buildSeriesFromDates(
        filteredEstudiantes.map((row) => row.fecha_creacion),
        filtro
      ),
      docentes: buildSeriesFromDates(
        filteredDocentes.map((row) => row.fecha_creacion),
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
      if (chartId === 'usuariosRegistrados') {
        return {
          ...CHART_DEFINITIONS[chartId],
          total: usuariosRegistradosRows.length,
        };
      }

      return {
        ...CHART_DEFINITIONS[chartId],
        total: totalFromSeries(chartsData[chartId]),
      };
    });

    const scopePresentation = buildScopePresentation(dashboardRole, scope);
    const generalOverview = buildGeneralOverview(availableChartIds, {
      estudiantes: filteredEstudiantes,
      docentes: filteredDocentes,
      laboratoristas: filteredLaboratoristas,
      coordinadores: filteredCoordinators,
      usuariosRegistrados: usuariosRegistradosRows,
    });

    const coberturaOperativa = isGlobalRole
      ? await safeIndicator('la cobertura operativa', () => fetchOperationalCoverage(client))
      : null;
    const actividadPlataforma =
      dashboardRole === 'admin'
        ? await safeIndicator('la actividad de la plataforma', () => fetchPlatformActivity(client))
        : null;

    const pazYSalvo = await buildPazYSalvoIndicators(client, dashboardRole, scope, {
      students: filteredStudentCerts,
      teachers: filteredTeacherCerts,
    });

    const fullTablesData = {
      estudiantes: filteredEstudiantes,
      docentes: filteredDocentes,
      laboratoristas: filteredLaboratoristas,
      coordinadores: filteredCoordinators,
      usuariosRegistrados: usuariosRegistradosRows,
      usuariosPlaceholder: usuariosPlaceholderRows,
    };
    const keepFullTables =
      dashboardRole === 'admin' ? ['usuariosRegistrados', 'usuariosPlaceholder'] : [];
    const { limited: tablesData, meta: tablesMeta } = limitDetailRows(
      fullTablesData,
      keepFullTables
    );

    return res.render('home/dashboard', {
      filtro,
      labelFormat,
      selectedChart,
      availableCharts,
      dashboardRole,
      scopePresentation,
      chartsData,
      tablesData,
      tablesMeta,
      detailRowLimit: DETAIL_ROW_LIMIT,
      pazYSalvo,
      generalOverview,
      coberturaOperativa,
      actividadPlataforma,
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
  buildCertificatePazYSalvoSummary,
  buildGeneralOverview,
  fetchOperationalCoverage,
  fetchPlatformActivity,
  buildPazYSalvoCards,
  buildPazYSalvoIndicators,
  getAvailableChartIds,
  getDashboardRole,
  limitDetailRows,
  fetchCoordinatorRows,
  fetchUsuarioRows,
  fetchUsuariosRegistradosRows,
  fetchUsuariosPlaceholderRows,
  fetchUsuarioRolesRows,
  fetchLaboratoristaRows,
  fetchStudentCertificateRows,
  fetchTeacherCertificateRows,
  resolveDashboardSchemaColumns,
};

module.exports = router;
