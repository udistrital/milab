const RECAPTCHA_VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

function buildRecaptchaVerificationUrl(secretKey, token) {
  const secret = encodeURIComponent(typeof secretKey === 'string' ? secretKey : '');
  const response = encodeURIComponent(typeof token === 'string' ? token : '');

  return `${RECAPTCHA_VERIFY_URL}?secret=${secret}&response=${response}`;
}

async function verifyRecaptchaToken({ secretKey, token, fetchImpl = global.fetch } = {}) {
  if (!secretKey || !token || typeof fetchImpl !== 'function') {
    return { success: false };
  }

  try {
    const response = await fetchImpl(buildRecaptchaVerificationUrl(secretKey, token), {
      method: 'POST',
    });

    if (!response || typeof response.json !== 'function') {
      return { success: false };
    }

    const payload = await response.json();

    return {
      ...payload,
      success: Boolean(payload && payload.success),
    };
  } catch {
    return { success: false };
  }
}

module.exports = {
  buildRecaptchaVerificationUrl,
  verifyRecaptchaToken,
};
