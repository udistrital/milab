const nodemailer = require('nodemailer');
require('dotenv').config();

let transporterConfig;

function resolveSmtpHost(value, fallback = 'smtp-mail.outlook.com') {
  const normalized = String(value || fallback)
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/\/$/, '');

  if (!normalized) {
    return fallback;
  }

  if (!/^[a-z0-9.-]+$/i.test(normalized)) {
    throw new Error('EMAIL_HOST contiene caracteres no permitidos para un host SMTP.');
  }

  return normalized;
}

if (process.env.EMAIL_SERVICE) {
  // Configuración para servicios predefinidos como Gmail
  transporterConfig = {
    service: process.env.EMAIL_SERVICE,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  };
} else {
  // Configuración personalizada (ej. Office 365, SMTP propio)
  transporterConfig = {
    host: resolveSmtpHost(process.env.EMAIL_HOST),
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: process.env.EMAIL_SECURE === 'true', // true para 465, false para otros puertos
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
    requireTLS: true,
    tls: {
      minVersion: 'TLSv1.2',
    },
  };
}

const transporter = nodemailer.createTransport(transporterConfig);

module.exports = transporter;
