const pool = require('./db');
const { getPrimaryRole, normalizeRoles } = require('./roles');

const INTERNAL_PLACEHOLDER_EMAIL_DOMAIN = 'placeholder.milab.local';

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function buildPlaceholderEmail(documento) {
  const normalizedDocumento = String(documento || '').trim();
  if (!normalizedDocumento) {
    return `no-email@${INTERNAL_PLACEHOLDER_EMAIL_DOMAIN}`;
  }

  return `no-email+${normalizedDocumento}@${INTERNAL_PLACEHOLDER_EMAIL_DOMAIN}`;
}

function isPlaceholderEmail(correo) {
  const normalizedCorreo = normalizeEmail(correo);
  return normalizedCorreo.endsWith(`@${INTERNAL_PLACEHOLDER_EMAIL_DOMAIN}`);
}

function isSyntheticInstitutionalEmail(correo, documento) {
  const normalizedDocumento = String(documento || '').trim();
  const normalizedCorreo = normalizeEmail(correo);

  if (!normalizedDocumento || !normalizedCorreo) {
    return false;
  }

  return normalizedCorreo === `${normalizedDocumento}@udistrital.edu.co`;
}

async function fetchUserByEmail(correo) {
  if (!correo) return null;

  const result = await pool.query(
    `
      SELECT
        u.id,
        u.correo,
        u.documento,
        u.nombre,
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
      WHERE LOWER(u.correo) = LOWER($1)
      GROUP BY u.id
      LIMIT 1
    `,
    [correo]
  );

  return result.rows[0] || null;
}

async function fetchUserById(id) {
  if (!id) return null;

  const result = await pool.query(
    `
      SELECT
        u.id,
        u.correo,
        u.documento,
        u.nombre,
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
      WHERE u.id = $1
      GROUP BY u.id
      LIMIT 1
    `,
    [id]
  );

  return result.rows[0] || null;
}

async function upsertUsuarioByDocumento({ documento, nombre, correo, codigo, estado, carrera }) {
  const normalizedDocumento = String(documento || '').trim();
  if (!normalizedDocumento) return null;

  const safeCorreo = normalizeEmail(correo) || buildPlaceholderEmail(normalizedDocumento);
  const safeNombre = typeof nombre === 'string' && nombre.trim() ? nombre.trim() : 'Sin nombre';

  const result = await pool.query(
    `
      INSERT INTO usuario (documento, correo, nombre, codigo, estado, carrera)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (documento) DO UPDATE
      SET nombre = CASE
            WHEN usuario.nombre IS NULL OR usuario.nombre = '' THEN EXCLUDED.nombre
            ELSE usuario.nombre
          END,
          correo = CASE
            WHEN usuario.correo IS NULL OR usuario.correo = '' THEN EXCLUDED.correo
            WHEN usuario.correo = usuario.documento || '@udistrital.edu.co' THEN EXCLUDED.correo
            WHEN usuario.correo LIKE 'no-email+%@placeholder.milab.local' THEN EXCLUDED.correo
            ELSE usuario.correo
          END,
          codigo = COALESCE(usuario.codigo, EXCLUDED.codigo),
          estado = COALESCE(usuario.estado, EXCLUDED.estado),
          carrera = COALESCE(usuario.carrera, EXCLUDED.carrera),
          fecha_modificacion = CURRENT_TIMESTAMP
      RETURNING id
    `,
    [normalizedDocumento, safeCorreo, safeNombre, codigo || null, estado || null, carrera || null]
  );

  return result.rows[0]?.id || null;
}

async function ensurePerfilEstudiante({ documento, nombre, codigo, programa, estado, correo }) {
  const usuarioId = await upsertUsuarioByDocumento({
    documento,
    nombre,
    correo,
    codigo,
    estado,
    carrera: programa,
  });

  if (!usuarioId) return null;

  await pool.query(
    `
      INSERT INTO perfil_estudiante (usuario_id, documento, nombre, codigo, programa, estado)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (usuario_id) DO UPDATE
      SET documento = EXCLUDED.documento,
          nombre = COALESCE(perfil_estudiante.nombre, EXCLUDED.nombre),
          codigo = COALESCE(perfil_estudiante.codigo, EXCLUDED.codigo),
          programa = COALESCE(perfil_estudiante.programa, EXCLUDED.programa),
          estado = COALESCE(perfil_estudiante.estado, EXCLUDED.estado),
          fecha_modificacion = CURRENT_TIMESTAMP
    `,
    [usuarioId, documento || '', nombre || null, codigo || null, programa || null, estado || null]
  );

  return usuarioId;
}

async function ensurePerfilDocente({ documento, nombre, estado, correo }) {
  const usuarioId = await upsertUsuarioByDocumento({
    documento,
    nombre,
    correo,
    estado,
  });

  if (!usuarioId) return null;

  await pool.query(
    `
      INSERT INTO perfil_docente (usuario_id, documento, nombre, estado)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (usuario_id) DO UPDATE
      SET documento = EXCLUDED.documento,
          nombre = COALESCE(perfil_docente.nombre, EXCLUDED.nombre),
          estado = COALESCE(perfil_docente.estado, EXCLUDED.estado),
          fecha_modificacion = CURRENT_TIMESTAMP
    `,
    [usuarioId, documento || '', nombre || null, estado || null]
  );

  return usuarioId;
}

async function resolveUsuarioIdForStudent({ documento, codigo }) {
  const docParam = documento ? String(documento).trim() : null;
  const codigoParam = codigo ? String(codigo).trim() : null;

  if (!docParam && !codigoParam) return null;

  const result = await pool.query(
    `
      SELECT pe.usuario_id
      FROM perfil_estudiante pe
      WHERE ($1::text IS NOT NULL AND pe.documento = $1::text)
         OR ($2::text IS NOT NULL AND pe.codigo::text = $2::text)
      LIMIT 1
    `,
    [docParam, codigoParam]
  );

  return result.rows[0]?.usuario_id || null;
}

async function resolveUsuarioIdForDocente(documento) {
  const docParam = documento ? String(documento).trim() : null;
  if (!docParam) return null;

  const result = await pool.query(
    `
      SELECT usuario_id
      FROM perfil_docente
      WHERE documento = $1::text
      LIMIT 1
    `,
    [docParam]
  );

  return result.rows[0]?.usuario_id || null;
}

function buildSessionUser(row) {
  if (!row) return null;
  const roles = normalizeRoles(row.roles);
  const primaryRole = getPrimaryRole(roles);

  return {
    id: row.id,
    correo: row.correo,
    documento: row.documento,
    documento_real: row.documento,
    nombre: row.nombre,
    roles,
    tipo: primaryRole,
  };
}

module.exports = {
  buildSessionUser,
  ensurePerfilDocente,
  ensurePerfilEstudiante,
  fetchUserByEmail,
  fetchUserById,
  buildPlaceholderEmail,
  isSyntheticInstitutionalEmail,
  isPlaceholderEmail,
  resolveUsuarioIdForDocente,
  resolveUsuarioIdForStudent,
  upsertUsuarioByDocumento,
};
