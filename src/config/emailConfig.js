const nodemailer = require('nodemailer');
require('dotenv').config();

let transporterConfig;

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
    host: process.env.EMAIL_HOST || 'smtp-mail.outlook.com',
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
