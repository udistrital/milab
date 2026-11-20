/* global document, window */

(function () {
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
  const bulkButton = document.querySelector('[data-sga-block-bulk]');
  const selectionCount = document.querySelector('[data-sga-block-selection-count]');
  const selectAll = document.querySelector('.app-sga-block-select-all');
  const selects = Array.from(document.querySelectorAll('.app-sga-block-select'));
  const toggles = Array.from(document.querySelectorAll('.app-sga-block-toggle:not([disabled])'));

  if (!selects.length && !toggles.length && !bulkButton) return;

  const BASE = '/milab/api/get_list_multas';
  const dialogs = window.MiLabDialogs || {};

  function notify(message) {
    return dialogs.alert ? dialogs.alert(message) : Promise.resolve();
  }

  function confirmAction(message) {
    return dialogs.confirm ? dialogs.confirm(message) : Promise.resolve(true);
  }

  async function postJson(path, body) {
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify(body),
    });

    let payload;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    return { ok: response.ok, payload };
  }

  function refreshSelectionState() {
    const checked = selects.filter((checkbox) => checkbox.checked && !checkbox.disabled);

    if (selectionCount) {
      selectionCount.textContent = `${checked.length} seleccionada(s)`;
    }
    if (bulkButton) {
      bulkButton.disabled = checked.length === 0;
    }
    if (selectAll) {
      const available = selects.filter((checkbox) => !checkbox.disabled);
      selectAll.checked = available.length > 0 && checked.length === available.length;
      selectAll.indeterminate = checked.length > 0 && checked.length < available.length;
    }
  }

  selects.forEach((checkbox) => checkbox.addEventListener('change', refreshSelectionState));

  if (selectAll) {
    selectAll.addEventListener('change', function () {
      selects.forEach((checkbox) => {
        if (!checkbox.disabled) checkbox.checked = selectAll.checked;
      });
      refreshSelectionState();
    });
  }

  toggles.forEach((toggle) => {
    toggle.addEventListener('change', async function () {
      if (!toggle.checked) return;

      const multaId = toggle.value;
      const accepted = await confirmAction(
        '¿Generar el bloqueo de recibo de pago en SGA para esta sanción?'
      );
      if (!accepted) {
        toggle.checked = false;
        return;
      }

      toggle.disabled = true;
      const { ok, payload } = await postJson(
        `${BASE}/${encodeURIComponent(multaId)}/bloquear-recibo`,
        {}
      );

      if (!ok) {
        toggle.checked = false;
        toggle.disabled = false;
        await notify(
          payload?.message || 'No fue posible generar el bloqueo de recibo de pago en SGA.'
        );
        return;
      }

      await notify('Bloqueo de recibo de pago generado en SGA.');
      window.location.reload();
    });
  });

  if (bulkButton) {
    bulkButton.addEventListener('click', async function () {
      const ids = selects
        .filter((checkbox) => checkbox.checked && !checkbox.disabled)
        .map((checkbox) => Number(checkbox.value));
      if (!ids.length) return;

      const accepted = await confirmAction(
        `¿Generar el bloqueo de recibo de pago en SGA para ${ids.length} sanción(es)?`
      );
      if (!accepted) return;

      bulkButton.disabled = true;
      const { ok, payload } = await postJson(`${BASE}/bloquear-recibo-masivo`, {
        multa_ids: ids,
      });

      if (!ok) {
        bulkButton.disabled = false;
        await notify(
          payload?.message || 'No fue posible generar los bloqueos de recibo de pago en SGA.'
        );
        return;
      }

      const total = payload?.total ?? ids.length;
      const applied = payload?.applied ?? 0;
      const failed = Array.isArray(payload?.results)
        ? payload.results.filter((result) => !result.ok)
        : [];
      let message = `Se generó el bloqueo en ${applied} de ${total} sanción(es).`;
      if (failed.length) {
        message += ` No aplicadas: ${failed
          .map((result) => `${result.multa_id} (${result.message})`)
          .join('; ')}`;
      }

      await notify(message);
      window.location.reload();
    });
  }

  refreshSelectionState();
})();
