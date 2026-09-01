const pool = require('./db');

const SANCTION_TYPES = [
  'Suspensión temporal del acceso al laboratorio',
  'Realizar cursos de buenas prácticas o seguridad',
  'Amonestación verbal o escrita',
  'Firma de compromiso de buen uso',
  'Apoyo en organización del laboratorio',
  'Reposición de materiales o insumos',
  'Reemplazar exactamente lo que dañó o perdió',
];

function normalizeSanctionType(value) {
  return (value || '').toString().trim();
}

function isValidSanctionType(value) {
  return SANCTION_TYPES.includes(normalizeSanctionType(value));
}

function normalizeConfigRow(row) {
  if (!row) {
    return {
      facultad_id: null,
      permite_crear_multas_activas_directas: false,
      permite_saldar_multas_directas: false,
      fecha_ultima_modificacion: null,
      documento_ultimo_autorizador: null,
      accion_ultima: 'inicial',
    };
  }
  return {
    facultad_id: row.facultad_id ?? null,
    permite_crear_multas_activas_directas: row.permite_crear_multas_activas_directas === true,
    permite_saldar_multas_directas: row.permite_saldar_multas_directas === true,
    fecha_ultima_modificacion: row.fecha_ultima_modificacion ?? null,
    documento_ultimo_autorizador: row.documento_ultimo_autorizador ?? null,
    accion_ultima: row.accion_ultima ?? 'inicial',
  };
}

async function fetchMultaConfigsForFacultyIds(facultyIds) {
  const ids = Array.isArray(facultyIds) ? facultyIds.filter((v) => Number.isFinite(Number(v))) : [];
  const map = new Map();
  if (ids.length === 0) {
    return map;
  }
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
  const query = `SELECT * FROM config_facultad_multas WHERE facultad_id IN (${placeholders})`;
  const result = await pool.query(query, ids);
  for (const row of result.rows) {
    map.set(Number(row.facultad_id), normalizeConfigRow(row));
  }
  for (const id of ids) {
    const key = Number(id);
    if (!map.has(key)) {
      map.set(key, normalizeConfigRow({ facultad_id: key }));
    }
  }
  return map;
}

async function resolveMultaConfigForFacultyId(facultyId) {
  if (!Number.isFinite(Number(facultyId))) {
    return normalizeConfigRow(null);
  }
  const query = 'SELECT * FROM config_facultad_multas WHERE facultad_id = $1 LIMIT 1';
  const result = await pool.query(query, [Number(facultyId)]);
  return normalizeConfigRow(result.rows[0]);
}

async function resolveMultaConfigForUalId(ualId) {
  if (!Number.isFinite(Number(ualId))) {
    return normalizeConfigRow(null);
  }
  const query = `
    SELECT cfm.*
    FROM ual
    LEFT JOIN config_facultad_multas cfm ON cfm.facultad_id = ual.facultad_id
    WHERE ual.ual_id = $1
    LIMIT 1
  `;
  const result = await pool.query(query, [Number(ualId)]);
  return normalizeConfigRow(result.rows[0]);
}

async function resolveMultaConfigForMultaId(multaId) {
  if (!Number.isFinite(Number(multaId))) {
    return normalizeConfigRow(null);
  }
  const query = `
    SELECT cfm.*
    FROM multa
    JOIN ual ON ual.ual_id = multa.ual_id
    LEFT JOIN config_facultad_multas cfm ON cfm.facultad_id = ual.facultad_id
    WHERE multa.id = $1
    LIMIT 1
  `;
  const result = await pool.query(query, [Number(multaId)]);
  return normalizeConfigRow(result.rows[0]);
}

async function upsertConfigForFacultyId(facultyId, patch, documentoAutorizador, accion) {
  const facultyIdNum = Number(facultyId);
  if (!Number.isFinite(facultyIdNum)) {
    throw new Error('facultad_id inválido');
  }
  const finalPatch = patch || {};
  const permiteCrear =
    typeof finalPatch.permite_crear_multas_activas_directas === 'boolean'
      ? finalPatch.permite_crear_multas_activas_directas
      : null;
  const permiteSaldar =
    typeof finalPatch.permite_saldar_multas_directas === 'boolean'
      ? finalPatch.permite_saldar_multas_directas
      : null;

  const columns = ['facultad_id'];
  const values = [facultyIdNum];
  const updates = [];

  if (permiteCrear !== null) {
    columns.push('permite_crear_multas_activas_directas');
    values.push(permiteCrear);
    updates.push(
      `permite_crear_multas_activas_directas = EXCLUDED.permite_crear_multas_activas_directas`
    );
  }
  if (permiteSaldar !== null) {
    columns.push('permite_saldar_multas_directas');
    values.push(permiteSaldar);
    updates.push(`permite_saldar_multas_directas = EXCLUDED.permite_saldar_multas_directas`);
  }

  columns.push('fecha_ultima_modificacion');
  values.push(new Date());
  updates.push(`fecha_ultima_modificacion = EXCLUDED.fecha_ultima_modificacion`);

  if (typeof documentoAutorizador === 'string' && documentoAutorizador.trim().length > 0) {
    columns.push('documento_ultimo_autorizador');
    values.push(documentoAutorizador.trim());
    updates.push(`documento_ultimo_autorizador = EXCLUDED.documento_ultimo_autorizador`);
  }

  if (typeof accion === 'string' && accion.trim().length > 0) {
    columns.push('accion_ultima');
    values.push(accion.trim());
    updates.push(`accion_ultima = EXCLUDED.accion_ultima`);
  }

  const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
  const conflict =
    updates.length > 0
      ? ` ON CONFLICT (facultad_id) DO UPDATE SET ${updates.join(', ')} `
      : ' ON CONFLICT (facultad_id) DO NOTHING ';

  const query = `
    INSERT INTO config_facultad_multas (${columns.join(', ')})
    VALUES (${placeholders})
    ${conflict}
    RETURNING *
  `;
  const result = await pool.query(query, values);
  return normalizeConfigRow(result.rows && result.rows[0] ? result.rows[0] : null);
}

async function logConfigChangeToAuditoria(
  poolOrClient,
  documentoAutorizador,
  accion,
  descripcion,
  meta
) {
  const client = poolOrClient || pool;
  const modulo = 'prestamos';
  const submodulo = 'autorizaciones_multas_facultad';
  const now = new Date();
  const descripcionFinal =
    typeof descripcion === 'string' && descripcion.length > 0
      ? descripcion
      : 'Cambio de configuración de multas por facultad';
  const metaText = meta && typeof meta === 'object' ? JSON.stringify(meta) : null;
  const query = `
    INSERT INTO auditoria (
      documento,
      modulo,
      submodulo,
      accion,
      descripcion,
      fecha,
      datos_adicionales
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
  `;
  try {
    await client.query(query, [
      documentoAutorizador || null,
      modulo,
      submodulo,
      accion || 'CONFIG_MULTAS',
      descripcionFinal,
      now,
      metaText,
    ]);
  } catch (err) {
    console.error(
      '[multa-config] logConfigChangeToAuditoria falló (no abortante):',
      err && err.message ? err.message : err
    );
  }
}

module.exports = {
  SANCTION_TYPES,
  normalizeSanctionType,
  isValidSanctionType,
  fetchMultaConfigsForFacultyIds,
  resolveMultaConfigForFacultyId,
  resolveMultaConfigForUalId,
  resolveMultaConfigForMultaId,
  upsertConfigForFacultyId,
  logConfigChangeToAuditoria,
};
