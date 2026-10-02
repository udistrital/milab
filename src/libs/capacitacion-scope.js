const pool = require('./db');

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
  'coordinador_facultad',
  'coordinador de facultad',
];

const LAB_TECH_ALIASES = [
  'laboratorista',
  'laboratorista_ud',
  'laboratorista_ual',
  'laboratorista ud',
  'laboratorista ual',
  'laboratoristaud',
  'técnico laboratorista',
  'tecnico laboratorista',
];

function _normalizeToArray(roles) {
  try {
    let list = [];
    if (Array.isArray(roles)) list = roles;
    else if (typeof roles === 'string')
      list = roles
        .split(',')
        .map((r) => String(r || '').trim())
        .filter(Boolean);
    else if (roles != null) list = [String(roles)];
    const normalized = [];
    const seen = new Set();
    for (const raw of list) {
      const r = String(raw || '').trim();
      if (!r) continue;
      const lower = r.toLowerCase();
      const ascii = lower
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '_');
      const variants = new Set([lower, ascii]);
      if (lower === 'coordinador_general') variants.add('coordinador general');
      if (lower === 'coordinador general') variants.add('coordinador_general');
      if (
        lower.indexOf('coordinador_general') !== -1 ||
        ascii.indexOf('coordinador_general') !== -1 ||
        lower.indexOf('coordinacion_general') !== -1 ||
        ascii.indexOf('coordinacion_general') !== -1
      ) {
        variants.add('coordinador_general');
        variants.add('admin');
      }
      if (lower === 'coordinador') {
        variants.add('coordinador_facultad');
        variants.add('coordinador de facultad');
      }
      if (lower === 'coordinador_facultad' || lower === 'coordinador de facultad')
        variants.add('coordinador');
      if (lower === 'administrador' || lower === 'administradora') variants.add('admin');
      if (lower === 'admin') {
        variants.add('administrador');
        variants.add('administradora');
      }
      if (
        lower === 'laboratorista_ud' ||
        lower === 'laboratorista ud' ||
        lower === 'laboratoristaud' ||
        lower === 'laboratorista_ual' ||
        lower === 'laboratorista ual'
      ) {
        variants.add('laboratorista');
      }
      if (lower === 'laboratorista') variants.add('laboratorista_ud');
      if (lower === 'estudiante') variants.add('alumno');
      if (lower === 'alumno') variants.add('estudiante');
      if (lower === 'docente') variants.add('profesor');
      if (lower === 'profesor') variants.add('docente');
      for (const v of variants) {
        if (!seen.has(v)) {
          seen.add(v);
          normalized.push(v);
        }
      }
    }
    return normalized;
  } catch (err) {
    console.warn('[capacitacion-scope:_normalizeToArray] error:', err && err.message);
    return [];
  }
}

function _getUserRolesSafe(user) {
  try {
    if (!user) return [];
    if (Array.isArray(user.roles) && user.roles.length > 0) return [...user.roles];
    if (Array.isArray(user.rol) && user.rol.length > 0) return [...user.rol];
    if (typeof user.tipo === 'string' && user.tipo.trim()) return [String(user.tipo).trim()];
    if (typeof user.rol === 'string' && user.rol.trim()) return [String(user.rol).trim()];
    if (typeof user.role === 'string' && user.role.trim()) return [String(user.role).trim()];
    return [];
  } catch {
    return [];
  }
}

function isAdminRole(user) {
  try {
    const userNorm = _normalizeToArray(_getUserRolesSafe(user));
    const adminNorm = _normalizeToArray(ADMIN_ALIASES);
    return adminNorm.some((role) => userNorm.includes(role));
  } catch (err) {
    console.warn('[capacitacion-scope:isAdminRole] error:', err && err.message);
    return false;
  }
}

function isLaboratoristaRole(user) {
  try {
    const userNorm = _normalizeToArray(_getUserRolesSafe(user));
    const labNorm = _normalizeToArray(LAB_TECH_ALIASES);
    return labNorm.some((role) => userNorm.includes(role));
  } catch (err) {
    console.warn('[capacitacion-scope:isLaboratoristaRole] error:', err && err.message);
    return false;
  }
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
