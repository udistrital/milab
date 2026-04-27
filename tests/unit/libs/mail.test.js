const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../../src/libs/mail.js');
const nodemailerPath = require.resolve('nodemailer');

function loadMailModule() {
  const originalNodemailer = require.cache[nodemailerPath];
  const originalEnv = {
    EMAIL_SERVICE: process.env.EMAIL_SERVICE,
    EMAIL_USER: process.env.EMAIL_USER,
    EMAIL_PASSWORD: process.env.EMAIL_PASSWORD,
    EMAIL_HOST: process.env.EMAIL_HOST,
    EMAIL_PORT: process.env.EMAIL_PORT,
    EMAIL_SECURE: process.env.EMAIL_SECURE,
    REGISTRATION_EMAIL_OVERRIDE: process.env.REGISTRATION_EMAIL_OVERRIDE,
  };

  let capturedConfig;
  let capturedMailOptions;

  delete require.cache[modulePath];
  require.cache[nodemailerPath] = {
    id: nodemailerPath,
    filename: nodemailerPath,
    loaded: true,
    exports: {
      createTransport(config) {
        capturedConfig = config;
        return {
          async sendMail(mailOptions) {
            capturedMailOptions = mailOptions;
            return { accepted: [mailOptions.to] };
          },
        };
      },
    },
  };

  const loadedModule = require(modulePath);

  return {
    transporter: loadedModule,
    getCapturedConfig: () => capturedConfig,
    getCapturedMailOptions: () => capturedMailOptions,
    restore() {
      if (originalNodemailer) {
        require.cache[nodemailerPath] = originalNodemailer;
      } else {
        delete require.cache[nodemailerPath];
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

test('buildTransportConfig prefers EMAIL_SERVICE when configured', () => {
  process.env.EMAIL_SERVICE = 'gmail';
  process.env.EMAIL_USER = 'sistema@udistrital.edu.co';
  process.env.EMAIL_PASSWORD = 'secret';

  const loaded = loadMailModule();

  try {
    assert.deepEqual(loaded.getCapturedConfig(), {
      service: 'gmail',
      auth: {
        user: 'sistema@udistrital.edu.co',
        pass: 'secret',
      },
    });
    assert.equal(typeof loaded.transporter.buildTransportConfig, 'function');
  } finally {
    loaded.restore();
  }
});

test('buildTransportConfig uses host, port and secure when service is absent', () => {
  delete process.env.EMAIL_SERVICE;
  process.env.EMAIL_USER = 'sistema@udistrital.edu.co';
  process.env.EMAIL_PASSWORD = 'secret';
  process.env.EMAIL_HOST = 'smtp-mail.outlook.com';
  process.env.EMAIL_PORT = '587';
  process.env.EMAIL_SECURE = 'false';

  const loaded = loadMailModule();

  try {
    assert.deepEqual(loaded.getCapturedConfig(), {
      host: 'smtp-mail.outlook.com',
      port: 587,
      secure: false,
      auth: {
        user: 'sistema@udistrital.edu.co',
        pass: 'secret',
      },
    });
  } finally {
    loaded.restore();
  }
});

test('sendMail applies recipient override and preserves original recipients in headers', async () => {
  process.env.REGISTRATION_EMAIL_OVERRIDE = 'qa@udistrital.edu.co';
  process.env.EMAIL_USER = 'sistema@udistrital.edu.co';
  process.env.EMAIL_PASSWORD = 'secret';

  const loaded = loadMailModule();

  try {
    await loaded.transporter.sendMail({
      to: 'destino@udistrital.edu.co',
      cc: 'copia@udistrital.edu.co',
      bcc: 'oculto@udistrital.edu.co',
      subject: 'Prueba',
    });

    assert.deepEqual(loaded.getCapturedMailOptions(), {
      to: 'qa@udistrital.edu.co',
      cc: undefined,
      bcc: undefined,
      subject: 'Prueba',
      headers: {
        'X-MiLab-Original-Recipients':
          'destino@udistrital.edu.co | copia@udistrital.edu.co | oculto@udistrital.edu.co',
      },
    });
    assert.equal(typeof loaded.transporter.applyRecipientOverride, 'function');
  } finally {
    loaded.restore();
  }
});
