const test = require('node:test');
const assert = require('node:assert/strict');

const {
  NO_REPLY_NOTICE,
  buildBrandedEmailAttachments,
  buildEmailFooterHtml,
  buildEmailHeaderHtml,
  buildNoReplyNoticeHtml,
  buildNoReplySender,
  escapeHtml,
} = require('../../../src/libs/email-layout');

test('no-reply presentation preserves the sender address and provides a shared notice', () => {
  assert.deepEqual(buildNoReplySender('notificaciones@udistrital.edu.co'), {
    name: 'MILab — No responder',
    address: 'notificaciones@udistrital.edu.co',
  });

  assert.deepEqual(buildNoReplySender('Nombre anterior <notificaciones@udistrital.edu.co>'), {
    name: 'MILab — No responder',
    address: 'notificaciones@udistrital.edu.co',
  });
  assert.throws(
    () => buildNoReplySender('uno@example.org, dos@example.org'),
    /una única dirección/
  );
  assert.ok(buildNoReplyNoticeHtml().includes(NO_REPLY_NOTICE));
});

test('no-reply sender preserves the SMTP envelope for a formatted sender', async () => {
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({ streamTransport: true, buffer: true });
  const message = await transporter.sendMail({
    from: buildNoReplySender('Nombre anterior <notificaciones@example.org>'),
    to: 'destino@example.org',
    subject: 'Prueba local',
    text: NO_REPLY_NOTICE,
  });

  assert.equal(message.envelope.from, 'notificaciones@example.org');
  assert.match(message.message.toString(), /No_responder/);
  assert.match(message.message.toString(), /<notificaciones@example.org>/);
});

test('escapeHtml sanitizes special characters', () => {
  const value = `<div class="x">Tom & 'Ana'</div>`;

  assert.equal(
    escapeHtml(value),
    '&lt;div class=&quot;x&quot;&gt;Tom &amp; &#x27;Ana&#x27;&lt;/div&gt;'
  );
});

test('buildBrandedEmailAttachments appends branded logos after extras', () => {
  const attachments = buildBrandedEmailAttachments([
    { filename: 'extra.pdf', path: '/tmp/extra.pdf' },
  ]);

  assert.equal(attachments.length, 3);
  assert.equal(attachments[0].filename, 'extra.pdf');
  assert.equal(attachments[1].cid, 'milab-header-logo');
  assert.equal(attachments[2].cid, 'ud-footer-logo');
});

test('buildEmailHeaderHtml and buildEmailFooterHtml include expected cids and note', () => {
  const header = buildEmailHeaderHtml();
  const footer = buildEmailFooterHtml('<p>Nota personalizada</p>');
  const footerDefault = buildEmailFooterHtml();

  assert.match(header, /cid:milab-header-logo/);
  assert.match(footer, /cid:ud-footer-logo/);
  assert.match(footer, /Nota personalizada/);
  assert.match(footerDefault, /Equipo de la Coordinación General de Laboratorios/);
});
