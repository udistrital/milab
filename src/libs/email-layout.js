const path = require('path');

const HEADER_LOGO_CID = 'milab-header-logo';
const FOOTER_LOGO_CID = 'ud-footer-logo';

function buildBrandedEmailAttachments(extraAttachments = []) {
  return [
    ...extraAttachments,
    {
      filename: 'email_header_milab.png',
      path: path.resolve(__dirname, '../public/img/email_header_milab.png'),
      cid: HEADER_LOGO_CID,
    },
    {
      filename: 'Logo_Escudo_Acreditacion_Horizontal_Blanco.png',
      path: path.resolve(__dirname, '../public/img/Logo_Escudo_Acreditacion_Horizontal_Blanco.png'),
      cid: FOOTER_LOGO_CID,
    },
  ];
}

function buildEmailHeaderHtml() {
  return `
    <tr>
      <td align="center" bgcolor="#ffffff" style="padding: 0; background-color: #ffffff; border-radius: 12px 12px 0 0;">
        <img src="cid:${HEADER_LOGO_CID}" alt="MILab" width="600" style="display: block; width: 100%; max-width: 600px; height: auto; border-radius: 12px 12px 0 0; margin: 0 auto;">
      </td>
    </tr>
  `;
}

function buildEmailFooterHtml(noteHtml) {
  const safeNoteHtml =
    noteHtml ||
    '<p class="fallback-font" style="font-size: 14px; color: rgba(255,255,255,0.92); margin: 0; text-align: center;">Equipo de la Coordinación General de Laboratorios.</p>';

  return `
    <tr>
      <td style="padding: 22px 30px 12px 30px; background-color: #b3261e;">
        ${safeNoteHtml}
      </td>
    </tr>
    <tr>
      <td align="center" style="padding: 4px 30px 24px 30px; background-color: #b3261e; border-radius: 0 0 12px 12px;">
        <img src="cid:${FOOTER_LOGO_CID}" alt="Universidad Distrital Francisco José de Caldas" width="240" style="display: block; margin: 0 auto; width: 240px; max-width: 100%; height: auto;">
      </td>
    </tr>
  `;
}

module.exports = {
  buildBrandedEmailAttachments,
  buildEmailFooterHtml,
  buildEmailHeaderHtml,
};
