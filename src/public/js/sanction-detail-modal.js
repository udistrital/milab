/* global document, Option */

let activeNameRequestController = null;
let activeNameRequestId = 0;
let activeNameRetryTimer = null;
let activeSgaRequestController = null;
let activeSgaRequestId = 0;

function todayInBogota() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

function updateOatiStatus(message) {
  const statusTarget = document.querySelector('[data-oati-status]');
  if (!statusTarget) {
    return;
  }

  if (message) {
    statusTarget.textContent = message;
    statusTarget.classList.remove('d-none');
    return;
  }

  statusTarget.textContent = '';
  statusTarget.classList.add('d-none');
}

function stopActiveNameLookup() {
  activeNameRequestId += 1;
  if (activeNameRequestController) {
    activeNameRequestController.abort();
    activeNameRequestController = null;
  }
  if (activeNameRetryTimer) {
    clearTimeout(activeNameRetryTimer);
    activeNameRetryTimer = null;
  }
  updateOatiStatus('');
}

function stopSgaDebtLookup() {
  activeSgaRequestId += 1;
  if (activeSgaRequestController) {
    activeSgaRequestController.abort();
    activeSgaRequestController = null;
  }

  const panel = document.querySelector('[data-sga-debts-panel]');
  const status = document.querySelector('[data-sga-debts-status]');
  const list = document.querySelector('[data-sga-debts-list]');
  if (panel) panel.classList.add('d-none');
  if (status) status.textContent = '';
  if (list) list.replaceChildren();
}

function addSgaDebtField(container, label, value) {
  const field = document.createElement('div');
  field.className = 'sanction-sga-field';
  const labelElement = document.createElement('span');
  labelElement.textContent = label;
  const valueElement = document.createElement('strong');
  valueElement.textContent = value || '-';
  field.append(labelElement, valueElement);
  container.append(field);
}

async function loadSgaDebtsForStudent(sanctionId, isConfigured) {
  const panel = document.querySelector('[data-sga-debts-panel]');
  const status = document.querySelector('[data-sga-debts-status]');
  const list = document.querySelector('[data-sga-debts-list]');
  if (!panel || !status || !list) return;

  panel.classList.remove('d-none');
  list.replaceChildren();
  if (!isConfigured) {
    status.textContent = 'La consulta SGA no está configurada en este ambiente.';
    status.dataset.state = 'warning';
    return;
  }

  const requestId = activeSgaRequestId;
  const controller = new AbortController();
  activeSgaRequestController = controller;
  status.textContent = 'Consultando multas activas en SGA...';
  status.dataset.state = 'loading';

  try {
    const response = await fetch(
      `/milab/api/get_list_multas/${encodeURIComponent(sanctionId)}/sga-multas`,
      { signal: controller.signal, headers: { Accept: 'application/json' } }
    );
    const result = await response.json();
    if (requestId !== activeSgaRequestId) return;
    if (!response.ok || !result.ok) {
      throw new Error(result.message || 'No fue posible consultar SGA.');
    }
    if (!result.configured) {
      status.textContent = 'La consulta SGA no está configurada en este ambiente.';
      status.dataset.state = 'warning';
      return;
    }
    if (!result.supported) {
      status.textContent = 'La consulta de deudores SGA aplica únicamente a estudiantes.';
      status.dataset.state = 'warning';
      return;
    }

    const debts = Array.isArray(result.multas) ? result.multas : [];
    if (!debts.length) {
      status.textContent = 'No se encontraron multas activas en SGA.';
      status.dataset.state = 'clear';
      return;
    }

    status.textContent = `${debts.length} multa(s) activa(s) reportada(s) por SGA.`;
    status.dataset.state = 'warning';
    debts.forEach((debt) => {
      const item = document.createElement('article');
      item.className = 'sanction-sga-item';
      const title = document.createElement('h6');
      title.textContent = debt.DEU_MATERIAL || 'Multa reportada por SGA';
      const fields = document.createElement('div');
      fields.className = 'sanction-sga-grid';
      addSgaDebtField(fields, 'Código', debt.DEU_EST_COD);
      addSgaDebtField(fields, 'Estado SGA', debt.DEU_ESTADO);
      addSgaDebtField(fields, 'Fecha', debt.DEU_FECHA);
      addSgaDebtField(fields, 'Periodo', [debt.DEU_ANO, debt.DEU_PER].filter(Boolean).join(' / '));
      addSgaDebtField(fields, 'Valor reportado', debt.DEU_MULTA);
      addSgaDebtField(fields, 'Fecha de pago', debt.DEU_FECHA_PAGO || 'Pendiente');
      item.append(title, fields);
      list.append(item);
    });
  } catch (error) {
    if (error.name === 'AbortError' || requestId !== activeSgaRequestId) return;
    status.textContent = error.message || 'No fue posible consultar multas en SGA.';
    status.dataset.state = 'error';
  } finally {
    if (activeSgaRequestController === controller) {
      activeSgaRequestController = null;
    }
  }
}

