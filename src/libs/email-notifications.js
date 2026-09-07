const path = require('node:path');
const ejs = require('ejs');

const pool = require('./db');
const {
  buildBrandedEmailAttachments,
  buildEmailFooterHtml,
  buildEmailHeaderHtml,
} = require('./email-layout');
const transporter = require('./mail');

let schemaEnsured = false;

async function ensureEmailNotificationsSchema() {
  if (schemaEnsured) {
    return;
  }

  await pool.query(
    `CREATE TABLE IF NOT EXISTS email_notification (
      id SERIAL PRIMARY KEY,
      source_system VARCHAR(50),
      template_name VARCHAR(100),
      recipient VARCHAR(255),
      subject VARCHAR(255),
      status VARCHAR(20),
      error_message TEXT,
      fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      fecha_envio TIMESTAMPTZ,
      fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      correlation_id VARCHAR(100),
      activo BOOLEAN NOT NULL DEFAULT TRUE
    )`
  );

  await pool.query(
    `ALTER TABLE email_notification
      ADD COLUMN IF NOT EXISTS fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`
  );
  await pool.query(
    `ALTER TABLE email_notification
      ADD COLUMN IF NOT EXISTS fecha_envio TIMESTAMPTZ`
  );
  await pool.query(
    `ALTER TABLE email_notification
      ADD COLUMN IF NOT EXISTS fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`
  );
  await pool.query(
    `ALTER TABLE email_notification
      ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE`
  );

  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_email_notification_created_at
      ON email_notification(fecha_creacion)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_email_notification_status
      ON email_notification(status)`
  );

  schemaEnsured = true;
}

async function renderTemplate(templateName, variables = {}) {
  const templatePath = path.join(__dirname, '..', 'email-templates', `${templateName}.ejs`);
  return ejs.renderFile(templatePath, {
    ...variables,
    buildEmailFooterHtml,
    buildEmailHeaderHtml,
  });
}

async function createPendingNotification({
  sourceSystem,
  templateName,
  recipient,
  subject,
  correlationId,
}) {
  await ensureEmailNotificationsSchema();
  const result = await pool.query(
    `INSERT INTO email_notification (
      source_system,
      template_name,
      recipient,
      subject,
      status,
      correlation_id
    )
    VALUES ($1, $2, $3, $4, 'PENDING', $5)
    RETURNING id`,
    [sourceSystem, templateName, recipient, subject, correlationId || null]
  );

  return result.rows[0]?.id || null;
}

async function markSent(id) {
  await pool.query(
    `UPDATE email_notification
      SET status = 'SENT',
          fecha_envio = CURRENT_TIMESTAMP,
          fecha_modificacion = CURRENT_TIMESTAMP
    WHERE id = $1`,
    [id]
  );
}

async function markFailed(id, errorMessage) {
  await pool.query(
    `UPDATE email_notification
      SET status = 'FAILED',
          error_message = $2,
          fecha_modificacion = CURRENT_TIMESTAMP
    WHERE id = $1`,
    [id, errorMessage || null]
  );
}

function errorToMessage(error) {
  return String(error?.message || error);
}

function buildFailedResponse(id, error) {
  return {
    id: id || null,
    status: 'FAILED',
    error: errorToMessage(error),
  };
}

function throwIfRequired(error, throwOnError) {
  if (throwOnError) {
    throw error;
  }
}

async function createNotificationRecord(payload, throwOnError) {
  try {
    const id = await createPendingNotification(payload);
    return { ok: true, id };
  } catch (error) {
    throwIfRequired(error, throwOnError);
    return { ok: false, response: buildFailedResponse(null, error) };
  }
}

async function sendNotificationEmail(templateName, variables, recipient, subject) {
  const html = await renderTemplate(templateName, variables || {});

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: recipient,
    subject,
    html,
    attachments: buildBrandedEmailAttachments(),
  });
}

async function markFailedSafely(id, error) {
  if (!id) {
    return;
  }

  try {
    await markFailed(id, errorToMessage(error));
  } catch (markError) {
    console.error('Error registrando fallo de notificacion por correo:', markError);
  }
}

async function sendEmailNotification({
  sourceSystem = 'prestamos',
  templateName,
  recipient,
  subject,
  variables,
  correlationId,
  throwOnError = false,
}) {
  if (!templateName) {
    throw new Error('templateName es obligatorio');
  }

  if (!recipient) {
    throw new Error('recipient es obligatorio');
  }

  if (!subject) {
    throw new Error('subject es obligatorio');
  }

  const creationResult = await createNotificationRecord(
    {
      sourceSystem,
      templateName,
      recipient,
      subject,
      correlationId,
    },
    throwOnError
  );
  if (!creationResult.ok) {
    return creationResult.response;
  }
  const id = creationResult.id;

  try {
    await sendNotificationEmail(templateName, variables, recipient, subject);

    if (id) {
      await markSent(id);
    }
    return { id: id || null, status: 'SENT' };
  } catch (error) {
    await markFailedSafely(id, error);
    throwIfRequired(error, throwOnError);
    return buildFailedResponse(id, error);
  }
}

module.exports = {
  sendEmailNotification,
};
