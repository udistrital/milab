const { normalizeLogDocument } = require('./account-email');
const { getUserRoles } = require('../routes/middlewares/auth');

function hasClaimRole(user, role) {
  return getUserRoles(user).some((value) => String(value).trim().toLowerCase() === role);
}

function claimError(status, message) {
  return Object.assign(new Error(message), { status });
}

function validateClaimText(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) {
    throw claimError(400, 'Escribe un texto de 1 a 500 caracteres.');
  }
  return value.trim();
}

function validateClaimId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw claimError(400, 'El identificador seleccionado no es válido.');
  }
  return id;
}

async function resolveClaimStudent(client, user) {
  if (!hasClaimRole(user, 'estudiante') || user?.__impersonating) {
    throw claimError(403, 'Solo el estudiante titular puede presentar una reclamación.');
  }
  const result = await client.query(
    'SELECT id FROM usuario WHERE documento = $1 AND activo = TRUE LIMIT 1',
    [String(user.documento_real || user.documento || '')]
  );
  if (!result.rows.length) throw claimError(403, 'No encontramos tu cuenta de estudiante.');
  return result.rows[0].id;
}

async function resolveClaimLaboratorista(client, user) {
  if (!hasClaimRole(user, 'laboratorista') || user?.__impersonating) {
    throw claimError(403, 'Solo el laboratorista responsable puede responder esta reclamación.');
  }
  const result = await client.query(
    `SELECT documento FROM laboratorista
     WHERE (documento = $1 OR n_usuario = $1) AND activo = TRUE LIMIT 1`,
    [String(user.documento_real || user.documento || '')]
  );
  if (!result.rows.length)
    throw claimError(403, 'No encontramos un laboratorista activo asociado a tu cuenta.');
  return result.rows[0].documento;
}

async function writeClaimAudit(client, user, action, claimId) {
  await client.query(
    'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
    [
      user.tipo,
      normalizeLogDocument(user.documento_real || user.documento),
      action,
      `Reclamación #${claimId}`,
    ]
  );
}

async function createSanctionClaim(client, user, multaId, text) {
  const texto = validateClaimText(text);
  const studentId = await resolveClaimStudent(client, user);
  // Lock the sanction to serialize simultaneous submissions and status changes.
  const result = await client.query(
    `SELECT id, laboratorista_documento_id, con_estado_multa
     FROM multa WHERE id = $1 AND usuario_sancionado_id = $2 FOR UPDATE`,
    [validateClaimId(multaId), studentId]
  );
  const sanction = result.rows[0];
  if (!sanction) throw claimError(404, 'No encontramos esa sanción en tu cuenta.');
  if (sanction.con_estado_multa !== 'ACTIVA') {
    throw claimError(409, 'Solo puedes presentar una reclamación sobre una sanción activa.');
  }
  const inserted = await client.query(
    `INSERT INTO reclamacion_sancion (multa_id, responsable_documento_id, texto)
     VALUES ($1, $2, $3) ON CONFLICT (multa_id) DO NOTHING RETURNING id`,
    [sanction.id, sanction.laboratorista_documento_id, texto]
  );
  if (!inserted.rows.length)
    throw claimError(409, 'Ya presentaste una reclamación para esta sanción. Solo se permite una.');
  const claimId = inserted.rows[0].id;
  await writeClaimAudit(client, user, 'Presentar reclamación de sanción', claimId);
  return claimId;
}

async function respondToSanctionClaim(client, user, claimId, text, decision) {
  const respuesta = validateClaimText(text);
  if (!['PROCEDE', 'NO_PROCEDE'].includes(decision)) {
    throw claimError(400, 'Indica si procede o no procede la reclamación.');
  }
  const documento = await resolveClaimLaboratorista(client, user);
  const result = await client.query(
    `UPDATE reclamacion_sancion
     SET respuesta = $1, decision = $2, fecha_respuesta = CURRENT_TIMESTAMP,
         respondido_por_id = $3
     WHERE id = $4 AND responsable_documento_id = $3 AND fecha_respuesta IS NULL
     RETURNING id`,
    [respuesta, decision, documento, validateClaimId(claimId)]
  );
  if (!result.rows.length) {
    throw claimError(409, 'La reclamación ya fue respondida o no está asignada a tu cuenta.');
  }
  await writeClaimAudit(client, user, 'Responder reclamación de sanción', result.rows[0].id);
  return result.rows[0].id;
}

async function reassignSanctionClaim(client, user, claimId, document) {
  if (!hasClaimRole(user, 'admin') || user?.__impersonating) {
    throw claimError(403, 'Solo un administrador puede reasignar una reclamación.');
  }
  if (typeof document !== 'string' || !document.trim())
    throw claimError(400, 'Selecciona un laboratorista activo.');
  const target = await client.query(
    'SELECT documento FROM laboratorista WHERE documento = $1 AND activo = TRUE LIMIT 1',
    [document.trim()]
  );
  if (!target.rows.length) throw claimError(400, 'El laboratorista seleccionado no está activo.');
  const result = await client.query(
    `UPDATE reclamacion_sancion SET responsable_documento_id = $1
     WHERE id = $2 AND fecha_respuesta IS NULL RETURNING id`,
    [target.rows[0].documento, validateClaimId(claimId)]
  );
  if (!result.rows.length) throw claimError(409, 'La reclamación no existe o ya fue respondida.');
  await writeClaimAudit(
    client,
    user,
    `Reasignar reclamación a laboratorista ${target.rows[0].documento}`,
    result.rows[0].id
  );
  return result.rows[0].id;
}

async function fetchSanctionClaimHistory(client, multaId) {
  const result = await client.query(
    `SELECT r.id, r.texto, r.fecha_creacion, r.respuesta, r.decision, r.fecha_respuesta,
            responsable.nombre AS responsable, respondiente.nombre AS respondido_por,
            estudiante.nombre AS estudiante
     FROM reclamacion_sancion r
     JOIN multa m ON m.id = r.multa_id
     JOIN usuario estudiante ON estudiante.id = m.usuario_sancionado_id
     JOIN laboratorista responsable ON responsable.documento = r.responsable_documento_id
     LEFT JOIN laboratorista respondiente ON respondiente.documento = r.respondido_por_id
     WHERE r.multa_id = $1`,
    [multaId]
  );
  return result.rows;
}

module.exports = {
  claimError,
  hasClaimRole,
  validateClaimId,
  resolveClaimStudent,
  resolveClaimLaboratorista,
  createSanctionClaim,
  respondToSanctionClaim,
  reassignSanctionClaim,
  fetchSanctionClaimHistory,
};
