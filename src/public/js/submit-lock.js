/* global window, document, setTimeout, clearTimeout, console */

(function (window, document) {
  'use strict';

  var LOCKED_CLASS = 'is-submitting';
  var DATA_ORIGINAL_TEXT = 'data-original-text';
  var DATA_ORIGINAL_HTML = 'data-original-html';
  var DATA_SUBMIT_LOCK = 'data-submit-lock';
  var DATA_LOCK_TIMEOUT = 'data-lock-timeout-id';
  var SAFETY_TIMEOUT_MS = 15000;

  function isSubmitTrigger(el) {
    if (!el || el.nodeType !== 1) return false;
    var type = (el.getAttribute('type') || '').toLowerCase();
    return (
      (el.tagName === 'BUTTON' &&
        (type === 'submit' || type === '' || el.hasAttribute(DATA_SUBMIT_LOCK))) ||
      (el.tagName === 'INPUT' && (type === 'submit' || type === 'image')) ||
      (el.tagName === 'A' && el.hasAttribute(DATA_SUBMIT_LOCK)) ||
      el.hasAttribute(DATA_SUBMIT_LOCK)
    );
  }

  function closestSubmit(el) {
    var node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      if (isSubmitTrigger(node)) return node;
      node = node.parentNode;
    }
    return null;
  }

  function setLockedText(el, message) {
    if (el.tagName === 'INPUT') {
      if (!el.hasAttribute(DATA_ORIGINAL_TEXT)) {
        el.setAttribute(DATA_ORIGINAL_TEXT, el.value || '');
      }
      el.value = message || 'Procesando...';
    } else {
      if (!el.hasAttribute(DATA_ORIGINAL_HTML)) {
        el.setAttribute(DATA_ORIGINAL_HTML, el.innerHTML || '');
      }
      el.textContent = message || 'Procesando...';
    }
  }

  function restoreText(el) {
    if (el.tagName === 'INPUT') {
      if (el.hasAttribute(DATA_ORIGINAL_TEXT)) {
        el.value = el.getAttribute(DATA_ORIGINAL_TEXT) || '';
        el.removeAttribute(DATA_ORIGINAL_TEXT);
      }
    } else {
      if (el.hasAttribute(DATA_ORIGINAL_HTML)) {
        el.innerHTML = el.getAttribute(DATA_ORIGINAL_HTML) || '';
        el.removeAttribute(DATA_ORIGINAL_HTML);
      }
    }
  }

  function lock(el, message) {
    if (!el || el.nodeType !== 1) return;
    if (el.classList && el.classList.contains(LOCKED_CLASS)) return;

    try {
      if (el.classList) el.classList.add(LOCKED_CLASS);
      el.setAttribute('aria-busy', 'true');
      el.setAttribute('disabled', 'disabled');

      var labelMsg = message ? '' + message : 'Procesando...';
      setLockedText(el, labelMsg);

      var timeoutId = setTimeout(function () {
        if (window.console && typeof window.console.warn === 'function') {
          window.console.warn(
            '[MiLabSubmitLock] Safety timeout reached after ' +
              SAFETY_TIMEOUT_MS +
              'ms — releasing button to avoid permanent lock.'
          );
        }
        release(el);
      }, SAFETY_TIMEOUT_MS);
      el.setAttribute(DATA_LOCK_TIMEOUT, String(timeoutId));
    } catch (e) {
      if (window.console && typeof window.console.error === 'function') {
        window.console.error('[MiLabSubmitLock] lock failed:', e);
      }
    }
  }

  function release(el) {
    if (!el || el.nodeType !== 1) return;

    try {
      if (el.classList) el.classList.remove(LOCKED_CLASS);
      el.removeAttribute('aria-busy');
      el.removeAttribute('disabled');

      var existingTimeout = el.getAttribute(DATA_LOCK_TIMEOUT);
      if (existingTimeout) {
        clearTimeout(parseInt(existingTimeout, 10));
        el.removeAttribute(DATA_LOCK_TIMEOUT);
      }

      restoreText(el);
    } catch (e) {
      if (window.console && typeof window.console.error === 'function') {
        window.console.error('[MiLabSubmitLock] release failed:', e);
      }
    }
  }

  function documentClickHandler(e) {
    try {
      var target = e.target;
      var trigger = closestSubmit(target);
      if (!trigger) return;

      var explicitLock = trigger.hasAttribute(DATA_SUBMIT_LOCK);
      var isSubmitButton =
        (trigger.tagName === 'BUTTON' &&
          (trigger.getAttribute('type') || '').toLowerCase() === 'submit') ||
        (trigger.tagName === 'INPUT' &&
          ((trigger.getAttribute('type') || '').toLowerCase() === 'submit' ||
            (trigger.getAttribute('type') || '').toLowerCase() === 'image'));

      if (!(explicitLock || isSubmitButton)) return;

      var form =
        trigger.form ||
        (trigger.tagName === 'FORM'
          ? trigger
          : (function () {
              var n = trigger;
              while (n && n.nodeType === 1) {
                if (n.tagName === 'FORM') return n;
                n = n.parentNode;
              }
              return null;
            })());

      if (form && isSubmitButton) {
        if (form.dataset.submitting === '1') {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          return;
        }
        form.dataset.submitting = '1';
      }

      lock(trigger);

      if (form && form.dataset.submitting === '1') {
        setTimeout(function () {
          if (form.dataset.submitting !== '1') return;
          if (form.dataset.serverValidated !== '1' && form.dataset.clientSubmission !== '1') {
            form.dataset.submitting = '0';
          }
        }, SAFETY_TIMEOUT_MS);
      }
    } catch (err) {
      if (window.console && typeof window.console.error === 'function') {
        window.console.error('[MiLabSubmitLock] click handler failed:', err);
      }
    }
  }

  function documentSubmitHandler(e) {
    try {
      var form = e.target;
      if (!form || form.tagName !== 'FORM') return;
      if (form.dataset.submitting === '1') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      form.dataset.submitting = '1';

      var submits = form.querySelectorAll(
        'button[type="submit"], input[type="submit"], input[type="image"], [' +
          DATA_SUBMIT_LOCK +
          '="true"]'
      );
      for (var i = 0; i < submits.length; i++) {
        lock(submits[i]);
      }
    } catch (err) {
      if (window.console && typeof window.console.error === 'function') {
        window.console.error('[MiLabSubmitLock] submit handler failed:', err);
      }
    }
  }

  var MiLabSubmitLock = {
    LOCKED_CLASS: LOCKED_CLASS,
    SAFETY_TIMEOUT_MS: SAFETY_TIMEOUT_MS,
    lock: lock,
    release: release,
  };

  Object.defineProperty(window, 'MiLabSubmitLock', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: MiLabSubmitLock,
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function attachHandlers() {
      document.addEventListener('click', documentClickHandler, true);
      document.addEventListener('submit', documentSubmitHandler, true);
    });
  } else {
    document.addEventListener('click', documentClickHandler, true);
    document.addEventListener('submit', documentSubmitHandler, true);
  }
})(window, document);
