/* global bootstrap, document, window */

(function () {
  const apiBase = '/milab/encuentros/api';
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
  const canAnnulCertificates =
    document.getElementById('encuentros-shell').dataset.canAnnul === 'true';
  const pageState = {
    page: 1,
    pageSize: 20,
    eventId: null,
    previewRows: [],
    historicalPreviewRows: [],
    templateOnly: false,
  };
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
      if (body?.adminErrorDetail) {
        window.console.error(
          'Detalle técnico del servidor (administrador):',
          body.adminErrorDetail
        );
      }
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
        if (event.estado === 'finalizado') {
          actions.append(
            document.createTextNode(' '),
            actionButton('Ver informe', 'btn-outline-success', () => downloadReport(event.id))
          );
        }
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

  async function downloadReport(eventId) {
    try {
      const response = await fetch(`${apiBase}/eventos/${eventId}/informe.pdf`, {
        credentials: 'same-origin',
      });
      const contentType = response.headers.get('content-type') || '';
      const body = contentType.includes('application/json') ? await response.json() : null;
      if (!response.ok) {
        throw new Error(body?.message || `La solicitud falló (${response.status}).`);
      }

      const url = window.URL.createObjectURL(await response.blob());
      const link = element('a');
      link.href = url;
      link.download = `informe-encuentro-${eventId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
      showAlert('Informe del encuentro descargado.', 'success');
    } catch (error) {
      console.error('[encuentros:download-report]', error);
      showAlert(error.message || 'No fue posible descargar el informe.', 'danger');
    }
  }

  function setFormMode(event = null, templateOnly = false) {
    window.EncounterTemplateEditor.reset();
    eventForm.reset();
    pageState.templateOnly = Boolean(event && templateOnly);
    document.getElementById('event-id').value = event?.id || '';
    document.getElementById('event-form-title').textContent = pageState.templateOnly
      ? 'Editar plantilla del certificado'
      : event
        ? 'Editar evento'
        : 'Crear evento';
    document.getElementById('btn-guardar-evento').textContent = pageState.templateOnly
      ? 'Guardar plantilla'
      : event
        ? 'Guardar cambios'
        : 'Guardar evento';
    document.getElementById('event-template').required = !event;
    document.getElementById('template-required').classList.toggle('d-none', Boolean(event));
    document.getElementById('historical-event-option').classList.toggle('d-none', Boolean(event));
    document
      .getElementById('event-details-fields')
      .classList.toggle('d-none', pageState.templateOnly);
    document.getElementById('event-template-fields').classList.remove('d-none');
    window.EncounterTemplateEditor.setConfig(event?.plantilla_config || {});
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
    if (event?.id) {
      window.EncounterTemplateEditor.loadUrl(`${apiBase}/eventos/${event.id}/plantilla-pdf`).catch(
        (error) => {
          console.error('[encuentros:load-template]', error);
          showAlert(error.message || 'No fue posible cargar la plantilla PDF.', 'danger');
        }
      );
    }
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

  async function editTemplate(eventId) {
    try {
      const data = await request(`/eventos/${eventId}`);
      if (!['en_curso', 'finalizado'].includes(data.evento.estado)) {
        showAlert('La plantilla puede editarse después de iniciar el evento.', 'warning');
        return;
      }
      detailModal.hide();
      setFormMode(data.evento, true);
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

  function miniMetricCard(title, numerator, denominator, percentage, detail) {
    const col = element('div', undefined, 'col-12 col-sm-6 col-lg-4');
    const card = element('div', undefined, 'border rounded p-2 h-100');
    const safePercentage = Math.min(100, Math.max(0, Number(percentage) || 0));
    const summary = element(
      'div',
      undefined,
      'd-flex justify-content-between align-items-baseline'
    );
    summary.append(
      element('strong', `${numerator} / ${denominator}`, 'fs-6'),
      element('span', `${safePercentage}%`, 'small fw-semibold')
    );
    const progress = element('div', undefined, 'progress mt-2');
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-label', title);
    progress.setAttribute('aria-valuemin', '0');
    progress.setAttribute('aria-valuemax', '100');
    progress.setAttribute('aria-valuenow', String(safePercentage));
    const bar = element('div', undefined, 'progress-bar');
    bar.style.width = `${safePercentage}%`;
    bar.setAttribute('aria-hidden', 'true');
    progress.appendChild(bar);
    card.append(
      element('div', title, 'small text-muted'),
      summary,
      progress,
      element('div', detail, 'small text-muted mt-2')
    );
    col.appendChild(card);
    return col;
  }

  function buildParticipantTable(participants, event) {
    const allowSelection = event.estado === 'finalizado';
    const wrap = element('div', undefined, 'table-responsive mt-3');
    const filters = element('div', undefined, 'row g-2 mb-2');
    const searchCol = element('div', undefined, 'col-12 col-lg-6');
    const attendanceCol = element('div', undefined, 'col-12 col-md-6 col-lg-3');
    const certificateCol = element('div', undefined, 'col-12 col-md-6 col-lg-3');
    const search = element('input', undefined, 'form-control form-control-sm');
    search.type = 'search';
    search.placeholder = 'Buscar por documento, nombre o correo';
    search.setAttribute('aria-label', 'Buscar participantes');
    const attendanceFilter = element('select', undefined, 'form-select form-select-sm');
    attendanceFilter.setAttribute('aria-label', 'Filtrar por estado de asistencia');
    [
      ['all', 'Asistencia: todos'],
      ['sin_entrada', 'Asistencia: sin entrada'],
      ['en_curso', 'Asistencia: en curso'],
      ['completada', 'Asistencia: completada'],
    ].forEach(([value, label]) => {
      const option = element('option', label);
      option.value = value;
      attendanceFilter.appendChild(option);
    });
    const certificateFilter = element('select', undefined, 'form-select form-select-sm');
    certificateFilter.setAttribute('aria-label', 'Filtrar por estado de certificado');
    [
      ['all', 'Certificado: todos'],
      ['sin_certificado', 'Certificado: sin generar'],
      ['enviado', 'Certificado: enviado'],
      ['pendiente', 'Certificado: pendiente de envío'],
      ['error', 'Certificado: con error'],
      ['anulado', 'Certificado: anulado'],
    ].forEach(([value, label]) => {
      const option = element('option', label);
      option.value = value;
      certificateFilter.appendChild(option);
    });
    searchCol.appendChild(search);
    attendanceCol.appendChild(attendanceFilter);
    certificateCol.appendChild(certificateFilter);
    filters.append(searchCol, attendanceCol, certificateCol);
    const table = element('table', undefined, 'table table-sm table-hover align-middle');
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    if (allowSelection) {
      const selectCell = document.createElement('th');
      const selectAll = element('input');
      selectAll.type = 'checkbox';
      selectAll.setAttribute('aria-label', 'Seleccionar participantes elegibles');
      selectCell.appendChild(selectAll);
      headRow.appendChild(selectCell);
      selectAll.addEventListener('change', () => {
        table
          .querySelectorAll('input[name="selected-participant"]:not(:disabled)')
          .forEach((input) => {
            input.checked = selectAll.checked;
          });
      });
    }
    [
      'Participante',
      'Documento',
      'Correo',
      'Cargo',
      'Facultad',
      'Unidad Académica de Laboratorio (UAL)',
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
        `${participant.nombre} ${participant.documento} ${participant.correo} ${participant.rol} ${participant.facultad} ${participant.laboratorio}`.toLowerCase();
      row.dataset.attendanceState = participant.estado_asistencia || 'sin_entrada';
      const certificateState = participant.certificado_id
        ? participant.validez_certificado === 'anulado'
          ? 'anulado'
          : ['pendiente', 'enviando'].includes(participant.estado_certificado)
            ? 'pendiente'
            : participant.estado_certificado || 'pendiente'
        : 'sin_certificado';
      row.dataset.certificateState = certificateState;
      if (allowSelection) {
        const selectCell = document.createElement('td');
        const select = element('input');
        select.type = 'checkbox';
        select.name = 'selected-participant';
        select.value = String(participant.id);
        select.disabled =
          !participant.salida_en ||
          participant.validez_certificado === 'anulado' ||
          participant.estado_certificado === 'enviado';
        select.setAttribute('aria-label', `Seleccionar certificado de ${participant.nombre}`);
        selectCell.appendChild(select);
        row.appendChild(selectCell);
      }
      addCell(row, participant.nombre);
      addCell(row, participant.documento);
      addCell(row, participant.correo);
      addCell(row, participant.rol);
      addCell(row, participant.facultad);
      addCell(row, participant.laboratorio);
      addCell(row, participant.estado_asistencia.replaceAll('_', ' '));
      addCell(row, formatTimestamp(participant.entrada_en));
      addCell(row, formatTimestamp(participant.salida_en));
      const certCell = element(
        'td',
        participant.certificado_id
          ? `${participant.estado_certificado || 'pendiente'}${participant.validez_certificado === 'anulado' ? ' · anulado' : ''}${participant.medalla_vinculada ? ' · medalla enlazada' : ''}`
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
    const applyParticipantFilters = () => {
      const term = search.value.trim().toLowerCase();
      const attendanceValue = attendanceFilter.value;
      const certificateValue = certificateFilter.value;
      Array.from(body.rows).forEach((row) => {
        const matchesTerm = row.dataset.search.includes(term);
        const matchesAttendance =
          attendanceValue === 'all' || row.dataset.attendanceState === attendanceValue;
        const matchesCertificate =
          certificateValue === 'all' || row.dataset.certificateState === certificateValue;
        row.hidden = !(matchesTerm && matchesAttendance && matchesCertificate);
      });
    };
    search.addEventListener('input', applyParticipantFilters);
    attendanceFilter.addEventListener('change', applyParticipantFilters);
    certificateFilter.addEventListener('change', applyParticipantFilters);
    table.append(head, body);
    wrap.append(filters);
    if (allowSelection) {
      const controls = element('div', undefined, 'd-flex flex-wrap align-items-center gap-3 mb-2');
      const emailLabel = element('label', undefined, 'form-check mb-0');
      const sendEmail = element('input', undefined, 'form-check-input');
      sendEmail.type = 'checkbox';
      sendEmail.checked = true;
      sendEmail.id = 'send-selected-certificates';
      const emailText = element(
        'span',
        'Enviar los certificados seleccionados por correo',
        'form-check-label'
      );
      emailLabel.append(sendEmail, emailText);
      const generateButton = actionButton('Generar certificados seleccionados', 'btn-primary', () =>
        generateSelectedCertificates(event.id, table, sendEmail, generateButton)
      );
      controls.append(emailLabel, generateButton);
      wrap.appendChild(controls);
    }
    wrap.appendChild(table);
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
          actionButton('Finalizar evento', 'btn-primary', () => finalizeEvent(event.id))
        );
        stateActions.appendChild(
          actionButton('Cancelar', 'btn-outline-danger', () => updateState(event.id, 'cancelado'))
        );
      } else if (event.estado === 'finalizado') {
        stateActions.appendChild(
          actionButton('Ver informe del encuentro', 'btn-outline-success', () =>
            downloadReport(event.id)
          )
        );
      }
      if (['en_curso', 'finalizado'].includes(event.estado)) {
        stateActions.appendChild(
          actionButton('Editar plantilla del certificado', 'btn-outline-secondary', () =>
            editTemplate(event.id)
          )
        );
      }
      overview.appendChild(stateActions);
      body.appendChild(overview);
      body.appendChild(registrationLinksSection(event.id, data.enlaces_registro));
      if (event.banner_path) {
        const banner = document.createElement('img');
        banner.src = `${apiBase}/eventos/${event.id}/banner`;
        banner.alt = `Banner de ${event.nombre}`;
        banner.className = 'img-fluid rounded my-3';
        banner.style.maxHeight = '240px';
        body.appendChild(banner);
      }

      const totalParticipants = Number(stats.total_participantes) || 0;
      const generatedCertificates = Number(stats.certificados_generados) || 0;
      const sentCertificates = Number(stats.certificados_enviados) || 0;
      const sentPercentage = generatedCertificates
        ? Number(((sentCertificates / generatedCertificates) * 100).toFixed(2))
        : 0;
      const statistics = element('section', undefined, 'mt-3');
      const statisticsTitle = element('h3', 'Resumen visual', 'h6 mb-2');
      statisticsTitle.id = 'event-statistics-title';
      statistics.setAttribute('aria-labelledby', 'event-statistics-title');
      statistics.appendChild(statisticsTitle);
      const statsRow = element('div', undefined, 'row g-2');
      [
        miniMetricCard(
          'Asistencia con entrada',
          stats.entradas,
          totalParticipants,
          stats.porcentaje_asistencia,
          `Sin entrada: ${stats.sin_entrada} · Dentro sin salida: ${stats.dentro_sin_salida}`
        ),
        miniMetricCard(
          'Participación completada',
          stats.salidas,
          totalParticipants,
          stats.porcentaje_completado,
          'Participantes con salida registrada'
        ),
        miniMetricCard(
          'Correos de certificados enviados',
          sentCertificates,
          generatedCertificates,
          sentPercentage,
          `Pendientes: ${stats.certificados_pendientes} · Errores: ${stats.certificados_con_error}`
        ),
        miniMetricCard(
          'Medallas enlazadas',
          stats.medallas_otorgadas,
          totalParticipants,
          totalParticipants
            ? Number(((Number(stats.medallas_otorgadas) / totalParticipants) * 100).toFixed(2))
            : 0,
          'Logros asociados a cuentas MiLab'
        ),
      ].forEach((metric) => statsRow.appendChild(metric));
      statistics.appendChild(statsRow);
      body.appendChild(statistics);

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
      const exportParticipants = element(
        'a',
        'Descargar datos de participantes (.xlsx)',
        'btn btn-sm btn-outline-success mb-2 me-2'
      );
      exportParticipants.href = `${apiBase}/eventos/${event.id}/participantes.xlsx`;
      exportParticipants.download = `participantes-encuentro-${event.id}.xlsx`;
      participantActions.appendChild(exportParticipants);
      if (event.estado === 'finalizado') {
        participantActions.appendChild(buildHistoricalParticipationImport(event));
      }
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
      if (['programado', 'en_curso', 'finalizado'].includes(event.estado)) {
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

  function buildHistoricalParticipationImport(event) {
    const details = element('details', undefined, 'card bg-light border-0 mt-3');
    const summary = element(
      'summary',
      'Cargar participantes y asistencias de un evento ya realizado',
      'card-header fw-semibold'
    );
    const content = element('div', undefined, 'card-body');
    content.appendChild(
      element(
        'p',
        'Usa la plantilla para importar participantes y marcas de entrada/salida. Solo quienes tengan ambas marcas podrán recibir certificado.',
        'small text-muted'
      )
    );
    const templateLink = element(
      'a',
      'Descargar plantilla de participaciones',
      'btn btn-sm btn-outline-secondary me-2 mb-2'
    );
    templateLink.href = `${apiBase}/eventos/${event.id}/plantilla-participaciones`;
    templateLink.download = `plantilla-participaciones-encuentro-${event.id}.xlsx`;
    content.appendChild(templateLink);

    const fileLabel = element('label', 'Archivo Excel ', 'form-label small mb-2');
    const fileInput = element('input', undefined, 'form-control form-control-sm');
    fileInput.type = 'file';
    fileInput.accept = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    fileInput.id = 'historical-participations-xlsx';
    fileInput.style.maxWidth = '360px';
    fileLabel.appendChild(fileInput);
    content.appendChild(fileLabel);

    const emailLabel = element('label', undefined, 'form-check my-2');
    const sendEmail = element('input', undefined, 'form-check-input');
    sendEmail.type = 'checkbox';
    sendEmail.id = 'historical-send-certificates';
    const emailText = element(
      'span',
      'Enviar por correo los certificados de quienes completaron la participación',
      'form-check-label'
    );
    emailLabel.append(sendEmail, emailText);
    content.appendChild(emailLabel);
    content.appendChild(
      actionButton('Previsualizar participación', 'btn-outline-primary btn-sm', () =>
        previewHistoricalParticipation(event.id)
      )
    );
    const preview = element('div', undefined, 'mt-2');
    preview.id = 'historical-participation-preview';
    content.appendChild(preview);
    const status = element('p', undefined, 'small mt-2');
    status.id = 'historical-participation-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    content.appendChild(status);
    details.append(summary, content);
    return details;
  }

  function buildManualParticipantForm(eventId) {
    const details = element('details', undefined, 'mt-3');
    details.appendChild(element('summary', 'Incorporar participante manualmente', 'fw-semibold'));
    const form = element('form', undefined, 'row g-2 mt-2');
    form.innerHTML = `
      <div class="col-12 col-md-4"><label class="form-label">Nombre completo<input name="nombre" class="form-control form-control-sm" required maxlength="255"></label></div>
      <div class="col-12 col-md-4"><label class="form-label">Documento<input name="documento" class="form-control form-control-sm" required maxlength="50"></label></div>
      <div class="col-12 col-md-4"><label class="form-label">Correo<input name="correo" type="email" class="form-control form-control-sm" required maxlength="255"></label></div>
      <div class="col-12 col-md-4"><label class="form-label">Cargo<input name="rol" class="form-control form-control-sm" required maxlength="255"></label></div>
      <div class="col-12 col-md-5"><label class="form-label">Facultad<input name="facultad" class="form-control form-control-sm" required maxlength="255"></label></div>
      <div class="col-12 col-md-5"><label class="form-label">Unidad Académica de Laboratorio (UAL)<input name="laboratorio" class="form-control form-control-sm" required maxlength="255"></label></div>`;
    if (pageState.participants?.length && pageState.participants[0]?.estado_evento === 'finalizado') {
      form.appendChild(
        element(
          'p',
          'Nota: en encuentros finalizados, este formulario solo agrega el participante. La asistencia (entrada/salida) debe cargarse con la plantilla de participaciones.',
          'col-12 small text-muted mb-1'
        )
      );
    }
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
      !(await window.MiLabDialogs.confirm(
        `Confirma la ${promptText} de ${participant.nombre} (documento ${participant.documento}) en "${event.nombre}".`
      ))
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
      !(await window.MiLabDialogs.confirm(
        'La participación se completó. ¿Generar el certificado ahora y enviarlo por correo?'
      ))
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

  async function generateSelectedCertificates(eventId, table, sendEmail, button) {
    const selectedIds = new Set(
      Array.from(table.querySelectorAll('input[name="selected-participant"]:checked')).map(
        (input) => Number(input.value)
      )
    );
    const participants = (pageState.participants || []).filter((participant) =>
      selectedIds.has(Number(participant.id))
    );
    if (!participants.length) {
      showAlert('Selecciona al menos una participación completada.', 'warning');
      return;
    }
    const send = sendEmail.checked;
    const deliveryMessage = send
      ? 'Se generarán los certificados y se enviarán por correo.'
      : 'Se generarán los certificados sin enviar correos; las medallas se enlazarán cuando haya una cuenta MiLab asociada.';
    if (
      !(await window.MiLabDialogs.confirm(
        `${deliveryMessage} Participantes seleccionados: ${participants.length}.`
      ))
    ) {
      return;
    }

    button.disabled = true;
    try {
      const result = await issueCertificates(eventId, participants, send);
      const summary = send
        ? `${result.completed} certificados enviados; ${result.failed.length} con error.`
        : `${result.completed} certificados generados sin enviar correo.`;
      showAlert(
        result.failed.length
          ? `${summary} Revisa el estado de envío en la tabla de participantes.`
          : summary,
        result.failed.length ? 'warning' : 'success'
      );
      await refreshDetail();
    } catch (error) {
      showAlert(error.message, 'danger');
    } finally {
      button.disabled = false;
    }
  }

  async function issueCertificates(eventId, participants, sendEmail, onProgress = () => {}) {
    const failed = [];
    let completed = 0;
    for (let index = 0; index < participants.length; index += 1) {
      const participant = participants[index];
      onProgress(participant, index + 1, participants.length);
      try {
        const result = await request(
          `/eventos/${eventId}/participantes/${participant.participante_id || participant.id}/certificado/generar`,
          {
            method: 'POST',
            body: JSON.stringify({ enviar_correo: sendEmail }),
          }
        );
        if (sendEmail && result.estado_envio !== 'sent') {
          failed.push(`${participant.nombre}: el correo no fue confirmado.`);
        } else {
          completed += 1;
        }
      } catch (error) {
        failed.push(`${participant.nombre}: ${error.message}`);
      }
    }
    return { completed, failed };
  }

  async function annulCertificate(certificateId) {
    const reason = await window.MiLabDialogs.prompt(
      'Indica el motivo de anulación del certificado:',
      'Motivo de anulación'
    );
    if (!reason?.trim()) return;
    if (
      !(await window.MiLabDialogs.confirm(
        '¿Confirmas la anulación? El código QR público mostrará el certificado como anulado.'
      ))
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

  function registrationLinksSection(eventId, enlaces) {
    const section = element('div', undefined, 'card border-0 bg-light my-3');
    const cardBody = element('div', undefined, 'card-body');
    cardBody.appendChild(element('h3', 'Registro por código QR', 'h6 fw-bold mb-1'));
    cardBody.appendChild(
      element(
        'p',
        'Estos enlaces solo registran asistencia mientras el evento esté en curso. Proyecta el QR para que los asistentes lo escaneen.',
        'text-muted small mb-3'
      )
    );
    [
      ['ingreso', 'Registro de ingreso'],
      ['salida', 'Registro de salida'],
    ].forEach(([tipo, label]) => {
      const enlace = enlaces?.[tipo];
      if (!enlace) return;
      const row = element('div', undefined, 'mb-3');
      row.appendChild(element('p', label, 'fw-semibold mb-1'));
      row.appendChild(element('code', enlace.registro_url, 'd-block text-break small mb-2'));
      const buttons = element('div', undefined, 'd-flex flex-wrap gap-2');
      buttons.appendChild(
        actionButton('Copiar enlace', 'btn-outline-secondary btn-sm', () =>
          copyRegistrationLink(enlace.registro_url)
        )
      );
      buttons.appendChild(
        actionButton('Abrir QR para proyectar', 'btn-outline-primary btn-sm', () =>
          window.open(enlace.proyeccion_url, '_blank', 'noopener')
        )
      );
      row.appendChild(buttons);
      cardBody.appendChild(row);
    });
    section.appendChild(cardBody);
    return section;
  }

  async function copyRegistrationLink(url) {
    try {
      await navigator.clipboard.writeText(url);
      showAlert('Enlace copiado.', 'success');
    } catch {
      showAlert(`No fue posible copiar automáticamente. Enlace: ${url}`, 'warning');
    }
  }

  async function finalizeEvent(eventId) {
    if (
      !(await window.MiLabDialogs.confirm(
        '¿Confirmas finalizar este evento? Después podrás elegir a quién generar y enviar certificados.'
      ))
    ) {
      return;
    }
    try {
      await request(`/eventos/${eventId}/estado`, {
        method: 'PATCH',
        body: JSON.stringify({ estado: 'finalizado' }),
      });
    } catch (error) {
      showAlert(error.message, 'danger');
      return;
    }
    const sendAll = await window.MiLabDialogs.confirm(
      '¿Enviar ahora los certificados pendientes a todas las participaciones completadas? Si eliges No, podrás seleccionar asistentes desde el detalle del evento.'
    );
    if (!sendAll) {
      showAlert(
        'Evento finalizado. Selecciona participantes para emitir sus certificados.',
        'success'
      );
      await refreshDetail();
      await loadEvents();
      return;
    }
    let pendientes;
    try {
      const data = await request(`/eventos/${eventId}/certificados/pendientes`);
      pendientes = data.participantes || [];
    } catch (error) {
      showAlert(
        `El evento fue finalizado, pero no se pudieron consultar los certificados pendientes: ${error.message}`,
        'warning'
      );
      await refreshDetail();
      await loadEvents();
      return;
    }
    await runCertificateDispatch(eventId, pendientes);
  }

  async function runCertificateDispatch(eventId, pendientes) {
    const modalEl = document.getElementById('close-event-modal');
    const closeModal = bootstrap.Modal.getOrCreateInstance(modalEl);
    const summary = document.getElementById('close-event-summary');
    const progress = document.getElementById('close-event-progress');
    const progressWrap = progress.parentElement;
    const status = document.getElementById('close-event-status');
    const failuresBox = document.getElementById('close-event-failures');
    const doneButton = document.getElementById('close-event-done');
    const total = pendientes.length;

    progress.style.width = '0%';
    progressWrap.setAttribute('aria-valuenow', '0');
    status.textContent = '';
    failuresBox.classList.add('d-none');
    failuresBox.replaceChildren();
    doneButton.classList.add('d-none');
    summary.textContent = `Cerrando evento: se identificaron ${total} certificados pendientes por enviar.`;
    closeModal.show();

    const failures = [];
    for (let index = 0; index < total; index += 1) {
      const participante = pendientes[index];
      status.textContent = `Envío ${index + 1} de ${total}: ${participante.nombre}`;
      try {
        const result = await request(
          `/eventos/${eventId}/participantes/${participante.participante_id}/certificado/generar`,
          { method: 'POST', body: '{}' }
        );
        if (result.estado_envio !== 'sent') {
          failures.push(`${participante.nombre}: el correo no fue confirmado.`);
        }
      } catch (error) {
        failures.push(`${participante.nombre}: ${error.message}`);
      }
      const percent = Math.round(((index + 1) / total) * 100);
      progress.style.width = `${percent}%`;
      progressWrap.setAttribute('aria-valuenow', String(percent));
    }

    const enviados = total - failures.length;
    if (total === 0) {
      status.textContent = 'No hay certificados pendientes por enviar.';
    } else if (failures.length === 0) {
      status.textContent = `Se confirmó el envío de los ${total} certificados.`;
    } else {
      status.textContent = `Proceso terminado: ${enviados} enviados, ${failures.length} con error.`;
      failuresBox.classList.remove('d-none');
      failuresBox.appendChild(
        element(
          'p',
          'Revisa estos certificados desde el detalle del participante:',
          'mb-1 fw-semibold'
        )
      );
      const list = element('ul', undefined, 'mb-0');
      failures.forEach((message) => list.appendChild(element('li', message)));
      failuresBox.appendChild(list);
    }

    doneButton.classList.remove('d-none');
    doneButton.onclick = async () => {
      closeModal.hide();
      detailModal.hide();
      await loadEvents();
    };
  }

  async function updateState(eventId, state) {
    const labels = { en_curso: 'iniciar', finalizado: 'finalizar', cancelado: 'cancelar' };
    if (!(await window.MiLabDialogs.confirm(`¿Confirmas ${labels[state]} este evento?`))) return;
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
      if (!window.EncounterTemplateEditor.hasQrPlacement()) {
        throw new Error('Ubica el código QR de verificación antes de previsualizar.');
      }
      formData.append('plantilla_pdf', templateFile);
      formData.append('plantilla_config', window.EncounterTemplateEditor.getConfigJson());
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
    const head = document.createElement('thead');
    const headerRow = document.createElement('tr');
    [
      'Fila',
      'Nombre completo',
      'Número de documento',
      'Correo electrónico',
      'Cargo',
      'Facultad',
      'Unidad Académica de Laboratorio (UAL)',
      'Validación',
    ].forEach((label) => headerRow.appendChild(element('th', label)));
    head.appendChild(headerRow);
    const body = document.createElement('tbody');
    result.filas.forEach((row) => {
      const tr = document.createElement('tr');
      addCell(tr, `Fila ${row.fila}`);
      addCell(tr, row.participante.nombre);
      addCell(tr, row.participante.documento);
      addCell(tr, row.participante.correo);
      addCell(tr, row.participante.rol);
      addCell(tr, row.participante.facultad);
      addCell(tr, row.participante.laboratorio);
      addCell(
        tr,
        row.errores.length
          ? row.errores.join(' ')
          : row.advertencias?.length
            ? `Advertencia: ${row.advertencias.join(' ')}`
            : 'Válido'
      );
      if (row.errores.length) tr.classList.add('table-danger');
      else if (row.advertencias?.length) tr.classList.add('table-warning');
      body.appendChild(tr);
    });
    table.append(head, body);
    const tableWrap = element('div', undefined, 'table-responsive');
    tableWrap.appendChild(table);
    container.appendChild(tableWrap);
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

  async function previewHistoricalParticipation(eventId) {
    const input = document.getElementById('historical-participations-xlsx');
    if (!input?.files?.[0]) {
      showAlert('Selecciona un archivo Excel de participaciones.', 'warning');
      return;
    }
    const formData = new FormData();
    formData.append('archivo', input.files[0]);
    try {
      const result = await request(`/eventos/${eventId}/participaciones/previsualizar`, {
        method: 'POST',
        body: formData,
      });
      pageState.historicalPreviewRows = result.filas;
      renderHistoricalParticipationPreview(result, eventId);
    } catch (error) {
      showAlert(error.message, 'danger');
    }
  }

  function renderHistoricalParticipationPreview(result, eventId) {
    const container = document.getElementById('historical-participation-preview');
    container.replaceChildren();
    container.appendChild(
      element(
        'p',
        `${result.resumen.total} filas · ${result.resumen.validos} válidas · ${result.resumen.rechazados} rechazadas`,
        'small mt-2'
      )
    );
    const table = element('table', undefined, 'table table-sm');
    const head = document.createElement('thead');
    const header = document.createElement('tr');
    ['Fila', 'Nombre', 'Documento', 'Correo', 'Entrada', 'Salida', 'Validación'].forEach((label) =>
      header.appendChild(element('th', label))
    );
    head.appendChild(header);
    const body = document.createElement('tbody');
    result.filas.forEach((row) => {
      const tr = document.createElement('tr');
      addCell(tr, `Fila ${row.fila}`);
      addCell(tr, row.participante.nombre);
      addCell(tr, row.participante.documento);
      addCell(tr, row.participante.correo);
      addCell(tr, formatTimestamp(row.entrada_en));
      addCell(tr, formatTimestamp(row.salida_en));
      addCell(
        tr,
        row.errores.length
          ? row.errores.join(' ')
          : row.advertencias?.length
            ? `Advertencia: ${row.advertencias.join(' ')}`
            : 'Válido'
      );
      if (row.errores.length) tr.classList.add('table-danger');
      else if (row.advertencias?.length) tr.classList.add('table-warning');
      body.appendChild(tr);
    });
    table.append(head, body);
    const tableWrap = element('div', undefined, 'table-responsive');
    tableWrap.appendChild(table);
    container.appendChild(tableWrap);
    if (result.resumen.validos > 0) {
      container.appendChild(
        actionButton('Importar y generar certificados', 'btn-primary btn-sm', () =>
          importHistoricalParticipation(eventId)
        )
      );
    }
  }

  async function importHistoricalParticipation(eventId) {
    const sendEmail = document.getElementById('historical-send-certificates').checked;
    const emailMessage = sendEmail
      ? 'Se enviarán por correo los certificados de las participaciones completadas.'
      : 'Se generarán los certificados de las participaciones completadas sin enviar correos.';
    if (!(await window.MiLabDialogs.confirm(`¿Confirmas la importación? ${emailMessage}`))) return;

    const status = document.getElementById('historical-participation-status');
    status.textContent = 'Importando participantes y asistencias…';
    try {
      const result = await request(`/eventos/${eventId}/participaciones/importar`, {
        method: 'POST',
        body: JSON.stringify({
          filas: pageState.historicalPreviewRows,
        }),
      });
      const eligible = (result.participantes_importados || []).filter(
        (participant) => participant.completada
      );
      let certificateResult = { completed: 0, failed: [] };
      if (eligible.length) {
        certificateResult = await issueCertificates(
          eventId,
          eligible,
          sendEmail,
          (participant, index, total) => {
            status.textContent = `Generando certificados ${index} de ${total}: ${participant.nombre}`;
          }
        );
      }
      pageState.historicalPreviewRows = [];
      document.getElementById('historical-participation-preview').replaceChildren();
      const summary = result.resumen;
      const emailSummary = sendEmail
        ? `${certificateResult.completed} certificados enviados`
        : `${certificateResult.completed} certificados generados sin correo`;
      const failureSummary = certificateResult.failed.length
        ? `; ${certificateResult.failed.length} certificados con error`
        : '';
      status.textContent = `Importación terminada: ${summary.importados} participantes, ${summary.rechazados} rechazados; ${emailSummary}${failureSummary}.`;
      showAlert(
        status.textContent,
        summary.rechazados || certificateResult.failed.length ? 'warning' : 'success'
      );
      await refreshDetail();
      await loadEvents();
    } catch (error) {
      status.textContent = '';
      showAlert(error.message, 'danger');
    }
  }

  document.getElementById('btn-nuevo-evento').addEventListener('click', () => setFormMode());
  function closeEventForm(returnToDetail = true) {
    const wasTemplateOnly = pageState.templateOnly;
    eventFormCard.classList.add('d-none');
    eventForm.reset();
    pageState.templateOnly = false;
    window.EncounterTemplateEditor.reset();
    if (wasTemplateOnly && returnToDetail) detailModal.show();
  }

  document.getElementById('btn-cerrar-form-evento').addEventListener('click', closeEventForm);
  document.getElementById('btn-cancelar-evento').addEventListener('click', closeEventForm);
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
    const templateOnly = pageState.templateOnly;
    if (!templateOnly && !eventForm.reportValidity()) return;
    if (!window.EncounterTemplateEditor.hasQrPlacement()) {
      showAlert('Ubica el código QR de verificación en la plantilla antes de guardar.', 'danger');
      return;
    }
    const eventId = document.getElementById('event-id').value;
    const creatingHistoricalEvent =
      !templateOnly && !eventId && document.getElementById('event-historical').checked;
    try {
      const configJson = window.EncounterTemplateEditor.getConfigJson();
      const formData = templateOnly ? new FormData() : new FormData(eventForm);
      if (templateOnly) {
        formData.append('plantilla_config', configJson);
        const templateFile = document.getElementById('event-template').files[0];
        if (templateFile) formData.append('plantilla_pdf', templateFile);
      } else {
        formData.delete('eventId');
      }
      const saved = await request(
        templateOnly
          ? `/eventos/${eventId}/plantilla`
          : eventId
            ? `/eventos/${eventId}`
            : '/eventos',
        {
          method: templateOnly ? 'PATCH' : eventId ? 'PUT' : 'POST',
          body: formData,
        }
      );
      showAlert(
        templateOnly
          ? 'Plantilla actualizada. Los certificados ya emitidos se conservaron sin cambios.'
          : eventId
            ? 'Evento actualizado.'
            : creatingHistoricalEvent
              ? 'Evento histórico creado. Carga ahora sus participantes y asistencias.'
              : 'Evento creado.',
        'success'
      );
      closeEventForm(false);
      await loadEvents();
      if (templateOnly) {
        detailModal.show();
        await refreshDetail();
      } else if (creatingHistoricalEvent && saved.evento_id) {
        await openDetail(saved.evento_id);
      }
    } catch (error) {
      showAlert(error.message, 'danger');
    }
  });

  loadEvents();
})();
