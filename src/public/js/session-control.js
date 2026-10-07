/* global window, document */
(function () {
  const home = '/milab/';
  const authenticated = document.body.dataset.isAuthenticated === 'true';
  const idleTimeoutMs = Number(document.body.dataset.sessionIdleTimeout) || 1800000;
  const activityIntervalMs = Math.min(60000, idleTimeoutMs / 4);
  const originalFetch = window.fetch.bind(window);
  let redirecting = false;
  let expiryTimer;
  let pendingActivity = false;
  let activityRequest;
  let lastActivitySentAt = Date.now();

  function returnHome() {
    if (redirecting) return;
    redirecting = true;
    window.clearTimeout(expiryTimer);
    window.location.replace(home);
  }

  function showConnectionError(error) {
    window.console.error('No fue posible verificar la sesion de MILab:', error);
    let notice = document.getElementById('session-connection-error');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'session-connection-error';
      notice.className = 'alert alert-warning rounded-0 mb-0';
      notice.setAttribute('role', 'alert');
      document.body.prepend(notice);
    }
    notice.textContent =
      'No fue posible verificar tu sesion. Revisa tu conexion antes de guardar los cambios.';
  }

  function isMilabRequest(input) {
    const url = new URL(
      typeof input === 'string' || input instanceof URL ? input : input.url,
      window.location.href
    );
    return (
      url.origin === window.location.origin &&
      (url.pathname.startsWith('/milab/') || url.pathname.startsWith('/api/'))
    );
  }

  function scheduleExpiry(expiresInMs) {
    if (!authenticated || redirecting || !Number.isFinite(expiresInMs) || expiresInMs <= 0) {
      return;
    }
    window.clearTimeout(expiryTimer);
    expiryTimer = window.setTimeout(checkSession, expiresInMs + 50);
  }

  function inspectResponse(response) {
    if (response.status === 401 && response.headers.get('X-Session-Expired') === '1') {
      returnHome();
    } else {
      const remaining = response.headers.get('X-Session-Expires-In');
      if (remaining !== null) scheduleExpiry(Number(remaining));
    }
  }

  window.fetch = async function sessionAwareFetch(input, options) {
    const response = await originalFetch(input, options);
    if (isMilabRequest(input)) inspectResponse(response);
    return response;
  };

  const originalSend = window.XMLHttpRequest.prototype.send;
  window.XMLHttpRequest.prototype.send = function sessionAwareSend(...args) {
    this.addEventListener('load', () => {
      if (this.responseURL && isMilabRequest(this.responseURL)) {
        inspectResponse({
          status: this.status,
          headers: { get: (name) => this.getResponseHeader(name) },
        });
      }
    });
    return originalSend.apply(this, args);
  };

  async function requestSession(path, method) {
    const token = document.querySelector('meta[name="csrf-token"]')?.content || '';
    const response = await window.fetch(`/milab/auth/session/${path}`, {
      method,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-CSRF-Token': token },
    });
    if (redirecting) return;
    if (!response.ok) throw new Error(`Session ${path}: HTTP ${response.status}`);
    const data = await response.json();
    if (data.ok !== true || !Number.isFinite(data.expiresInMs)) {
      throw new Error('Respuesta de sesion invalida');
    }
    document.getElementById('session-connection-error')?.remove();
    scheduleExpiry(data.expiresInMs);
  }

  async function checkSession() {
    if (redirecting) return;
    try {
      await requestSession('status', 'GET');
    } catch (error) {
      showConnectionError(error);
      expiryTimer = window.setTimeout(checkSession, 15000);
    }
  }

  async function sendActivity() {
    if (redirecting || !pendingActivity || activityRequest) return;
    pendingActivity = false;
    lastActivitySentAt = Date.now();
    activityRequest = requestSession('activity', 'POST');
    try {
      await activityRequest;
    } catch (error) {
      pendingActivity = true;
      showConnectionError(error);
    } finally {
      activityRequest = null;
    }
  }

  if (!authenticated) return;
  scheduleExpiry(Number(document.body.dataset.sessionExpiresIn));
  for (const event of ['pointerdown', 'pointermove', 'keydown', 'input', 'wheel']) {
    document.addEventListener(
      event,
      (interaction) => {
        if (!interaction.isTrusted) return;
        pendingActivity = true;
        if (Date.now() - lastActivitySentAt >= activityIntervalMs) void sendActivity();
      },
      { capture: true, passive: true }
    );
  }
  window.setInterval(() => {
    if (Date.now() - lastActivitySentAt >= activityIntervalMs) void sendActivity();
  }, activityIntervalMs / 2);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkSession();
  });
})();
