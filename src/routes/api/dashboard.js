const express = require('express');

const pool = require('../../libs/db');
const { resolveAcademicFacultyName, resolveCoordinatorScope } = require('../../libs/faculty-scope');
const { normalizeRoles } = require('../../libs/roles');
const { requireRoles } = require('../middlewares/auth');

const router = express.Router();

const requireDashboardAccess = requireRoles(['admin', 'coordinador', 'laboratorista'], {
  message: '¡Acceso denegado!',
  message2: 'No tienes permisos para ver el dashboard',
  limit: 'noSession',
});

const CHART_DEFINITIONS = {
  estudiantes: {
    id: 'estudiantes',
    optionLabel: 'Certificados de estudiantes',
    cardLabel: 'Certificados estudiantes',
    tone: 'tone-students',
    title: 'Certificados de estudiantes',
    summary:
      'Mide la emisión de certificados de estudiantes dentro del alcance disponible para tu rol.',
  },
  docentes: {
    id: 'docentes',
    optionLabel: 'Certificados de docentes',
    cardLabel: 'Certificados docentes',
    tone: 'tone-teachers',
    title: 'Certificados de docentes',
    summary:
      'Visualiza el comportamiento de los certificados emitidos para docentes en el periodo elegido.',
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
      'estudiantes',
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

function normalizeIntegerArray(values) {
  return Array.isArray(values)
    ? values.map((value) => Number(value)).filter((value) => Number.isInteger(value))
    : [];
}

async function resolveLaboratoristaScope(client, authDocument) {
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
    'SELECT ual_id FROM laboratorista_ual WHERE laboratorista_documento_id = $1 ORDER BY ual_id ASC',
    [laboratorista.documento]
  );

  const ualIds = assignedUalsRes.rows.map((row) => Number(row.ual_id)).filter(Boolean);

  let ualNames = [];
  let facultyIds = [];
  let facultyNames = [];

  if (ualIds.length) {
    const ualInfoRes = await client.query(
      'SELECT ual_id, nombre, facultad_id FROM ual WHERE ual_id = ANY($1::int[]) ORDER BY nombre ASC',
      [ualIds]
    );
    ualNames = ualInfoRes.rows.map((row) => row.nombre).filter(Boolean);
    facultyIds = [
      ...new Set(ualInfoRes.rows.map((row) => Number(row.facultad_id)).filter(Boolean)),
    ];
  }

  if (facultyIds.length) {
    const facultyInfoRes = await client.query(
      'SELECT nombre FROM facultad WHERE facultad_id = ANY($1::int[]) ORDER BY nombre ASC',
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

async function fetchStudentCertificateRows(client) {
  const result = await client.query(
    `SELECT ce.fecha_creacion, u.carrera
     FROM certificado_estudiante ce
     JOIN usuario u ON u.id = ce.usuario_id
     WHERE ce.fecha_creacion IS NOT NULL`
  );
  return result.rows;
}

async function fetchTeacherCertificateRows(client) {
  const result = await client.query(
    `SELECT cd.fecha_creacion
     FROM certificado_docente cd
     WHERE cd.fecha_creacion IS NOT NULL`
  );
  return result.rows;
}

async function fetchSanctionRows(client) {
  const result = await client.query(
    `SELECT m.fecha_multa, m.con_estado_multa, u.ual_id, u.facultad_id
     FROM multa m
     JOIN ual u ON u.ual_id = m.ual_id
     WHERE m.fecha_multa IS NOT NULL`
  );
  return result.rows;
}

async function fetchLaboratoristaRows(client) {
  const result = await client.query(
    `SELECT
       l.documento,
       l.fecha_creacion,
       ARRAY_REMOVE(ARRAY_AGG(DISTINCT lu.ual_id), NULL) AS ual_ids,
       ARRAY_REMOVE(ARRAY_AGG(DISTINCT u.facultad_id), NULL) AS faculty_ids
     FROM laboratorista l
     LEFT JOIN laboratorista_ual lu ON lu.laboratorista_documento_id = l.documento
     LEFT JOIN ual u ON u.ual_id = lu.ual_id
     GROUP BY l.documento, l.fecha_creacion`
  );
  return result.rows;
}

async function fetchCoordinatorRows(client) {
  const result = await client.query(
    `SELECT
       c.documento,
       c.fecha_creacion,
       ARRAY_REMOVE(ARRAY_AGG(DISTINCT cf.facultad_id), NULL) AS faculty_ids
     FROM coordinador c
     LEFT JOIN coordinador_facultad cf ON cf.coordinador_documento_id = c.documento
     GROUP BY c.documento, c.fecha_creacion`
  );
  return result.rows;
}

async function fetchUsuarioRows(client) {
  const result = await client.query(
    `SELECT
       u.documento,
       u.fecha_creacion,
       u.carrera,
       ARRAY_REMOVE(ARRAY_AGG(DISTINCT cf.facultad_id), NULL) AS coordinator_faculty_ids,
       ARRAY_REMOVE(ARRAY_AGG(DISTINCT ual.facultad_id), NULL) AS laboratorista_faculty_ids
     FROM usuario u
     LEFT JOIN coordinador c ON c.usuario_id = u.id
     LEFT JOIN coordinador_facultad cf ON cf.coordinador_documento_id = c.documento
     LEFT JOIN laboratorista l ON l.usuario_id = u.id
     LEFT JOIN laboratorista_ual lu ON lu.laboratorista_documento_id = l.documento
     LEFT JOIN ual ON ual.ual_id = lu.ual_id
     GROUP BY u.documento, u.fecha_creacion, u.carrera`
  );
  return result.rows;
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
    return rows.filter((row) => facultyIds.has(Number(row.facultad_id)));
  }

  const ualIds = new Set(scope.ualIds || []);
  return rows.filter((row) => ualIds.has(Number(row.ual_id)));
}

function filterLaboratoristaRowsByScope(rows, role, scope) {
  if (role === 'admin') {
    return rows;
  }

  if (role === 'coordinador') {
    const facultyIds = new Set(scope.facultyIds || []);
    return rows.filter((row) =>
      normalizeIntegerArray(row.faculty_ids).some((facultyId) => facultyIds.has(facultyId))
    );
  }

  const ualIds = new Set(scope.ualIds || []);
  return rows.filter((row) =>
    normalizeIntegerArray(row.ual_ids).some((ualId) => ualIds.has(ualId))
  );
}

function filterCoordinatorRowsByScope(rows, role, scope) {
  if (role === 'admin') {
    return rows;
  }

  if (role !== 'coordinador') {
    return [];
  }

  const facultyIds = new Set(scope.facultyIds || []);
  return rows.filter((row) =>
    normalizeIntegerArray(row.faculty_ids).some((facultyId) => facultyIds.has(facultyId))
  );
}

function filterUsuarioRowsByScope(rows, role, scope) {
  if (role === 'admin') {
    return rows;
  }

  if (role !== 'coordinador') {
    return [];
  }

  const facultyIds = new Set(scope.facultyIds || []);
  const facultyNamesSet = new Set(
    (scope.facultyNames || []).map((name) => String(name || '').trim())
  );

  return rows.filter((row) => {
    const studentFaculty = resolveAcademicFacultyName(row.carrera || '');
    return (
      facultyNamesSet.has(studentFaculty) ||
      normalizeIntegerArray(row.coordinator_faculty_ids).some((facultyId) =>
        facultyIds.has(facultyId)
      ) ||
      normalizeIntegerArray(row.laboratorista_faculty_ids).some((facultyId) =>
        facultyIds.has(facultyId)
      )
    );
  });
}

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

    let scope = {
      facultyIds: [],
      facultyNames: [],
      ualIds: [],
      ualNames: [],
    };

    if (dashboardRole === 'coordinador') {
      const coordinatorScope = await resolveCoordinatorScope(client, req.session.user.documento);
      scope.facultyIds = coordinatorScope.facultyIds || [];

      if (!coordinatorScope.coordinatorDocument || scope.facultyIds.length === 0) {
        return res.render('home/message_error', {
          message: 'No tienes alcance para monitoreo.',
          message2: 'El coordinador no tiene facultades asociadas.',
          limit: null,
        });
      }

      const facultiesRes = await client.query(
        'SELECT nombre FROM facultad WHERE facultad_id = ANY($1::int[]) ORDER BY nombre ASC',
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

    const [
      studentRows,
      teacherRows,
      sanctionRows,
      laboratoristaRows,
      coordinatorRows,
      usuarioRows,
    ] = await Promise.all([
      availableChartIds.includes('estudiantes')
        ? fetchStudentCertificateRows(client)
        : Promise.resolve([]),
      availableChartIds.includes('docentes')
        ? fetchTeacherCertificateRows(client)
        : Promise.resolve([]),
      fetchSanctionRows(client),
      fetchLaboratoristaRows(client),
      availableChartIds.includes('coordinadores')
        ? fetchCoordinatorRows(client)
        : Promise.resolve([]),
      availableChartIds.includes('usuariosRegistrados')
        ? fetchUsuarioRows(client)
        : Promise.resolve([]),
    ]);

    const filteredStudents = filterStudentRowsByScope(studentRows, dashboardRole, scope);
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

    const chartsData = {
      estudiantes: buildSeriesFromDates(
        filteredStudents.map((row) => row.fecha_creacion),
        filtro
      ),
      docentes: buildSeriesFromDates(
        teacherRows.map((row) => row.fecha_creacion),
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
        filteredUsuarios.map((row) => row.fecha_creacion),
        filtro
      ),
    };

    const availableCharts = availableChartIds.map((chartId) => ({
      ...CHART_DEFINITIONS[chartId],
      total: totalFromSeries(
        chartId === 'sanciones'
          ? chartsData.multas
          : chartId === 'sancionesActivas'
            ? chartsData.multasActivas
            : chartId === 'sancionesSaldadas'
              ? chartsData.multasSaldadas
              : chartsData[chartId]
      ),
    }));

    const scopePresentation = buildScopePresentation(dashboardRole, scope);
    const scopeCounters = [
      dashboardRole === 'admin'
        ? { label: 'Cobertura', value: 'General' }
        : dashboardRole === 'coordinador'
          ? { label: 'Facultades', value: String(scope.facultyIds.length) }
          : { label: 'Laboratorios', value: String(scope.ualIds.length) },
      { label: 'Indicadores', value: String(availableCharts.length) },
      { label: 'Sanciones visibles', value: String(totalFromSeries(chartsData.multas)) },
    ];

    return res.render('home/dashboard', {
      filtro,
      labelFormat,
      selectedChart,
      availableCharts,
      dashboardRole,
      scopePresentation,
      scopeCounters,
      chartsData,
    });
  } catch (error) {
    console.error('Error en dashboard:', error);
    return res.status(500).send('Error en dashboard');
  } finally {
    if (client) {
      client.release();
    }
  }
});

module.exports = router;
