const nodemailer = require('nodemailer');

require('dotenv').config();

function normalizeEmailOverride(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function serializeRecipients(value) {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(serializeRecipients).filter(Boolean).join(', ');
  }

  if (typeof value === 'object') {
    if (typeof value.address === 'string') {
      return value.address;
    }

    return JSON.stringify(value);
  }

  return String(value);
}

function applyRecipientOverride(mailOptions) {
  const overrideRecipient = normalizeEmailOverride(process.env.REGISTRATION_EMAIL_OVERRIDE);

  if (!overrideRecipient || !mailOptions || typeof mailOptions !== 'object') {
    return mailOptions;
  }

  const originalRecipients = [mailOptions.to, mailOptions.cc, mailOptions.bcc]
    .map(serializeRecipients)
    .filter(Boolean)
    .join(' | ');

  if (!originalRecipients) {
    return mailOptions;
  }

  return {
    ...mailOptions,
    to: overrideRecipient,
    cc: undefined,
    bcc: undefined,
    headers: {
      ...(mailOptions.headers || {}),
      'X-MiLab-Original-Recipients': originalRecipients,
    },
  };
}

function buildTransportConfig() {
  const auth = {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  };

  if (process.env.EMAIL_SERVICE) {
    return {
      service: process.env.EMAIL_SERVICE,
      auth,
    };
  }

  return {
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT || 587),
    secure: process.env.EMAIL_SECURE === 'true',
    auth,
  };
}

const transporter = nodemailer.createTransport(buildTransportConfig());
const originalSendMail = transporter.sendMail.bind(transporter);

transporter.sendMail = function sendMailWithOverride(mailOptions, ...rest) {
  return originalSendMail(applyRecipientOverride(mailOptions), ...rest);
};

transporter.applyRecipientOverride = applyRecipientOverride;
transporter.buildTransportConfig = buildTransportConfig;

module.exports = transporter;
