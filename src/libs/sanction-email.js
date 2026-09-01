const pool = require('./db');
const transporter = require('./mail');
const { normalizeSanctionType } = require('./multa-config');
const {
  buildBrandedEmailAttachments,
  buildEmailFooterHtml,
  buildEmailHeaderHtml,
  escapeHtml,
} = require('./email-layout');

async function resolveStudentContactByUsuarioId(usuarioId) {
  if (!usuarioId) return null;
  const result = await pool.query(
    `
      SELECT u.nombre, u.documento, u.codigo, u.correo
      FROM usuario u
      WHERE u.id = $1
      LIMIT 1
    `,
    [usuarioId]
  );
  return result.rows[0] || null;
}

async function sendSanctionActivationEmail({
  correo,
  nombre,
  codigo,
  tipoSancion,
  observaciones,
  laboratorio,
  fecha,
}) {
  if (!transporter) {
    return { ok: false, reason: 'sin-transporter' };
  }
  if (!correo) {
    return { ok: false, reason: 'sin-correo' };
  }

  const safeNombre = nombre || 'estudiante';
  const h = escapeHtml;

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: correo,
    subject: 'Notificación de sanción activada - MILab Laboratorios UD',
    text: `Hola ${safeNombre},\n\nSe ha activado una sanción asociada a tu registro con código ${codigo}.\n\nTipo de sanción: ${tipoSancion}.\nLaboratorio: ${laboratorio || 'N/A'}.\nFecha: ${fecha || 'N/A'}.\nObservaciones: ${observaciones || 'Sin observaciones'}.\n\nSi tienes dudas, comunícate con la coordinación de laboratorios.`,
    html: `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta name="color-scheme" content="light only">
        <meta name="supported-color-schemes" content="light only">
        <title>Sanción activada</title>
      </head>
      <body style="margin:0;padding:0;background-color:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#f8f9fa;">
          <tr>
            <td align="center" style="padding:20px 10px;">
              <table width="600" border="0" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;box-shadow:0 6px 18px rgba(0,0,0,0.06);">
                ${buildEmailHeaderHtml()}
                <tr>
                  <td align="center" style="padding:30px 30px 20px 30px;">
                    <h1 style="font-size:22px;margin:0;color:#202124;">Se activó una sanción</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 30px 20px 30px;">
                    <p style="font-size:16px;line-height:1.6;color:#5f6368;margin:0;">
                      Hola ${h(safeNombre)},
                    </p>
                    <p style="font-size:15px;line-height:1.6;color:#5f6368;margin-top:16px;">
                      Se ha activado una sanción asociada a tu registro con código <strong>${h(codigo)}</strong>.
                    </p>
                    <div style="background:#f8f9fa;border-radius:8px;padding:16px;border-left:4px solid #e53935;margin-top:16px;">
                      <p style="margin:0;font-size:14px;color:#202124;"><strong>Tipo de sanción:</strong> ${h(tipoSancion)}</p>
                      <p style="margin:6px 0 0 0;font-size:14px;color:#202124;"><strong>Laboratorio:</strong> ${h(laboratorio || 'N/A')}</p>
                      <p style="margin:6px 0 0 0;font-size:14px;color:#202124;"><strong>Fecha:</strong> ${h(fecha || 'N/A')}</p>
                      <p style="margin:6px 0 0 0;font-size:14px;color:#202124;"><strong>Observaciones:</strong> ${h(observaciones || 'Sin observaciones')}</p>
                    </div>
                    <p style="font-size:14px;line-height:1.6;color:#5f6368;margin-top:18px;">
                      Si tienes dudas, comunícate con la coordinación de laboratorios.
                    </p>
                  </td>
                </tr>
                ${buildEmailFooterHtml(`
                  <p style="font-size:14px;color:rgba(255,255,255,0.92);margin:0;text-align:center;line-height:1.6;">
                    MILab - Coordinación General de Laboratorios
                  </p>
                `)}
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
    attachments: buildBrandedEmailAttachments(),
  };

  return new Promise((resolve) => {
    let settled = false;
    const done = (payload) => {
      if (!settled) {
        settled = true;
        resolve(payload);
      }
    };

    const handleError = (err) => {
      console.error('[sanction-email] sendMail falló:', err && err.message ? err.message : err);
      done({
        ok: false,
        reason: 'send-mail-error',
        error: err && err.message ? err.message : String(err),
      });
    };

    try {
      const maybePromise = transporter.sendMail(mailOptions, (err) => {
        if (err) {
          handleError(err);
          return;
        }
        done({ ok: true, to: correo });
      });

      // Some test doubles and transporters expose a Promise API instead of callbacks.
      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(() => done({ ok: true, to: correo })).catch(handleError);
      }
    } catch (err) {
      handleError(err);
    }
  });
}

module.exports = {
  normalizeSanctionType,
  resolveStudentContactByUsuarioId,
  sendSanctionActivationEmail,
};
