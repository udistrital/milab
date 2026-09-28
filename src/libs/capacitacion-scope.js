const pool = require('./db');
const { getUserRoles, normalizeRoleListForMatch } = require('../routes/middlewares/auth');

const ADMIN_ALIASES = [
  'admin',
  'administrador',
  'administradora',
  'coordinador_general',
  'coordinador general',
  'coordinador_general_laboratorios',
  'coordinacion general',
  'coordinación general',
  'coordinacion',
  'coordinación',
  'coordinador',
  'coordinadora',
];

const LAB_TECH_ALIASES = [
  'laboratorista',
  'laboratorista_ud',
  'laboratorista_ual',
  'laboratorista ud',
  'laboratorista ual',
  'técnico laboratorista',
  'tecnico laboratorista',
];

function isAdminRole(user) {
  const userNorm = normalizeRoleListForMatch(getUserRoles(user));
  if (userNorm.size === 0) return false;
  for (const alias of ADMIN_ALIASES) {
    if (userNorm.has(String(alias).toLowerCase())) return true;
  }
  return false;
}

function isLaboratoristaRole(user) {
  const userNorm = normalizeRoleListForMatch(getUserRoles(user));
  if (userNorm.size === 0) return false;
  for (const alias of LAB_TECH_ALIASES) {
    if (userNorm.has(String(alias).toLowerCase())) return true;
  }
  return false;
}

function getUserDocumento(user) {
  if (!user) return '';
  const raw = user.documento || user.doc || user.id_documento || '';
  return String(raw || '').trim();
}

async function resolveLaboratoristaScope(req) {
  const user = req?.session?.user || null;
  const documento = getUserDocumento(user);
  const admin = isAdminRole(user);
  const laboratorista = isLaboratoristaRole(user);

  const base = {
    isAdmin: admin,
    isLaboratorista: laboratorista,
    documento,
    resolvedFrom: admin ? 'role_admin' : laboratorista ? 'role_laboratorista' : 'unknown',
    facultyIds: [],
    ualIds: [],
    facultades: [],
    laboratorios: [],
    cursoFilterRequired: !admin,
  };

  if (admin || !laboratorista || !documento) {
    return base;
  }

  const rows = await pool.query(
    `SELECT DISTINCT
       u.ual_id,
       u.nombre AS nombre_laboratorio,
       u.codigo_abreviacion,
       u.facultad_id,
       f.nombre AS nombre_facultad
     FROM laboratorista_ual lu
     JOIN ual u
       ON u.ual_id = lu.ual_id
      AND u.activo = TRUE
     JOIN facultad f
       ON f.facultad_id = u.facultad_id
      AND f.activo = TRUE
     WHERE lu.laboratorista_documento_id = $1
       AND lu.activo = TRUE
     ORDER BY f.nombre ASC, u.nombre ASC`,
    [documento]
  );

  if (rows.rows.length === 0) {
    return base;
  }

  const uniqueFac = new Map();
  const uniqueUal = new Map();
  rows.rows.forEach((r) => {
    uniqueFac.set(Number(r.facultad_id), {
      facultad_id: Number(r.facultad_id),
      nombre: r.nombre_facultad,
    });
    uniqueUal.set(Number(r.ual_id), {
      ual_id: Number(r.ual_id),
      nombre: r.nombre_laboratorio,
      codigo_abreviacion: r.codigo_abreviacion,
      facultad_id: Number(r.facultad_id),
    });
  });

  return {
    ...base,
    facultyIds: Array.from(uniqueFac.keys()),
    ualIds: Array.from(uniqueUal.keys()),
    facultades: Array.from(uniqueFac.values()),
    laboratorios: Array.from(uniqueUal.values()),
  };
}

module.exports = {
  isAdminRole,
  isLaboratoristaRole,
  getUserDocumento,
  resolveLaboratoristaScope,
};
