const fs = require('fs');
const path = require('path');

const {
  buildBrandedEmailAttachments,
  buildEmailFooterHtml,
  buildEmailHeaderHtml,
  escapeHtml,
} = require('./email-layout');
const transporter = require('./mail');

require('dotenv').config();

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isUndeliverablePlaceholderEmail(correo) {
  return normalizeEmail(correo).toLowerCase().endsWith('@placeholder.milab.local');
}

function resolveCertificateRecipient(correo) {
  const originalRecipient = normalizeEmail(correo);
  const overrideRecipient = normalizeEmail(
    process.env.CERTIFICATE_EMAIL_OVERRIDE || process.env.REGISTRATION_EMAIL_OVERRIDE
  );

  return overrideRecipient || originalRecipient;
}

async function sendCertificateEmail({
  correo,
  pdfPath,
  ownerName,
  reference,
  referenceType,
  motivo,
}) {
  const originalRecipient = normalizeEmail(correo);

  if (!originalRecipient || isUndeliverablePlaceholderEmail(originalRecipient)) {
    return {
      status: 'skipped',
      reason: 'missing-recipient',
    };
  }

  const recipient = resolveCertificateRecipient(originalRecipient);
  const overrideActive = recipient !== originalRecipient;
  const safeOwnerName = ownerName || 'usuario';
  const safeReference = reference || 'sin referencia';
  const safeReferenceType = referenceType || 'referencia';
  const safeMotivo = motivo || 'No especificado';
  const fileName = path.basename(pdfPath);

  if (!fs.existsSync(pdfPath)) {
    throw new Error(`Certificate PDF not found at ${pdfPath}`);
  }

  const overrideNoticeText = overrideActive
    ? `\n\nEste correo fue redirigido a un buzón de pruebas. Destinatario original: ${originalRecipient}`
    : '';
  const overrideNoticeHtml = overrideActive
    ? `<p style="font-size: 14px; line-height: 1.6; color: #b3261e; margin-top: 12px;">Este correo fue redirigido a un buzón de pruebas. Destinatario original: ${escapeHtml(originalRecipient)}</p>`
    : '';

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: recipient,
    subject: 'Certificado de paz y salvo - MILab Laboratorios UD',
    text: `Hola ${safeOwnerName},\n\nAdjuntamos tu certificado de paz y salvo generado con el motivo ${safeMotivo} para ${safeReferenceType} ${safeReference}.${overrideNoticeText}\n\nAtentamente,\nEquipo de la Coordinación General de Laboratorios.`,
    html: `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta name="color-scheme" content="light only">
        <meta name="supported-color-schemes" content="light only">
        <title>Certificado de paz y salvo</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #f8f9fa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8f9fa;">
          <tr>
            <td align="center" style="padding: 20px 10px;">
              <table width="600" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; width: 100%; margin: 0 auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 6px 18px rgba(0,0,0,0.06);">
                ${buildEmailHeaderHtml()}
                <tr>
                  <td style="padding: 36px 30px 16px 30px; text-align: center;">
                    <h1 style="font-size: 28px; font-weight: 700; color: #202124; margin: 0;">Tu certificado de paz y salvo</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 30px 12px 30px; color: #5f6368; font-size: 16px; line-height: 1.6;">
                    <p style="margin: 0;">Hola ${escapeHtml(safeOwnerName)},</p>
                    <p style="margin: 16px 0 0 0;">Adjuntamos tu certificado de paz y salvo generado con el motivo <strong>${escapeHtml(safeMotivo)}</strong> para ${escapeHtml(safeReferenceType)} <strong>${escapeHtml(safeReference)}</strong>.</p>
                    ${overrideNoticeHtml}
                  </td>
                </tr>
                ${buildEmailFooterHtml(`
                  <p style="margin: 0; text-align: center; color: rgba(255,255,255,0.92); font-size: 14px; line-height: 1.6;">Atentamente,</p>
                  <p style="margin: 8px 0 0 0; text-align: center; color: rgba(255,255,255,0.92); font-size: 14px; line-height: 1.6;"><strong>Equipo de la Coordinación General de Laboratorios</strong></p>
                `)}
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
    attachments: buildBrandedEmailAttachments([
      {
        filename: fileName,
        path: pdfPath,
        contentType: 'application/pdf',
      },
    ]),
  };

  await transporter.sendMail(mailOptions);

  return {
    status: 'sent',
    recipient,
    originalRecipient,
    overrideActive,
  };
}

function buildCertificateEmailFeedback(emailResult, options = {}) {
  if (!emailResult) {
    return null;
  }

  const missingRecipientMessage =
    options.missingRecipientMessage ||
    'El certificado se generó correctamente, pero no se envió por correo porque no se indicó una dirección de correo.';

  if (emailResult.status === 'sent') {
    if (emailResult.overrideActive) {
      return {
        variant: 'warning',
        message: `El certificado también se envió al buzón de pruebas ${emailResult.recipient}. Destinatario original: ${emailResult.originalRecipient}.`,
      };
    }

    return {
      variant: 'info',
      message: `El certificado también se envió al correo ${emailResult.originalRecipient}.`,
    };
  }

  if (emailResult.reason === 'missing-recipient') {
    return {
      variant: 'warning',
      message: missingRecipientMessage,
    };
  }

  return null;
}

function buildCertificateEmailFailureFeedback() {
  return {
    variant: 'warning',
    message:
      'El certificado se generó correctamente, pero no fue posible enviarlo por correo en este momento.',
  };
}

module.exports = {
  buildCertificateEmailFailureFeedback,
  buildCertificateEmailFeedback,
  resolveCertificateRecipient,
  sendCertificateEmail,
};
