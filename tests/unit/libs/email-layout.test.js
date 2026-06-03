const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildBrandedEmailAttachments,
  buildEmailFooterHtml,
  buildEmailHeaderHtml,
  escapeHtml,
} = require('../../../src/libs/email-layout');

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
