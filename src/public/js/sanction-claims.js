/* global document */

(function () {
  'use strict';

  function addEntry(container, title, text, date) {
    const entry = document.createElement('div');
    entry.className = 'border rounded p-3 mb-2';
    const heading = document.createElement('strong');
    heading.textContent = title;
    const body = document.createElement('p');
    body.className = 'app-claim-text mb-1';
    body.textContent = text;
    entry.append(heading, body);
    if (date) {
      const timestamp = document.createElement('small');
      timestamp.textContent = new Date(date).toLocaleString('es-CO', {
        timeZone: 'America/Bogota',
      });
      entry.append(timestamp);
    }
    container.append(entry);
  }

  function renderHistory(container, claim) {
    container.replaceChildren();
    if (!claim || !claim.id) {
      container.textContent = 'No hay reclamaciones registradas para esta sanción.';
      return;
    }
    addEntry(
      container,
      `Reclamación del estudiante${claim.estudiante ? ': ' + claim.estudiante : ''}`,
      claim.texto,
      claim.fecha_creacion
    );
    if (claim.fecha_respuesta) {
      addEntry(
        container,
        `${claim.decision === 'PROCEDE' ? 'Procede' : 'No procede'} — ${claim.respondido_por || 'Laboratorista responsable'}`,
        claim.respuesta,
        claim.fecha_respuesta
      );
    } else {
      addEntry(
        container,
        'Pendiente de respuesta',
        `Responsable: ${claim.responsable || 'Laboratorista asignado'}`
      );
    }
  }

  const modal = document.getElementById('reclamacionModal');
  if (modal) {
    const form = modal.querySelector('[data-claim-form]');
    const text = modal.querySelector('#claimText');
    const counter = modal.querySelector('[data-claim-counter]');
    const decision = modal.querySelector('#claimDecision');
    text.addEventListener('input', function () {
      counter.textContent = `${text.value.length} / 500 caracteres`;
    });
    modal.addEventListener('show.bs.modal', function (event) {
      const trigger = event.relatedTarget;
      if (!trigger) return;
      const claim = JSON.parse(trigger.dataset.claim);
      const action = trigger.dataset.claimAction;
      modal.querySelectorAll('[data-claim-field]').forEach(function (field) {
        field.textContent = claim[field.dataset.claimField] || '-';
      });
      renderHistory(modal.querySelector('[data-claim-history]'), claim);
      form.reset();
      text.value = '';
      counter.textContent = '0 / 500 caracteres';
      const editable = action === 'claim' || action === 'respond';
      form.classList.toggle('d-none', !editable);
      form.removeAttribute('action');
      text.disabled = !editable;
      decision.disabled = action !== 'respond';
      decision.required = action === 'respond';
      modal.querySelector('[data-claim-decision]').classList.toggle('d-none', action !== 'respond');
      if (editable) {
        form.action =
          action === 'claim'
            ? `/milab/api/sanciones/mis-sanciones/${encodeURIComponent(claim.multa_id)}/reclamar`
            : `/milab/api/sanciones/reclamaciones/${encodeURIComponent(claim.id)}/responder`;
        text.name = action === 'claim' ? 'texto' : 'respuesta';
        modal.querySelector('[data-claim-text-label]').textContent =
          action === 'claim' ? 'Tu reclamación' : 'Explicación de la decisión';
        modal.querySelector('[data-claim-guidance]').textContent =
          action === 'claim'
            ? 'Explica por qué solicitas revisar esta sanción. No podrás editar el texto ni enviar otra reclamación.'
            : 'Responde al estudiante e indica si procede su reclamación. La respuesta es definitiva y no cambia automáticamente la sanción.';
        modal.querySelector('[data-claim-submit]').textContent =
          action === 'claim' ? 'Enviar reclamación' : 'Enviar respuesta definitiva';
      }
      const readForm = modal.querySelector('[data-claim-read-form]');
      if (readForm) {
        const unread = Boolean(claim.fecha_respuesta && !claim.fecha_lectura);
        readForm.classList.toggle('d-none', !unread);
        readForm.action = `/milab/api/sanciones/mis-sanciones/${encodeURIComponent(claim.id)}/leida`;
      }
      const reassignForm = modal.querySelector('[data-claim-reassign-form]');
      if (reassignForm) {
        reassignForm.reset();
        reassignForm.classList.toggle('d-none', action !== 'reassign');
        reassignForm.action = `/milab/api/sanciones/reclamaciones/${encodeURIComponent(claim.id)}/reasignar`;
      }
    });
  }

  const detailModal = document.getElementById('detalleSancionModal');
  if (detailModal) {
    let controller;
    const panel = detailModal.querySelector('[data-claim-history]');
    function cancelHistory() {
      if (controller) controller.abort();
      controller = null;
      panel.replaceChildren();
      panel.removeAttribute('role');
    }
    detailModal.addEventListener('hidden.bs.modal', cancelHistory);
    detailModal.addEventListener('show.bs.modal', async function (event) {
      cancelHistory();
      const trigger = event.relatedTarget;
      const id =
        trigger?.getAttribute('data-sancion-id') ||
        trigger?.closest('tr')?.querySelector('[data-sancion-id]')?.getAttribute('data-sancion-id');
      if (!id) {
        panel.textContent = 'No fue posible identificar la sanción para consultar su historial.';
        return;
      }
      const request = new AbortController();
      controller = request;
      panel.textContent = 'Consultando historial de reclamación...';
      try {
        const response = await fetch(
          `/milab/api/get_list_multas/${encodeURIComponent(id)}/reclamaciones`,
          { signal: request.signal, headers: { Accept: 'application/json' } }
        );
        const data = await response.json();
        if (!response.ok || !data.ok)
          throw new Error(data.message || 'No fue posible consultar el historial.');
        if (controller !== request) return;
        renderHistory(panel, data.history[0]);
      } catch (error) {
        if (error.name === 'AbortError' || controller !== request) return;
        panel.textContent =
          'No fue posible cargar el historial de reclamación. Cierra el detalle y vuelve a intentarlo.';
        panel.setAttribute('role', 'alert');
      }
    });
  }
})();
