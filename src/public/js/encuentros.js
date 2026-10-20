/* global bootstrap, document, window */

(function () {
  const apiBase = '/milab/encuentros/api';
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
  const canAnnulCertificates =
    document.getElementById('encuentros-shell').dataset.canAnnul === 'true';
  const pageState = { page: 1, pageSize: 20, eventId: null, previewRows: [] };
  const eventFormCard = document.getElementById('event-form-card');
  const eventForm = document.getElementById('event-form');
  const eventRows = document.getElementById('event-rows');
  const detailModal = new bootstrap.Modal(document.getElementById('event-detail-modal'));

  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('X-CSRF-Token', csrfToken);
    if (options.body && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      headers,
      credentials: 'same-origin',
    });
    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json') ? await response.json() : null;
    if (!response.ok || body?.ok === false) {
      throw new Error(body?.message || `La solicitud falló (${response.status}).`);
    }
    return body;
  }

  function showAlert(message, variant = 'info') {
    const alert = document.getElementById('encuentros-alert');
    alert.className = `alert alert-${variant}`;
    alert.textContent = message;
    alert.classList.remove('d-none');
    window.setTimeout(() => alert.classList.add('d-none'), 7000);
  }

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function addCell(row, text) {
    const cell = element('td', text ?? '—');
    row.appendChild(cell);
    return cell;
  }

  function formatDate(value) {
    if (!value) return '—';
    const [year, month, day] = String(value).slice(0, 10).split('-');
    return year && month && day ? `${day}/${month}/${year}` : value;
  }

  function formatTimestamp(value) {
    if (!value) return '—';
    return new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/Bogota',
    }).format(new Date(value));
  }

  async function loadEvents() {
    eventRows.replaceChildren(element('tr'));
    eventRows.firstElementChild.appendChild(
      element('td', 'Cargando eventos…', 'text-center text-muted py-4')
    );
    eventRows.firstElementChild.firstElementChild.colSpan = 8;
    const params = new URLSearchParams({
      page: String(pageState.page),
      pageSize: String(pageState.pageSize),
      q: document.getElementById('filter-search').value.trim(),
      fecha: document.getElementById('filter-date').value,
      organizador: document.getElementById('filter-organizer').value.trim(),
      estado: document.getElementById('filter-state').value,
      sort: document.getElementById('filter-sort').value,
      direction: document.getElementById('filter-direction').value,
    });
    try {
      const data = await request(`/eventos?${params}`);
      eventRows.replaceChildren();
      if (!data.eventos.length) {
        const row = element('tr');
        const cell = element('td', 'No se encontraron eventos.');
        cell.colSpan = 8;
        cell.className = 'text-center text-muted py-4';
        row.appendChild(cell);
        eventRows.appendChild(row);
      }
      data.eventos.forEach((event) => {
        const row = element('tr');
        addCell(row, event.nombre);
        addCell(row, formatDate(event.fecha));
        addCell(
          row,
          `${String(event.hora_inicio).slice(0, 5)} – ${String(event.hora_fin).slice(0, 5)}`
        );
        addCell(row, event.lugar);
        addCell(row, event.organizador);
        const stateCell = addCell(row, event.estado.replaceAll('_', ' '));
        stateCell.classList.add('text-capitalize');
        addCell(row, event.participantes);
        const actions = element('td');
        actions.className = 'text-nowrap';
        actions.append(
          actionButton('Detalle', 'btn-outline-primary', () => openDetail(event.id)),
          document.createTextNode(' '),
          actionButton(
            'Editar',
            'btn-outline-secondary',
            () => editEvent(event.id),
            event.estado !== 'programado'
          )
        );
        row.appendChild(actions);
        eventRows.appendChild(row);
      });
      const pagination = data.paginacion;
      document.getElementById('event-pagination-label').textContent =
        `${pagination.total} eventos · página ${pagination.pagina} de ${Math.max(1, pagination.paginas)}`;
      document.getElementById('event-page-prev').disabled = pageState.page <= 1;
      document.getElementById('event-page-next').disabled =
        pageState.page >= Math.max(1, pagination.paginas);
    } catch (error) {
      eventRows.replaceChildren();
      const row = element('tr');
      const cell = element('td', error.message, 'text-center text-danger py-4');
      cell.colSpan = 8;
      row.appendChild(cell);
      eventRows.appendChild(row);
    }
  }

  function actionButton(label, style, callback, disabled = false) {
    const button = element('button', label, `btn btn-sm ${style}`);
    button.type = 'button';
    button.disabled = disabled;
    button.addEventListener('click', callback);
    return button;
  }

  function setFormMode(event = null) {
    eventForm.reset();
    document.getElementById('event-id').value = event?.id || '';
    document.getElementById('event-form-title').textContent = event
      ? 'Editar evento'
      : 'Crear evento';
    document.getElementById('btn-guardar-evento').textContent = event
      ? 'Guardar cambios'
      : 'Guardar evento';
    document.getElementById('event-template').required = !event;
    document.getElementById('template-required').classList.toggle('d-none', Boolean(event));
    document.getElementById('template-config').value = event
      ? JSON.stringify(event.plantilla_config, null, 2)
      : `{
  "nombre": {"x": 420, "y": 280, "fontSize": 24, "align": "center"},
  "evento": {"x": 420, "y": 235, "fontSize": 16, "align": "center"},
  "fecha_evento": {"x": 420, "y": 205, "fontSize": 12, "align": "center"},
  "qr_verificacion": {"x": 690, "y": 35, "width": 70, "type": "qr"}
}`;
    if (event) {
      document.getElementById('event-name').value = event.nombre || '';
      document.getElementById('event-organizer').value = event.organizador || '';
      document.getElementById('event-description').value = event.descripcion || '';
      document.getElementById('event-date').value = String(event.fecha).slice(0, 10);
      document.getElementById('event-start').value = String(event.hora_inicio).slice(0, 5);
      document.getElementById('event-end').value = String(event.hora_fin).slice(0, 5);
      document.getElementById('event-place').value = event.lugar || '';
    }
    eventFormCard.classList.remove('d-none');
    eventFormCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function editEvent(eventId) {
    try {
      const data = await request(`/eventos/${eventId}`);
      if (data.evento.estado !== 'programado') {
        showAlert('Solo se pueden editar eventos programados.', 'warning');
        return;
      }
      setFormMode(data.evento);
    } catch (error) {
      showAlert(error.message, 'danger');
    }
  }

  async function openDetail(eventId) {
    pageState.eventId = eventId;
    document
      .getElementById('event-detail-body')
      .replaceChildren(element('p', 'Cargando detalle…', 'text-muted'));
    detailModal.show();
    await refreshDetail();
  }

  function statCard(title, value) {
    const col = element('div', undefined, 'col-6 col-md-3');
    const card = element('div', undefined, 'border rounded p-3 h-100');
    card.append(element('div', title, 'small text-muted'), element('strong', value, 'fs-5'));
    col.appendChild(card);
    return col;
  }

  function buildParticipantTable(participants, event) {
    const wrap = element('div', undefined, 'table-responsive mt-3');
    const search = element('input', undefined, 'form-control form-control-sm mb-2');
    search.type = 'search';
    search.placeholder = 'Buscar por documento, nombre o correo';
    search.setAttribute('aria-label', 'Buscar participantes');
    const table = element('table', undefined, 'table table-sm table-hover align-middle');
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    [
      'Participante',
      'Documento',
      'Correo',
      'Facultad / Laboratorio',
      'Asistencia',
      'Entrada',
      'Salida',
      'Certificado',
      'Acciones',
    ].forEach((label) => headRow.appendChild(element('th', label)));
    head.appendChild(headRow);
    const body = document.createElement('tbody');
    participants.forEach((participant) => {
      const row = element('tr');
      row.dataset.search =
        `${participant.nombre} ${participant.documento} ${participant.correo}`.toLowerCase();
      addCell(row, participant.nombre);
      addCell(row, participant.documento);
      addCell(row, participant.correo);
      addCell(row, `${participant.facultad} / ${participant.laboratorio}`);
      addCell(row, participant.estado_asistencia.replaceAll('_', ' '));
      addCell(row, formatTimestamp(participant.entrada_en));
      addCell(row, formatTimestamp(participant.salida_en));
      const certCell = element(
        'td',
        participant.certificado_id
          ? `${participant.estado_certificado || 'pendiente'}${participant.validez_certificado === 'anulado' ? ' · anulado' : ''}`
          : 'Pendiente'
      );
      if (participant.certificado_id && participant.validez_certificado !== 'anulado') {
        const download = element('a', 'PDF', 'ms-1');
        download.href = `${apiBase}/certificados/${participant.certificado_id}/descargar`;
        download.setAttribute('aria-label', `Descargar certificado de ${participant.nombre}`);
        certCell.appendChild(download);
        if (canAnnulCertificates) {
          const annul = actionButton('Anular', 'btn-outline-danger btn-sm ms-2', () =>
            annulCertificate(participant.certificado_id)
          );
          certCell.appendChild(annul);
        }
      }
      row.appendChild(certCell);
      const actions = element('td', undefined, 'text-nowrap');
      if (event.estado === 'en_curso') {
        if (!participant.entrada_en) {
          actions.appendChild(
            actionButton('Entrada', 'btn-outline-success', () =>
              recordAttendance(event, participant, 'entrada')
            )
          );
        } else if (!participant.salida_en) {
          actions.appendChild(
            actionButton('Salida', 'btn-outline-primary', () =>
              recordAttendance(event, participant, 'salida')
            )
          );
        }
      }
      if (participant.salida_en && !participant.certificado_id) {
        actions.appendChild(
          actionButton('Generar certificado', 'btn-outline-primary', () =>
            generateCertificate(event.id, participant.id)
          )
        );
      }
      if (participant.estado_certificado === 'error' && participant.certificado_id) {
        if (actions.childNodes.length) actions.appendChild(document.createTextNode(' '));
        actions.appendChild(
          actionButton('Reintentar correo', 'btn-outline-warning', () =>
            retryEmail(participant.certificado_id)
          )
        );
      }
      row.appendChild(actions);
      body.appendChild(row);
    });
    search.addEventListener('input', () => {
      const term = search.value.trim().toLowerCase();
      Array.from(body.rows).forEach((row) => {
        row.hidden = !row.dataset.search.includes(term);
      });
    });
    table.append(head, body);
    wrap.append(search, table);
    return wrap;
  }

  async function refreshDetail() {
    if (!pageState.eventId) return;
    try {
      const data = await request(`/eventos/${pageState.eventId}`);
      const event = data.evento;
      const stats = data.estadisticas;
      pageState.participants = data.participantes;
      const body = document.getElementById('event-detail-body');
      body.replaceChildren();
      const title = document.getElementById('event-detail-title');
      title.textContent = event.nombre;
      const overview = element(
        'div',
        undefined,
        'd-flex flex-wrap justify-content-between align-items-start gap-3'
      );
      const meta = element('div');
      meta.append(
        element(
          'p',
          `${formatDate(event.fecha)} · ${String(event.hora_inicio).slice(0, 5)}–${String(event.hora_fin).slice(0, 5)} · ${event.lugar}`,
          'mb-1'
        ),
        element('p', `Organizador: ${event.organizador}`, 'mb-1'),
        element('p', event.descripcion || 'Sin descripción.', 'text-muted mb-0')
      );
      overview.appendChild(meta);
      const stateActions = element('div', undefined, 'd-flex gap-2 flex-wrap');
      if (event.estado === 'programado') {
        stateActions.appendChild(
          actionButton('Iniciar evento', 'btn-success', () => updateState(event.id, 'en_curso'))
        );
        stateActions.appendChild(
          actionButton('Cancelar', 'btn-outline-danger', () => updateState(event.id, 'cancelado'))
        );
      } else if (event.estado === 'en_curso') {
        stateActions.appendChild(
          actionButton('Finalizar evento', 'btn-primary', () => updateState(event.id, 'finalizado'))
        );
        stateActions.appendChild(
          actionButton('Cancelar', 'btn-outline-danger', () => updateState(event.id, 'cancelado'))
        );
      }
      overview.appendChild(stateActions);
      body.appendChild(overview);
      if (event.banner_path) {
        const banner = document.createElement('img');
        banner.src = `${apiBase}/eventos/${event.id}/banner`;
        banner.alt = `Banner de ${event.nombre}`;
        banner.className = 'img-fluid rounded my-3';
        banner.style.maxHeight = '240px';
        body.appendChild(banner);
      }

      const statsRow = element('div', undefined, 'row g-2 mt-2');
      [
        ['Participantes', stats.total_participantes],
        ['Con entrada', stats.entradas],
        ['Con salida', stats.salidas],
        ['Sin entrada', stats.sin_entrada],
        ['Dentro sin salida', stats.dentro_sin_salida],
        ['Certificados generados', stats.certificados_generados],
        ['Correos enviados', stats.certificados_enviados],
        ['Pendientes de envío', stats.certificados_pendientes],
        ['Errores de correo', stats.certificados_con_error],
        ['Asistencia', `${stats.porcentaje_asistencia}%`],
        ['Participación completada', `${stats.porcentaje_completado}%`],
      ].forEach(([label, value]) => statsRow.appendChild(statCard(label, value ?? 0)));
      body.appendChild(statsRow);

      const participantActions = element('section', undefined, 'border-top mt-4 pt-3');
      participantActions.appendChild(element('h3', 'Participantes', 'h6'));
      const downloadTemplate = element(
        'a',
        'Descargar plantilla Excel',
        'btn btn-sm btn-outline-secondary mb-2 me-2'
      );
      downloadTemplate.href = `${apiBase}/eventos/${event.id}/plantilla-participantes`;
      downloadTemplate.download = 'plantilla-encuentros.xlsx';
      participantActions.appendChild(downloadTemplate);
      if (event.estado === 'programado') {
        const fileLabel = element('label', 'Archivo Excel ', 'form-label small mb-0');
        const fileInput = element(
          'input',
          undefined,
          'form-control form-control-sm d-inline-block'
        );
        fileInput.type = 'file';
        fileInput.accept =
          '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        fileInput.style.maxWidth = '320px';
        fileInput.id = 'participants-xlsx';
        fileLabel.appendChild(fileInput);
        participantActions.appendChild(fileLabel);
        participantActions.appendChild(
          actionButton('Previsualizar importación', 'btn-outline-primary ms-2', previewImport)
        );
        const importPreview = element('div');
        importPreview.id = 'import-preview';
        participantActions.appendChild(importPreview);
      }
      if (['programado', 'en_curso'].includes(event.estado)) {
        participantActions.appendChild(buildManualParticipantForm(event.id));
      }
      if (event.estado === 'en_curso') {
        participantActions.appendChild(buildAttendanceForm(event));
      }
      participantActions.appendChild(buildParticipantTable(data.participantes, event));
      body.appendChild(participantActions);
    } catch (error) {
      document
        .getElementById('event-detail-body')
        .replaceChildren(element('div', error.message, 'alert alert-danger'));
    }
  }

  function buildManualParticipantForm(eventId) {
    const details = element('details', undefined, 'mt-3');
    details.appendChild(element('summary', 'Incorporar participante manualmente', 'fw-semibold'));
    const form = element('form', undefined, 'row g-2 mt-2');
    form.innerHTML = `
      <div class="col-12 col-md-4"><label class="form-label">Nombre completo<input name="nombre" class="form-control form-control-sm" required maxlength="255"></label></div>
      <div class="col-12 col-md-4"><label class="form-label">Documento<input name="documento" class="form-control form-control-sm" required maxlength="50"></label></div>
      <div class="col-12 col-md-4"><label class="form-label">Correo<input name="correo" type="email" class="form-control form-control-sm" required maxlength="255"></label></div>
      <div class="col-12 col-md-5"><label class="form-label">Facultad<input name="facultad" class="form-control form-control-sm" required maxlength="255"></label></div>
      <div class="col-12 col-md-5"><label class="form-label">Laboratorio<input name="laboratorio" class="form-control form-control-sm" required maxlength="255"></label></div>`;
    const button = element(
      'button',
      'Agregar participante',
      'btn btn-sm btn-outline-primary col-auto align-self-end'
    );
    button.type = 'submit';
    form.appendChild(button);
    form.addEventListener('submit', async (eventSubmit) => {
      eventSubmit.preventDefault();
      const payload = Object.fromEntries(new FormData(form).entries());
      try {
        await request(`/eventos/${eventId}/participantes`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showAlert('Participante incorporado al evento.', 'success');
        await refreshDetail();
        await loadEvents();
      } catch (error) {
        showAlert(error.message, 'danger');
      }
    });
    details.appendChild(form);
    return details;
  }

  function buildAttendanceForm(event) {
    const form = element('form', undefined, 'row g-2 align-items-end border rounded p-3 mt-3');
    form.innerHTML = `
      <div class="col-12"><strong>Registro manual de asistencia</strong><div class="small text-muted">Busca al inscrito por documento. No se usa QR para la asistencia.</div></div>
      <div class="col-12 col-md-7"><label class="form-label">Documento, nombre o correo<input name="busqueda" class="form-control form-control-sm" autocomplete="off" aria-label="Buscar participante inscrito"></label></div>`;
    const matches = element('div', undefined, 'col-12');
    form.appendChild(matches);
    const renderMatches = () => {
      matches.replaceChildren();
      const term = form.elements.busqueda.value.trim().toLowerCase();
      if (!term) return;
      const normalizedTerm = term.replace(/[^a-z0-9]/gi, '');
      const found = (pageState.participants || [])
        .filter((participant) => {
          const normalizedDocument = participant.documento.toUpperCase().replace(/[^A-Z0-9]/g, '');
          return (
            (normalizedTerm && normalizedDocument.includes(normalizedTerm)) ||
            participant.nombre.toLowerCase().includes(term) ||
            participant.correo.toLowerCase().includes(term)
          );
        })
        .slice(0, 25);
      if (!found.length) {
        matches.appendChild(
          element('p', 'No se encontraron participantes inscritos.', 'small text-muted')
        );
        return;
      }
      found.forEach((participant) => {
        const card = element(
          'div',
          undefined,
          'd-flex flex-wrap align-items-center justify-content-between gap-2 border rounded p-2 mb-2'
        );
        card.appendChild(
          element(
            'span',
            `${participant.nombre} · ${participant.documento} · ${participant.correo} · ${participant.estado_asistencia.replaceAll('_', ' ')}`,
            'small'
          )
        );
        if (!participant.entrada_en) {
          card.appendChild(
            actionButton('Registrar entrada', 'btn-outline-success', () =>
              recordAttendance(event, participant, 'entrada')
            )
          );
        } else if (!participant.salida_en) {
          card.appendChild(
            actionButton('Registrar salida', 'btn-outline-primary', () =>
              recordAttendance(event, participant, 'salida')
            )
          );
        }
        matches.appendChild(card);
      });
    };
    form.elements.busqueda.addEventListener('input', renderMatches);
    form.addEventListener('submit', (eventSubmit) => eventSubmit.preventDefault());
    return form;
  }

  async function recordAttendance(event, participant, operation) {
    const promptText = operation === 'entrada' ? 'entrada' : 'salida';
    if (
      !window.confirm(
        `Confirma la ${promptText} de ${participant.nombre} (documento ${participant.documento}) en "${event.nombre}".`
      )
    )
      return;
    try {
      const response = await request(`/eventos/${event.id}/asistencia/${operation}`, {
        method: 'POST',
        body: JSON.stringify({ documento: participant.documento }),
      });
      showAlert(
        response.message || `${promptText} registrada.`,
        response.estado_envio === 'error' ? 'warning' : 'success'
      );
      await refreshDetail();
      await loadEvents();
    } catch (error) {
      showAlert(error.message, 'danger');
    }
  }

  async function retryEmail(certificateId) {
    try {
      await request(`/certificados/${certificateId}/reintentar-envio`, {
        method: 'POST',
        body: '{}',
      });
      showAlert(
        'El certificado se envió o ya estaba enviado. La medalla se verificó nuevamente.',
        'success'
      );
      await refreshDetail();
    } catch (error) {
      showAlert(error.message, 'danger');
    }
  }

  async function generateCertificate(eventId, participantId) {
    if (
      !window.confirm(
        'La participación se completó. ¿Generar el certificado ahora y enviarlo por correo?'
      )
    )
      return;
    try {
      const result = await request(
        `/eventos/${eventId}/participantes/${participantId}/certificado/generar`,
        { method: 'POST', body: '{}' }
      );
      showAlert(
        result.estado_envio === 'sent'
          ? 'Certificado generado y enviado.'
          : 'Certificado generado; revisa el estado del envío.',
        'success'
      );
      await refreshDetail();
    } catch (error) {
      showAlert(error.message, 'danger');
    }
  }

  async function annulCertificate(certificateId) {
    const reason = window.prompt('Indica el motivo de anulación del certificado:');
    if (!reason?.trim()) return;
    if (
      !window.confirm(
        '¿Confirmas la anulación? El código QR público mostrará el certificado como anulado.'
      )
    )
      return;
    try {
      await request(`/certificados/${certificateId}/anular`, {
        method: 'PATCH',
        body: JSON.stringify({ motivo: reason.trim() }),
      });
      showAlert('Certificado anulado; la consulta pública reflejará el cambio.', 'success');
      await refreshDetail();
    } catch (error) {
      showAlert(error.message, 'danger');
    }
  }

  async function updateState(eventId, state) {
    const labels = { en_curso: 'iniciar', finalizado: 'finalizar', cancelado: 'cancelar' };
    if (!window.confirm(`¿Confirmas ${labels[state]} este evento?`)) return;
    try {
      await request(`/eventos/${eventId}/estado`, {
        method: 'PATCH',
        body: JSON.stringify({ estado: state }),
      });
      showAlert(`Evento actualizado: ${state.replaceAll('_', ' ')}.`, 'success');
      await refreshDetail();
      await loadEvents();
    } catch (error) {
      showAlert(error.message, 'danger');
    }
  }

  async function previewTemplate() {
    const previewWindow = window.open('about:blank', '_blank');
    if (!previewWindow) {
      showAlert('Permite ventanas emergentes para visualizar la plantilla.', 'warning');
      return;
    }
    const formData = new FormData();
    let templateFile = document.getElementById('event-template').files[0];
    const eventId = document.getElementById('event-id').value;
    try {
      if (!templateFile && eventId) {
        const response = await fetch(`${apiBase}/eventos/${eventId}/plantilla-pdf`, {
          credentials: 'same-origin',
        });
        if (!response.ok) throw new Error('No fue posible obtener la plantilla guardada.');
        templateFile = new File([await response.blob()], 'plantilla.pdf', {
          type: 'application/pdf',
        });
      }
      if (!templateFile) throw new Error('Selecciona una plantilla PDF para previsualizar.');
      formData.append('plantilla_pdf', templateFile);
      formData.append('plantilla_config', document.getElementById('template-config').value);
      const response = await fetch(`${apiBase}/plantillas/previsualizar`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrfToken },
        body: formData,
        credentials: 'same-origin',
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.message || 'No fue posible previsualizar la plantilla.');
      }
      const previewUrl = URL.createObjectURL(await response.blob());
      previewWindow.location.href = previewUrl;
      window.setTimeout(() => URL.revokeObjectURL(previewUrl), 60000);
    } catch (error) {
      previewWindow.close();
      showAlert(error.message, 'danger');
    }
  }

  async function previewImport() {
    const input = document.getElementById('participants-xlsx');
    if (!input?.files?.[0]) {
      showAlert('Selecciona un archivo Excel para previsualizar.', 'warning');
      return;
    }
    const formData = new FormData();
    formData.append('archivo', input.files[0]);
    try {
      const result = await request(`/eventos/${pageState.eventId}/participantes/previsualizar`, {
        method: 'POST',
        body: formData,
      });
      pageState.previewRows = result.filas;
      renderPreview(result);
    } catch (error) {
      showAlert(error.message, 'danger');
    }
  }

  function renderPreview(result) {
    const container = document.getElementById('import-preview');
    container.replaceChildren();
    container.appendChild(
      element(
        'p',
        `${result.resumen.total} filas · ${result.resumen.validos} válidas · ${result.resumen.rechazados} rechazadas`,
        'small mt-2'
      )
    );
    const table = element('table', undefined, 'table table-sm');
    const body = document.createElement('tbody');
    result.filas.forEach((row) => {
      const tr = document.createElement('tr');
      addCell(tr, `Fila ${row.fila}`);
      addCell(tr, row.participante.nombre);
      addCell(tr, row.participante.documento);
      addCell(tr, row.errores.length ? row.errores.join(' ') : 'Válido');
      if (row.errores.length) tr.classList.add('table-danger');
      body.appendChild(tr);
    });
    table.appendChild(body);
    container.appendChild(table);
    if (result.resumen.validos > 0) {
      container.appendChild(
        actionButton('Confirmar importación', 'btn-primary btn-sm', importParticipants)
      );
    }
  }

  async function importParticipants() {
    try {
      const result = await request(`/eventos/${pageState.eventId}/participantes/importar`, {
        method: 'POST',
        body: JSON.stringify({ filas: pageState.previewRows }),
      });
      const summary = result.resumen;
      showAlert(
        `Importación: ${summary.importados} importados, ${summary.omitidos} omitidos y ${summary.rechazados} rechazados.`,
        summary.rechazados ? 'warning' : 'success'
      );
      pageState.previewRows = [];
      await refreshDetail();
      await loadEvents();
    } catch (error) {
      showAlert(error.message, 'danger');
    }
  }

  document.getElementById('btn-nuevo-evento').addEventListener('click', () => setFormMode());
  document
    .getElementById('btn-cerrar-form-evento')
    .addEventListener('click', () => eventFormCard.classList.add('d-none'));
  document
    .getElementById('btn-cancelar-evento')
    .addEventListener('click', () => eventFormCard.classList.add('d-none'));
  document.getElementById('event-filters').addEventListener('submit', (event) => {
    event.preventDefault();
    pageState.page = 1;
    loadEvents();
  });
  document.getElementById('event-page-prev').addEventListener('click', () => {
    pageState.page = Math.max(1, pageState.page - 1);
    loadEvents();
  });
  document.getElementById('event-page-next').addEventListener('click', () => {
    pageState.page += 1;
    loadEvents();
  });
  document.getElementById('btn-preview-template').addEventListener('click', previewTemplate);
  eventForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!eventForm.reportValidity()) return;
    const eventId = document.getElementById('event-id').value;
    const formData = new FormData(eventForm);
    formData.delete('eventId');
    try {
      JSON.parse(formData.get('plantilla_config'));
    } catch {
      showAlert('La configuración de la plantilla debe ser JSON válido.', 'danger');
      return;
    }
    try {
      await request(eventId ? `/eventos/${eventId}` : '/eventos', {
        method: eventId ? 'PUT' : 'POST',
        body: formData,
      });
      showAlert(eventId ? 'Evento actualizado.' : 'Evento creado.', 'success');
      eventFormCard.classList.add('d-none');
      eventForm.reset();
      await loadEvents();
    } catch (error) {
      showAlert(error.message, 'danger');
    }
  });

  loadEvents();
})();
