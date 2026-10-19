/* global window, document */

(function () {
  const element = document.getElementById('appDialog');
  const home = element.parentElement;
  const title = element.querySelector('[data-dialog-title]');
  const message = element.querySelector('#appDialogMessage');
  const accept = element.querySelector('[data-dialog-accept]');
  const cancel = element.querySelector('[data-dialog-cancel]');
  const close = element.querySelector('[data-dialog-close]');
  const queue = [];
  let active = null;

  function showNext() {
    if (active || !queue.length) return;
    active = queue.shift();
    title.textContent = active.confirmation ? 'Confirmar acción' : 'Información';
    message.textContent = active.message;
    cancel.hidden = !active.confirmation;
    accept.textContent = active.confirmation ? 'Confirmar' : 'Aceptar';
    const parentModal = document.querySelector('.modal.show');
    // Keep an existing Bootstrap modal's focus trap and form state intact.
    if (parentModal) parentModal.appendChild(element);
    element.showModal();
    (active.confirmation ? cancel : accept).focus();
  }

  function finish() {
    if (!active || element.open) return;
    const completed = active;
    if (element.parentElement !== home) home.appendChild(element);
    active = null;
    completed.trigger?.focus();
    completed.resolve(completed.accepted === true);
    showNext();
  }

  function closeDialog(accepted = false) {
    if (!active) return;
    active.accepted = accepted;
    element.close();
    finish();
  }

  accept.addEventListener('click', () => closeDialog(true));
  cancel.addEventListener('click', () => closeDialog());
  close.addEventListener('click', () => closeDialog());
  element.addEventListener('cancel', function (event) {
    event.preventDefault();
    closeDialog();
  });
  element.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') event.stopPropagation();
  });
  element.addEventListener('close', finish);

  function open(message, confirmation) {
    const trigger = document.activeElement;
    if (
      [active, ...queue].some(
        (item) => item?.trigger === trigger && item.message === String(message)
      )
    ) {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      queue.push({ message: String(message), confirmation, resolve, trigger });
      showNext();
    });
  }

  window.MiLabDialogs = {
    confirm: (message) => open(message, true),
    alert: (message) => open(message, false),
  };

  const confirmedForms = new WeakSet();
  const pendingForms = new WeakSet();
  document.addEventListener(
    'submit',
    async function (event) {
      const form = event.target;
      const confirmation =
        form.dataset.confirmSubmit ||
        (form.dataset.facConfirm
          ? `¿Está seguro que desea eliminar ${form.dataset.facConfirm}?`
          : '');
      if (!confirmation || event.defaultPrevented) return;
      if (confirmedForms.delete(form)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (pendingForms.has(form)) return;
      const submitter = event.submitter;
      pendingForms.add(form);
      try {
        if (!(await window.MiLabDialogs.confirm(confirmation)) || !form.isConnected) return;
        confirmedForms.add(form);
        if (submitter) form.requestSubmit(submitter);
        else form.requestSubmit();
      } finally {
        pendingForms.delete(form);
        confirmedForms.delete(form);
      }
    },
    true
  );
})();