function fetchNameWithRetry(requestId, documento, attempt) {
  const nombreTarget = document.querySelector('[data-detail-field="nombre"]');
  if (!nombreTarget || requestId !== activeNameRequestId) {
    return;
  }

  if (attempt <= 1) {
    nombreTarget.textContent = 'Cargando...';
    updateOatiStatus('Consultando OATI...');
  } else {
    nombreTarget.textContent = `Cargando... Reintentando (${attempt - 1})`;
    updateOatiStatus(`Consultando OATI... intento ${attempt}`);
  }

  activeNameRequestController = new AbortController();
  const requestController = activeNameRequestController;
  const timeoutId = setTimeout(function () {
    requestController.abort();
  }, 6000);

  fetch(`/milab/api/get_list_multas/resolve_name?documento=${encodeURIComponent(documento)}`, {
    signal: requestController.signal,
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    })
    .then((data) => {
      if (requestId !== activeNameRequestId) {
        return;
      }

      const nombre = data && typeof data.nombre === 'string' ? data.nombre.trim() : '';
      if (nombre) {
        nombreTarget.textContent = nombre;
        updateOatiStatus('');
        return;
      }

      throw new Error('Nombre vacio');
    })
    .catch(() => {
      if (requestId !== activeNameRequestId) {
        return;
      }

      activeNameRetryTimer = setTimeout(
        function () {
          if (requestId !== activeNameRequestId) {
            return;
          }
          fetchNameWithRetry(requestId, documento, attempt + 1);
        },
        Math.min(5000, 1000 * attempt)
      );
    })
    .finally(() => {
      clearTimeout(timeoutId);
      if (activeNameRequestController === requestController) {
        activeNameRequestController = null;
      }
    });
}

const detailModal = document.getElementById('detalleSancionModal');
if (detailModal) {
  detailModal.addEventListener('hidden.bs.modal', function () {
    stopActiveNameLookup();
    stopSgaDebtLookup();
  });
}

document.addEventListener('click', function (event) {
  const trigger = event.target.closest('.app-detail-button, .app-sanction-action-button');

  if (!trigger) {
    return;
  }

  // Edit/Saldar/Activar buttons can miss detail attributes; reuse row detail button data.
  const detailSource = trigger.getAttribute('data-sancion-documento')
    ? trigger
    : trigger.closest('tr')?.querySelector('.app-detail-button[data-sancion-documento]');

  const source = detailSource || trigger;
  stopSgaDebtLookup();

  const fields = {
    id: source.getAttribute('data-sancion-id'),
    nombre: source.getAttribute('data-sancion-nombre'),
    documento: source.getAttribute('data-sancion-documento'),
    codigo: source.getAttribute('data-sancion-codigo'),
    fecha: source.getAttribute('data-sancion-fecha'),
    estado: source.getAttribute('data-sancion-estado'),
    laboratorista: source.getAttribute('data-sancion-laboratorista'),
    ual: source.getAttribute('data-sancion-ual'),
    facultad: source.getAttribute('data-sancion-facultad'),
    dependencia: source.getAttribute('data-sancion-dependencia'),
    categoria: source.getAttribute('data-sancion-categoria'),
    tipo: source.getAttribute('data-sancion-tipo'),
    observaciones: source.getAttribute('data-sancion-observaciones'),
  };

  Object.keys(fields).forEach(function (key) {
    const target = document.querySelector(`[data-detail-field="${key}"]`);
    if (target) {
      target.textContent = fields[key] || '-';
    }
  });

  const documento = fields.documento || '';
  const nombreLocal = String(fields.nombre || '').trim();
  stopActiveNameLookup();

  if (nombreLocal) {
    const nombreTarget = document.querySelector('[data-detail-field="nombre"]');
    if (nombreTarget) {
      nombreTarget.textContent = nombreLocal;
    }
    updateOatiStatus('');
  } else if (documento) {
    const currentRequestId = activeNameRequestId;
    fetchNameWithRetry(currentRequestId, documento, 1);
  } else {
    updateOatiStatus('No se pudo consultar OATI: documento no disponible.');
  }

  const action = trigger.getAttribute('data-sancion-action') || '';
  if (
    trigger.classList.contains('app-detail-button') &&
    !action &&
    source.getAttribute('data-sancion-tipo-persona') === 'estudiante'
  ) {
    loadSgaDebtsForStudent(fields.id, source.getAttribute('data-sga-configurado') === 'true');
  }

  const actionPanel = document.querySelector('[data-sanction-action-panel]');
  const actionTitle = document.querySelector('[data-sanction-action-title]');
  const actionForms = document.querySelectorAll('[data-sanction-action-form]');

  if (actionPanel) {
    actionPanel.classList.toggle('d-none', !action);
  }

  if (actionTitle) {
    const actionTitles = {
      activate: 'Activar sanción',
      saldar: 'Saldar sanción pendiente',
      defer: 'Aplazar sanción activa',
      reactivate: 'Reactivar sanción aplazada',
      remove: 'Saldar sanción directamente',
    };
    actionTitle.textContent = actionTitles[action] || 'Editar sanción activa';
  }

  actionForms.forEach(function (form) {
    const isActiveForm = form.getAttribute('data-sanction-action-form') === action;
    form.classList.toggle('d-none', !isActiveForm);
    const idInput = form.querySelector('[data-sanction-action-id]');
    if (idInput) {
      idInput.value = fields.id || '';
    }
  });

  if (action === 'edit') {
    const categorySelect = document.querySelector('#categoria_sancion_listado');
    const typeSelect = document.querySelector('#tipo_sancion_edicion_listado');
    if (categorySelect) {
      categorySelect
        .querySelectorAll('[data-historical-category]')
        .forEach((option) => option.remove());
      const currentCategory = fields.categoria || '';
      if (
        currentCategory &&
        !Array.from(categorySelect.options).some((option) => option.value === currentCategory)
      ) {
        const option = new Option(currentCategory + ' (categoría histórica)', currentCategory);
        option.setAttribute('data-historical-category', 'true');
        categorySelect.add(option);
      }
      categorySelect.value = currentCategory;
    }
    if (typeSelect) typeSelect.value = fields.tipo || '';

    const dateInput = document.querySelector('#fecha_sancion_edicion_listado');
    if (dateInput) {
      dateInput.max = todayInBogota();
      dateInput.value = /^\d{4}-\d{2}-\d{2}$/.test(fields.fecha || '') ? fields.fecha : '';
    }
  }
});
