const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../../src/libs/sanction-email.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const mailPath = path.resolve(__dirname, '../../../src/libs/mail.js');

test('sanction emails direct students to the reporting lab and discourage replies', async () => {
  const paths = [modulePath, dbPath, mailPath];
  const originals = paths.map((modulePath) => require.cache[modulePath]);
  const messages = [];

  try {
    require.cache[dbPath] = {
      id: dbPath,
      filename: dbPath,
      loaded: true,
      exports: { query: async () => ({ rows: [] }) },
    };
    require.cache[mailPath] = {
      id: mailPath,
      filename: mailPath,
      loaded: true,
      exports: {
        sendMail: (message, callback) => {
          messages.push(message);
          callback(null, { accepted: [message.to] });
        },
      },
    };
    delete require.cache[modulePath];
    const { sendSanctionActivationEmail } = require(modulePath);
    const payload = {
      correo: 'estudiante@udistrital.edu.co',
      nombre: 'Estudiante',
      codigo: '20260001',
      tipoSancion: 'Suspensión',
      observaciones: 'Entrega tardía',
      laboratorio: 'Química & <Materiales>',
      fecha: '2026-10-08',
    };

    assert.deepEqual(await sendSanctionActivationEmail(payload), {
      ok: true,
      to: payload.correo,
    });
    const message = messages[0];
    assert.deepEqual(message.from, {
      name: 'MILab — No responder',
      address: process.env.EMAIL_USER,
    });
    assert.equal(message.to, payload.correo);
    assert.match(message.text, /acércate al laboratorio Química & <Materiales>/);
    assert.match(message.html, /acércate al laboratorio Química &amp; &lt;Materiales&gt;/);
    assert.doesNotMatch(message.html, /<Materiales>/);
    for (const content of [message.text, message.html]) {
      assert.match(content, /Por favor, no respondas a este correo/);
      assert.doesNotMatch(content, /comunícate con la coordinación/);
    }
    assert.equal(message.attachments.length, 2);
    assert.match(message.text, /Mis sanciones/);
    assert.match(message.html, /Consultar sanción y presentar reclamación/);
    assert.match(message.html, /\/api\/sanciones\/mis-sanciones/);

    await sendSanctionActivationEmail({ ...payload, laboratorio: null });
    for (const content of [messages[1].text, messages[1].html]) {
      assert.match(content, /acércate al laboratorio donde se registró la sanción/);
      assert.doesNotMatch(content, /acércate al laboratorio (?:null|undefined|N\/A)/);
    }
    await sendSanctionActivationEmail({ ...payload, permiteReclamacion: false });
    assert.doesNotMatch(
      messages[2].html,
      /presenta tu reclamación|\/api\/sanciones\/mis-sanciones/
    );
  } finally {
    paths.forEach((modulePath, index) => {
      if (originals[index]) {
        require.cache[modulePath] = originals[index];
      } else {
        delete require.cache[modulePath];
      }
    });
  }
});
