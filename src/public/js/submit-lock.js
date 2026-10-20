/* global window, document */

(function (window, document) {
  'use strict';

  var LOCKED_CLASS = 'is-submitting';
  var DATA_ORIGINAL_TEXT = 'data-original-text';
  var DATA_ORIGINAL_HTML = 'data-original-html';
  var DATA_SUBMIT_LOCK = 'data-submit-lock';
  var DATA_LOCK_TIMEOUT = 'data-lock-timeout-id';
  var SAFETY_TIMEOUT_MS = 15000;
  var submitterFields = new WeakMap();

  function preserveSubmitter(form, submitter) {
    var previous = submitterFields.get(form);
    if (previous) previous.remove();
    submitterFields.delete(form);
    if (!submitter || !submitter.name || submitter.disabled) return;
    // Disabled submit buttons are excluded from the browser's form data.
    var field = document.createElement('input');
    field.type = 'hidden';
    field.name = submitter.name;
    field.value = submitter.value;
    form.appendChild(field);
    submitterFields.set(form, field);
  }

  function isAllowedActionTag(el) {
    if (!el || el.nodeType !== 1) return false;
    var tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'A') return true;
    if (tag === 'INPUT') {
      var type = (el.getAttribute('type') || 'text').toLowerCase();
      return type === 'submit' || type === 'image';
    }
    return false;
  }

  function hasExplicitWriteLock(el) {
    if (!el || el.nodeType !== 1) return false;
    var attr = (el.getAttribute(DATA_SUBMIT_LOCK) || '').toLowerCase();
    return attr === 'true';
  }

  function isSubmitTrigger(el) {
    return isAllowedActionTag(el) && hasExplicitWriteLock(el);
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
    if (!isAllowedActionTag(el)) return;
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
    if (!isAllowedActionTag(el)) return;
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
    if (!isAllowedActionTag(el)) return;
    if (!hasExplicitWriteLock(el)) return;
    if (el.classList && el.classList.contains(LOCKED_CLASS)) return;

    try {
      if (el.classList) el.classList.add(LOCKED_CLASS);
      el.setAttribute('aria-busy', 'true');
      el.setAttribute('disabled', 'disabled');

      var labelMsg = message ? '' + message : 'Procesando...';
      setLockedText(el, labelMsg);

      var timeoutId = setTimeout(function () {
        release(el);
      }, SAFETY_TIMEOUT_MS);
      el.setAttribute(DATA_LOCK_TIMEOUT, String(timeoutId));
    } catch {
      /* no-op */
    }
  }

  function release(el) {
    if (!isAllowedActionTag(el)) return;

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
      var form = getClosestForm(el);
      if (form && !form.querySelector('.' + LOCKED_CLASS)) {
        delete form.dataset.submitting;
        var field = submitterFields.get(form);
        if (field) field.remove();
        submitterFields.delete(form);
      }
    } catch {
      /* no-op */
    }
  }

  function getClosestForm(trigger) {
    if (!trigger) return null;
    if (trigger.form) return trigger.form;
    if (trigger.tagName === 'FORM') return trigger;
    var node = trigger;
    while (node && node.nodeType === 1) {
      if (node.tagName === 'FORM') return node;
      node = node.parentNode;
    }
    return null;
  }

  function documentClickHandler(e) {
    try {
      var target = e.target;
      var trigger = closestSubmit(target);
      if (!trigger) return;

      var form = getClosestForm(trigger);
      if (!form) return;

      if (form.dataset.submitting === '1') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    } catch {
      /* no-op */
    }
  }

  function documentSubmitHandler(e) {
    try {
      var form = e.target;
      if (!form || form.tagName !== 'FORM' || e.defaultPrevented) return;
      if (form.dataset.submitting === '1') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      var submits = form.querySelectorAll(
        'button[' +
          DATA_SUBMIT_LOCK +
          '="true"], input[type="submit"][' +
          DATA_SUBMIT_LOCK +
          '="true"], input[type="image"][' +
          DATA_SUBMIT_LOCK +
          '="true"], a[' +
          DATA_SUBMIT_LOCK +
          '="true"]'
      );
      if (!submits.length) return;
      form.dataset.submitting = '1';
      if (Array.prototype.includes.call(submits, e.submitter) && !e.submitter.disabled) {
        preserveSubmitter(form, e.submitter);
      }
      for (var i = 0; i < submits.length; i++) {
        lock(submits[i]);
      }
    } catch {
      /* no-op */
    }
  }

  function runQuickCheck() {
    var lockable = document.querySelectorAll('[' + DATA_SUBMIT_LOCK + '="true"]');
    return {
      explicitDataSubmitLock: lockable.length,
    };
  }

  var MiLabSubmitLock = {
    LOCKED_CLASS: LOCKED_CLASS,
    SAFETY_TIMEOUT_MS: SAFETY_TIMEOUT_MS,
    lock: lock,
    release: release,
    preserveSubmitter: preserveSubmitter,
    runQuickCheck: runQuickCheck,
  };

  try {
    Object.defineProperty(window, 'MiLabSubmitLock', {
      configurable: false,
      enumerable: true,
      writable: false,
      value: MiLabSubmitLock,
    });
  } catch {
    window.MiLabSubmitLock = MiLabSubmitLock;
  }

  function attachHandlers() {
    document.addEventListener('click', documentClickHandler, true);
    document.addEventListener('submit', documentSubmitHandler);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachHandlers);
  } else {
    attachHandlers();
  }
})(window, document);
