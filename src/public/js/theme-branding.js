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
    document.documentElement.setAttribute('data-bs-theme', nextMode);
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

  function hideThemeToggles() {
    var toggles = document.querySelectorAll('[data-theme-toggle]');

    toggles.forEach(function (toggle) {
      toggle.setAttribute('hidden', 'hidden');
      toggle.setAttribute('aria-hidden', 'true');
      toggle.style.display = 'none';
    });
  }

  function syncStoredTheme() {
    clearStoredThemePreference();
    hideThemeToggles();
    return applyThemeState(resolveTheme());
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

  window.addEventListener('storage', function (event) {
    if (event.key === 'theme') {
      syncStoredTheme();
    }
  });
})(window, document);
