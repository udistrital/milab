const pool = require('./db');

function normalizeText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

async function ensureMonitorSchema(executor = pool) {
  const result = await executor.query(`SELECT to_regclass('milab.monitor') AS monitor_table`);
  if (!result.rows[0]?.monitor_table) {
    throw new Error(
      'No existe milab.monitor. La tabla debe aprovisionarse con un usuario administrador de base de datos.'
    );
  }
}

async function fetchMonitorByDocumento(documento, executor = pool) {
  await ensureMonitorSchema(executor);

  const normalizedDocumento = normalizeText(documento);
  if (!normalizedDocumento) {
    return null;
  }

  const result = await executor.query(
    `
      SELECT
        documento,
        nombre,
        correo,
        numero_contrato,
        tipo_vinculacion,
        fecha_inicio,
        fecha_fin,
        soporte_contrato,
        usuario_id,
        activo
      FROM monitor
      WHERE documento = $1
      LIMIT 1
    `,
    [normalizedDocumento]
  );

  return result.rows[0] || null;
}

async function upsertMonitorProfile(
  {
    documento,
    nombre,
    correo,
    numeroContrato = null,
    tipoVinculacion = null,
    fechaInicio = null,
    fechaFin = null,
    soporteContrato = null,
    usuarioId = null,
    activo = true,
  },
  executor = pool
) {
  await ensureMonitorSchema(executor);

  const normalizedDocumento = normalizeText(documento);
  const normalizedNombre = normalizeText(nombre);
  const normalizedCorreo = normalizeText(correo).toLowerCase();

  if (!normalizedDocumento || !normalizedNombre || !normalizedCorreo) {
    throw new Error('Los datos base del monitor son obligatorios.');
  }

  await executor.query(
    `
      INSERT INTO monitor (
        documento,
        nombre,
        correo,
        numero_contrato,
        tipo_vinculacion,
        fecha_inicio,
        fecha_fin,
        soporte_contrato,
        usuario_id,
        activo
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (documento) DO UPDATE
      SET nombre = EXCLUDED.nombre,
          correo = EXCLUDED.correo,
          numero_contrato = EXCLUDED.numero_contrato,
          tipo_vinculacion = EXCLUDED.tipo_vinculacion,
          fecha_inicio = EXCLUDED.fecha_inicio,
          fecha_fin = EXCLUDED.fecha_fin,
          soporte_contrato = EXCLUDED.soporte_contrato,
          usuario_id = EXCLUDED.usuario_id,
          activo = EXCLUDED.activo,
          fecha_modificacion = CURRENT_TIMESTAMP
    `,
    [
      normalizedDocumento,
      normalizedNombre,
      normalizedCorreo,
      normalizeText(numeroContrato) || null,
      normalizeText(tipoVinculacion) || null,
      fechaInicio || null,
      fechaFin || null,
      normalizeText(soporteContrato) || null,
      Number.isInteger(Number(usuarioId)) && Number(usuarioId) > 0 ? Number(usuarioId) : null,
      Boolean(activo),
    ]
  );
}

module.exports = {
  ensureMonitorSchema,
  fetchMonitorByDocumento,
  upsertMonitorProfile,
};
