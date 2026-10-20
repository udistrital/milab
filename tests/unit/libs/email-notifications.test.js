const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../../src/libs/email-notifications.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const mailPath = path.resolve(__dirname, '../../../src/libs/mail.js');

test('notification delivery is independent of audit record failures', async () => {
  const previousModules = [modulePath, dbPath, mailPath].map(
    (modulePath) => require.cache[modulePath]
  );
  const previousConsoleError = console.error;
  const loggedErrors = [];
  const sentMessages = [];
  let auditUnavailable = true;

  try {
    require.cache[dbPath] = {
      id: dbPath,
      filename: dbPath,
      loaded: true,
      exports: {
        query: async (sql) => {
          if (auditUnavailable || sql.includes('UPDATE email_notification')) {
            throw new Error('audit unavailable');
          }
          return { rows: sql.includes('INSERT INTO email_notification') ? [{ id: 42 }] : [] };
        },
      },
    };
    require.cache[mailPath] = {
      id: mailPath,
      filename: mailPath,
      loaded: true,
      exports: {
        sendMail: async (message) => {
          sentMessages.push(message);
        },
      },
    };
    delete require.cache[modulePath];
    console.error = (...args) => loggedErrors.push(args);

    const { sendEmailNotification } = require(modulePath);
    const notification = {
      sourceSystem: 'dashboard',
      templateName: 'dashboard/user-account-notification',
      recipient: 'estudiante@udistrital.edu.co',
      subject: 'Tu cuenta MILab está habilitada',
      variables: {
        nombre: 'Estudiante',
        correo: 'estudiante@udistrital.edu.co',
        tipoUsuario: 'estudiante',
        sanciones: [],
        registrationUrl: 'https://example.org/register',
      },
    };
    const result = await sendEmailNotification(notification);

    assert.deepEqual(result, { id: null, status: 'SENT' });
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].to, 'estudiante@udistrital.edu.co');
    assert.match(sentMessages[0].html, /Estudiante/);
    assert.equal(sentMessages[0].from.name, 'MILab — No responder');
    assert.equal(sentMessages[0].from.address, process.env.EMAIL_FROM || process.env.EMAIL_USER);
    assert.match(sentMessages[0].html, /Por favor, no respondas a este correo/);
    assert.match(loggedErrors[0][1].message, /audit unavailable/);

    auditUnavailable = false;
    const sentWithoutAuditUpdate = await sendEmailNotification(notification);

    assert.deepEqual(sentWithoutAuditUpdate, { id: 42, status: 'SENT' });
    assert.equal(sentMessages.length, 2);
    assert.match(loggedErrors[1][1].message, /audit unavailable/);

    await sendEmailNotification({
      sourceSystem: 'sanciones',
      templateName: 'sanciones/reclamacion',
      recipient: 'laboratorista@udistrital.edu.co',
      subject: 'Reclamación pendiente',
      variables: {
        answered: false,
        multaId: 9,
        actionUrl: 'https://example.test/milab/api/sanciones/reclamaciones',
      },
    });
    assert.equal(sentMessages[2].from.name, 'MILab — No responder');
    assert.match(sentMessages[2].html, /Tienes una reclamación pendiente/);
    assert.match(
      sentMessages[2].html,
      /https:\/\/example.test\/milab\/api\/sanciones\/reclamaciones/
    );
    assert.match(sentMessages[2].html, /Por favor, no respondas a este correo/);
    await sendEmailNotification({
      ...notification,
      variables: {
        ...notification.variables,
        sanciones: [{ cat_multa: 'Entrega', laboratorio: 'Laboratorio de prueba' }],
      },
    });
    assert.match(sentMessages[3].html, /Mis sanciones en MILab/);
  } finally {
    console.error = previousConsoleError;
    [modulePath, dbPath, mailPath].forEach((modulePath, index) => {
      if (previousModules[index]) {
        require.cache[modulePath] = previousModules[index];
      } else {
        delete require.cache[modulePath];
      }
    });
  }
});
