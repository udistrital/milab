const RECAPTCHA_VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

function buildRecaptchaVerificationUrl(secretKey, token) {
  const secret = encodeURIComponent(typeof secretKey === 'string' ? secretKey : '');
  const response = encodeURIComponent(typeof token === 'string' ? token : '');

  return `${RECAPTCHA_VERIFY_URL}?secret=${secret}&response=${response}`;
}

async function verifyRecaptchaToken({ secretKey, token, remoteIp, fetchImpl = global.fetch } = {}) {
  if (!secretKey || !token || typeof fetchImpl !== 'function') {
    return { success: false };
  }

  try {
    const body = new URLSearchParams();
    body.set('secret', secretKey);
    body.set('response', token);
    if (remoteIp) {
      body.set('remoteip', remoteIp);
    }

    const response = await fetchImpl(RECAPTCHA_VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
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
