/* global window, document, MutationObserver */

(function (window, document) {
  'use strict';

  const actions = [
    [/^enviar reclamacion/i, 'bi-chat-left-text', 'primary'],
    [/^responder/i, 'bi-reply', 'primary'],
    [/^(ver detalle|detalle)$/i, 'bi-eye', 'info'],
    [/^ver dependencias$/i, 'bi-diagram-3', 'info'],
    [/^ver uals$/i, 'bi-grid-3x3-gap', 'info'],
    [/^ver (laboratoristas|coordinadores)$/i, 'bi-people', 'info'],
    [/^editar correo/i, 'bi-envelope', 'primary'],
    [/^editar usuario/i, 'bi-person-gear', 'primary'],
    [/^editar/i, 'bi-pencil-square', 'primary'],
    [/^eliminar/i, 'bi-trash', 'danger'],
    [/^(retirar|quitar)(\s|$)|^x$/i, 'bi-x-circle', 'danger'],
    [/^inactivar/i, 'bi-person-dash', 'danger'],
    [/^(activar|reactivar)/i, 'bi-check-circle', 'success'],
    [/^saldar/i, 'bi-check2-all', 'success'],
    [/^aplazar/i, 'bi-pause-circle', 'secondary'],
    [/^guardar/i, 'bi-floppy', 'primary'],
    [/^impersonar/i, 'bi-person-badge', 'primary'],
    [/^horarios$/i, 'bi-calendar-week', 'info'],
    [/^estado$/i, 'bi-toggles', 'primary'],
    [/^(solicitar|reservar)$/i, 'bi-calendar-plus', 'primary'],
    [/^convertir a bloqueo$/i, 'bi-shield-lock', 'danger'],
    [/^(aprobar|completar)/i, 'bi-check-circle', 'success'],
    [/^(rechazar|cancelar|no asistio)/i, 'bi-x-circle', 'danger'],
    [/^comentarios$/i, 'bi-chat-left-text', 'info'],
    [/^reasignar/i, 'bi-arrow-left-right', 'primary'],
    [/^(ultima hora|asignar ultima hora)$/i, 'bi-lightning-charge', 'warning'],
    [/^iniciar$/i, 'bi-play-circle', 'success'],
    [/^incidencia$/i, 'bi-exclamation-triangle', 'warning'],
    [/^pendiente por cerrar$/i, 'bi-hourglass-split', 'warning'],
    [/^cerrar$/i, 'bi-check2-circle', 'success'],
    [/^entregar$/i, 'bi-box-arrow-up-right', 'primary'],
    [/^recibir$/i, 'bi-box-arrow-in-down', 'success'],
    [
      /^(formato|reglamento|comprobante|descargar).*pdf|^formato diligenciado$/i,
      'bi-file-earmark-pdf',
      'info',
    ],
  ];

  function normalizeLabel(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function enhanceControl(control) {
    if (control.closest('table') !== control.closest('td')?.closest('table')) return;
    if (control.matches('[data-labs-toggle], [data-grid-action-ignore]')) return;

    const text = control.textContent.replace(/\s+/g, ' ').trim();
    const label =
      text === 'X'
        ? 'Quitar fila'
        : text || control.getAttribute('aria-label') || control.getAttribute('title');
    const action = actions.find(([pattern]) => pattern.test(normalizeLabel(label)));
    const existingIcon = control.querySelector('.bi:not(.app-grid-action-icon)');
    const existingIconName = existingIcon
      ? [...existingIcon.classList].find((name) => name.startsWith('bi-'))
      : null;

    if (
      !label ||
      (!action && !existingIconName && !control.classList.contains('app-grid-action'))
    ) {
      return;
    }

    const busy = control.getAttribute('aria-busy') === 'true';
    let icon = control.querySelector('.app-grid-action-icon');
    if (!icon) {
      icon = document.createElement('i');
      icon.className = 'app-grid-action-icon';
      icon.setAttribute('aria-hidden', 'true');
      control.appendChild(icon);
    }
    if (!busy) {
      icon.className = `bi ${action ? action[1] : existingIconName || 'bi-three-dots'} app-grid-action-icon`;
      control.dataset.gridActionTone = action ? action[2] : 'primary';
    }

    control.classList.add('app-grid-action');
    if (control.dataset.gridActionLabel !== label) {
      control.dataset.gridActionLabel = label;
      control.setAttribute('aria-label', label);
      if (!control.hasAttribute('title') || control.dataset.gridActionOwnTitle === 'true') {
        control.setAttribute('title', label);
        control.dataset.gridActionOwnTitle = 'true';
      }
    }

    const cell = control.closest('td');
    cell.classList.add('app-grid-actions-cell');
    // Do not relabel data columns that also contain a link or an inline form.
    const header = control.closest('table').tHead?.rows[0]?.cells[cell.cellIndex];
    if (
      header &&
      /^(ver detalle|editar|eliminar|quitar|gestion|activar\s*\/\s*inactivar|accion|acciones)$/i.test(
        normalizeLabel(header.textContent)
      )
    ) {
      header.textContent = 'Acciones';
      header.classList.add('app-grid-actions-heading');
    }
  }

  function enhanceTable(table) {
    table.querySelectorAll('tbody td button.btn, tbody td a.btn').forEach(enhanceControl);
  }

  function start() {
    const pendingTables = new Set();
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        const target =
          mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
        const table = target?.closest('table');
        if (table) pendingTables.add(table);
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          if (node.matches('table')) pendingTables.add(node);
          node.querySelectorAll('table').forEach((addedTable) => pendingTables.add(addedTable));
        });
      });
      if (pendingTables.size === 0) return;

      observer.disconnect();
      pendingTables.forEach((table) => {
        if (table.isConnected) enhanceTable(table);
      });
      pendingTables.clear();
      observe();
    });

    function observe() {
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }

    document.querySelectorAll('table').forEach(enhanceTable);
    observe();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})(window, document);
