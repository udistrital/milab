const pool = require('./db');

let monitorSchemaEnsured = false;

function normalizeText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

async function ensureMonitorSchema(executor = pool) {
  if (monitorSchemaEnsured) {
    return;
  }

  await executor.query(`
    CREATE TABLE IF NOT EXISTS monitor (
      documento VARCHAR(50) PRIMARY KEY,
      nombre VARCHAR(255) NOT NULL,
      correo VARCHAR(255) NOT NULL UNIQUE,
      numero_contrato VARCHAR(100),
      tipo_vinculacion VARCHAR(100),
      fecha_inicio DATE,
      fecha_fin DATE,
      soporte_contrato VARCHAR(1000),
      usuario_id BIGINT REFERENCES usuario(id) ON DELETE SET NULL,
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await executor.query(`CREATE INDEX IF NOT EXISTS idx_monitor_usuario_id ON monitor(usuario_id)`);

  monitorSchemaEnsured = true;
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
