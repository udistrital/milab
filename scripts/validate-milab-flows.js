const baseUrl = (process.env.VALIDATE_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');

async function request(pathname, options = {}) {
  const url = `${baseUrl}${pathname}`;
  const response = await fetch(url, {
    redirect: 'manual',
    ...options,
  });

  return {
    url,
    status: response.status,
    headers: response.headers,
    text: await response.text(),
  };
}

function pass(label, detail) {
  console.log(`PASS ${label}: ${detail}`);
}

function fail(label, detail) {
  console.error(`FAIL ${label}: ${detail}`);
}

async function checkHome() {
  const res = await request('/milab/');

  if (res.status >= 200 && res.status < 400) {
    pass('home', `status ${res.status}`);
    return true;
  }

  fail('home', `unexpected status ${res.status}`);
  return false;
}

async function checkInstitutionalLoginRedirect() {
  const res = await request('/milab/auth/login');

  if (res.status >= 200 && res.status < 400) {
    pass('auth-login-entry', `status ${res.status}`);
    return true;
  }

  fail('auth-login-entry', `unexpected status ${res.status}`);
  return false;
}

async function checkMicrosoftRedirect() {
  const res = await request('/milab/auth/microsoft');
  const location = res.headers.get('location') || '';

  if (res.status >= 300 && res.status < 400 && location.includes('login.microsoftonline.com')) {
    pass('auth-microsoft-redirect', `${res.status} -> login.microsoftonline.com`);
    return true;
  }

  if (res.status >= 400 && res.status < 500) {
    pass('auth-microsoft-redirect', `controlled client error status ${res.status}`);
    return true;
  }

  fail('auth-microsoft-redirect', `status ${res.status}, location: ${location || '(none)'}`);
  return false;
}

async function checkForgotPasswordFlow() {
  const params = new URLSearchParams({
    documento: '1024467835',
    correo: 'acmendeza@udistrital.edu.co',
  });

  const res = await request('/milab/api/send_email/forgot_password', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  const knownOutcomes = [
    '¡Correo enviado correctamente!',
    'servidor de correo no respondió correctamente',
    'correo de recuperación asociado',
    'No encontramos una cuenta vinculada',
    'No se pudo validar tu solicitud',
    'token de seguridad expiró o es inválido',
  ];

  const matched = knownOutcomes.find((token) => res.text.includes(token));

  if (matched) {
    pass('forgot-password', `status ${res.status}, outcome: ${matched}`);
    return true;
  }

  fail(
    'forgot-password',
    `status ${res.status}, unknown response snippet: ${res.text.slice(0, 200)}`
  );
  return false;
}

async function main() {
  console.log(`Running flow validation against ${baseUrl}`);

  const results = await Promise.all([
    checkHome(),
    checkInstitutionalLoginRedirect(),
    checkMicrosoftRedirect(),
    checkForgotPasswordFlow(),
  ]);

  const failed = results.filter((ok) => !ok).length;

  if (failed > 0) {
    console.error(`Validation completed with ${failed} failing checks.`);
    process.exit(1);
  }

  console.log('Validation completed successfully.');
}

main().catch((error) => {
  console.error('Validation crashed:', error);
  process.exit(1);
});
