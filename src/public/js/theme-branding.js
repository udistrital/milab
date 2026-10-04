/* global window, document */

(function (window, document) {
  var FORCED_THEME = 'light';

  function resolveTheme() {
    return FORCED_THEME;
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

  function applyThemeState() {
    var nextMode = FORCED_THEME;
    if (document.documentElement.getAttribute('data-bs-theme') !== nextMode) {
      document.documentElement.setAttribute('data-bs-theme', nextMode);
    }
    syncThemeLogos(nextMode);
    return nextMode;
  }

  function clearStoredThemePreference() {
    try {
      window.localStorage.removeItem('theme');
    } catch {
      // ignore storage access errors
    }
  }

  function syncStoredTheme() {
    clearStoredThemePreference();
    return applyThemeState(resolveTheme());
  }

  window.MiLabThemeBranding = {
    applyThemeState: applyThemeState,
    resolveTheme: resolveTheme,
    syncStoredTheme: syncStoredTheme,
    syncThemeLogos: syncThemeLogos,
  };

  syncStoredTheme();

  var themeObserver = new window.MutationObserver(function () {
    if (document.documentElement.getAttribute('data-bs-theme') !== FORCED_THEME) {
      syncStoredTheme();
    }
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-bs-theme'],
  });

  window.addEventListener('storage', function (event) {
    if (event.key === 'theme') {
      syncStoredTheme();
    }
  });
})(window, document);
