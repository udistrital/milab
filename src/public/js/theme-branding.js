/* global window, document */

(function (window, document) {
  function resolveTheme() {
    var storedTheme;

    try {
      storedTheme = window.localStorage.getItem('theme');
    } catch {
      storedTheme = null;
    }

    if (storedTheme === 'dark' || storedTheme === 'light') {
      return storedTheme;
    }

    var documentTheme = document.documentElement.getAttribute('data-bs-theme');
    if (documentTheme === 'dark' || documentTheme === 'light') {
      return documentTheme;
    }

    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }

    return 'light';
  }

  function syncThemeLogos(mode) {
    var logos = document.querySelectorAll('[data-theme-logo]');

    logos.forEach(function (logo) {
      var lightSrc = logo.getAttribute('data-logo-light');
      var darkSrc = logo.getAttribute('data-logo-dark');
      var nextSrc = mode === 'dark' ? darkSrc : lightSrc;

      if (nextSrc && logo.getAttribute('src') !== nextSrc) {
        logo.setAttribute('src', nextSrc);
      }
    });
  }

  function applyThemeState(mode) {
    var nextMode = mode === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-bs-theme', nextMode);
    syncThemeLogos(nextMode);
    return nextMode;
  }

  function syncStoredTheme() {
    return applyThemeState(resolveTheme());
  }

  function handleSystemThemeChange() {
    var storedTheme;

    try {
      storedTheme = window.localStorage.getItem('theme');
    } catch {
      storedTheme = null;
    }

    if (storedTheme !== 'dark' && storedTheme !== 'light') {
      syncStoredTheme();
    }
  }

  window.MiLabThemeBranding = {
    applyThemeState: applyThemeState,
    resolveTheme: resolveTheme,
    syncStoredTheme: syncStoredTheme,
    syncThemeLogos: syncThemeLogos,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncStoredTheme);
  } else {
    syncStoredTheme();
  }

  if (window.matchMedia) {
    var mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleSystemThemeChange);
    } else if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(handleSystemThemeChange);
    }
  }

  window.addEventListener('storage', function (event) {
    if (event.key === 'theme') {
      syncStoredTheme();
    }
  });
})(window, document);
