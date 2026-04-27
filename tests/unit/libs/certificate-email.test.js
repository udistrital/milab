const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../../src/libs/certificate-email.js');
const mailPath = path.resolve(__dirname, '../../../src/libs/mail.js');

function loadCertificateEmailModule({ sendMail } = {}) {
  const originalMailModule = require.cache[mailPath];
  const originalEnv = {
    CERTIFICATE_EMAIL_OVERRIDE: process.env.CERTIFICATE_EMAIL_OVERRIDE,
    REGISTRATION_EMAIL_OVERRIDE: process.env.REGISTRATION_EMAIL_OVERRIDE,
    EMAIL_USER: process.env.EMAIL_USER,
  };

  delete require.cache[modulePath];
  require.cache[mailPath] = {
    id: mailPath,
    filename: mailPath,
    loaded: true,
    exports: {
      sendMail: sendMail || (async () => {}),
    },
  };

  process.env.EMAIL_USER = 'noreply@udistrital.edu.co';
  const loadedModule = require(modulePath);

  return {
    ...loadedModule,
    restore() {
      if (originalMailModule) {
        require.cache[mailPath] = originalMailModule;
      } else {
        delete require.cache[mailPath];
      }

      Object.entries(originalEnv).forEach(([key, value]) => {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      });

      delete require.cache[modulePath];
    },
  };
}

test('resolveCertificateRecipient uses override recipient when configured', () => {
  process.env.CERTIFICATE_EMAIL_OVERRIDE = 'qa@udistrital.edu.co';
  const loaded = loadCertificateEmailModule();

  try {
    assert.equal(
      loaded.resolveCertificateRecipient('persona@udistrital.edu.co'),
      'qa@udistrital.edu.co'
    );
  } finally {
    loaded.restore();
  }
});

test('sendCertificateEmail skips sending when recipient is missing', async () => {
  let called = false;
  const loaded = loadCertificateEmailModule({
    sendMail: async () => {
      called = true;
    },
  });

  try {
    const result = await loaded.sendCertificateEmail({
      correo: '',
      pdfPath: '/tmp/unused.pdf',
      ownerName: 'Persona',
      reference: '123',
      referenceType: 'documento',
      motivo: 'Prueba',
    });

    assert.deepEqual(result, {
      status: 'skipped',
      reason: 'missing-recipient',
    });
    assert.equal(called, false);
  } finally {
    loaded.restore();
  }
});

test('sendCertificateEmail throws when pdf path does not exist', async () => {
  const loaded = loadCertificateEmailModule();

  try {
    await assert.rejects(
      loaded.sendCertificateEmail({
        correo: 'persona@udistrital.edu.co',
        pdfPath: '/tmp/not-found-certificate.pdf',
        ownerName: 'Persona',
        reference: '123',
        referenceType: 'documento',
        motivo: 'Prueba',
      }),
      /Certificate PDF not found/
    );
  } finally {
    loaded.restore();
  }
});

test('sendCertificateEmail sends with override and returns metadata', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'milab-cert-'));
  const pdfPath = path.join(tempDir, 'certificado.pdf');
  fs.writeFileSync(pdfPath, 'fake-pdf-content');

  let sentMailOptions;
  process.env.CERTIFICATE_EMAIL_OVERRIDE = 'qa@udistrital.edu.co';
  const loaded = loadCertificateEmailModule({
    sendMail: async (mailOptions) => {
      sentMailOptions = mailOptions;
    },
  });

  try {
    const result = await loaded.sendCertificateEmail({
      correo: 'persona@udistrital.edu.co',
      pdfPath,
      ownerName: 'Persona',
      reference: '123',
      referenceType: 'documento',
      motivo: 'Prueba unitaria',
    });

    assert.deepEqual(result, {
      status: 'sent',
      recipient: 'qa@udistrital.edu.co',
      originalRecipient: 'persona@udistrital.edu.co',
      overrideActive: true,
    });
    assert.equal(sentMailOptions.to, 'qa@udistrital.edu.co');
    assert.match(sentMailOptions.subject, /Certificado de paz y salvo/);
    assert.equal(sentMailOptions.attachments[0].path, pdfPath);
  } finally {
    loaded.restore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildCertificateEmailFeedback and buildCertificateEmailFailureFeedback return stable messages', () => {
  const loaded = loadCertificateEmailModule();

  try {
    assert.deepEqual(loaded.buildCertificateEmailFeedback(null), null);
    assert.deepEqual(
      loaded.buildCertificateEmailFeedback({ status: 'missing', reason: 'missing-recipient' }),
      {
        variant: 'warning',
        message:
          'El certificado se generó correctamente, pero no se envió por correo porque no se indicó una dirección de correo.',
      }
    );
    assert.deepEqual(loaded.buildCertificateEmailFailureFeedback(), {
      variant: 'warning',
      message:
        'El certificado se generó correctamente, pero no fue posible enviarlo por correo en este momento.',
    });
  } finally {
    loaded.restore();
  }
});
