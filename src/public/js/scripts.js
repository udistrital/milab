/* global window, document */

(function (window, document) {
  const $ = window.jQuery;

  if (!$ || !$.fn || !$.fn.DataTable) {
    return;
  }

  const GRID_SELECTOR = 'table.js-data-grid';
  const language = {
    decimal: ',',
    thousands: '.',
    processing: 'Procesando...',
    search: 'Buscar global:',
    lengthMenu: 'Mostrar _MENU_ registros',
    info: 'Mostrando _START_ a _END_ de _TOTAL_ registros',
    infoEmpty: 'Mostrando 0 a 0 de 0 registros',
    infoFiltered: '(filtrados de _MAX_ registros)',
    loadingRecords: 'Cargando...',
    zeroRecords: 'No se encontraron resultados',
    emptyTable: 'No hay datos disponibles en esta tabla',
    paginate: {
      first: 'Primera',
      previous: 'Anterior',
      next: 'Siguiente',
      last: 'Última',
    },
  };

  function ensureTableId($table, index) {
    if ($table.attr('id')) {
      return $table.attr('id');
    }

    const generatedId = `appDataGrid-${index + 1}`;
    $table.attr('id', generatedId);
    return generatedId;
  }

  function buildFilterRow($table) {
    if ($table.data('gridColumnFilters') === false) {
      return;
    }

    const $thead = $table.find('thead');
    const $headerRow = $thead.find('tr').first();

    if ($headerRow.length === 0 || $thead.find('tr.data-grid-filters').length > 0) {
      return;
    }

    const $filterRow = $('<tr class="data-grid-filters"></tr>');

    $headerRow.children('th').each(function () {
      const $headerCell = $(this);
      const title = $headerCell.text().replace(/\s+/g, ' ').trim();
      const filterable = $headerCell.data('gridFilter') !== false;
      const $filterCell = $('<th class="data-grid-filter-cell"></th>');

      if (!filterable) {
        $filterCell.append('<span class="app-grid-filter-placeholder">Sin filtro</span>');
        $filterRow.append($filterCell);
        return;
      }

      const $input = $('<input type="text" class="app-grid-filter-input" autocomplete="off" />');
      $input.attr('placeholder', title ? `Filtrar ${title}` : 'Filtrar columna');
      $input.attr('aria-label', title ? `Filtrar ${title}` : 'Filtrar columna');
      $filterCell.append($input);
      $filterRow.append($filterCell);
    });

    $thead.append($filterRow);
  }

  function getActionColumnIndex(table) {
    const headerRow = table.tHead && table.tHead.rows[0];

    if (!headerRow || headerRow.cells.length === 0) {
      return -1;
    }

    const lastColumnIndex = headerRow.cells.length - 1;
    const lastHeading = headerRow.cells[lastColumnIndex].textContent
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/:$/, '')
      .toLocaleLowerCase();

    return ['acciones', 'acción', 'accion', 'opciones'].includes(lastHeading)
      ? lastColumnIndex
      : -1;
  }

  function applyStickyActionColumn(table, columnIndex) {
    if (columnIndex < 0) {
      return;
    }

    Array.from(table.tHead ? table.tHead.rows : []).forEach(function (row) {
      if (row.cells[columnIndex]) {
        row.cells[columnIndex].classList.add('app-grid-sticky-action');
      }
    });

    Array.from(table.tBodies).forEach(function (body) {
      Array.from(body.rows).forEach(function (row) {
        if (row.cells[columnIndex]) {
          row.cells[columnIndex].classList.add('app-grid-sticky-action');
        }
      });
    });
  }

  function initializeStickyActionColumns() {
    document.querySelectorAll('table:not(.js-data-grid)').forEach(function (table) {
      if (table.closest('.dashboard-detail-table-wrap')) {
        return;
      }

      applyStickyActionColumn(table, getActionColumnIndex(table));
    });
  }

  function resolveColumnDefs($table, stickyActionColumn) {
    const nonOrderable = [];
    const nonSearchable = [];

    $table
      .find('thead tr')
      .first()
      .children('th')
      .each(function (index) {
        const $headerCell = $(this);

        if ($headerCell.data('gridOrderable') === false) {
          nonOrderable.push(index);
        }

        if ($headerCell.data('gridFilter') === false) {
          nonSearchable.push(index);
        }
      });

    const defs = [];

    if (nonOrderable.length > 0) {
      defs.push({ targets: nonOrderable, orderable: false });
    }

    if (nonSearchable.length > 0) {
      defs.push({ targets: nonSearchable, searchable: false });
    }

    if (stickyActionColumn >= 0) {
      defs.push({ targets: stickyActionColumn, className: 'app-grid-sticky-action' });
    }

    return defs;
  }

  function resolveInitialOrder($table) {
    const $headers = $table.find('thead tr').first().children('th');

    for (let index = 0; index < $headers.length; index += 1) {
      const $header = $($headers[index]);
      if ($header.data('gridOrderable') !== false) {
        return [[index, 'asc']];
      }
    }

    return [];
  }

  function resolveScrollX($table) {
    const configuredValue = $table.data('gridScrollX');

    if (configuredValue === undefined) {
      return false;
    }

    if (typeof configuredValue === 'string') {
      return configuredValue !== 'false';
    }

    return Boolean(configuredValue);
  }

  function attachColumnFilters(dataTable, $table) {
    const $wrapper = $table.closest('.dataTables_wrapper');
    const filterSelector = 'thead tr.data-grid-filters input';

    if ($wrapper.length === 0) {
      return;
    }

    $wrapper
      .off('.appColumnFilters', filterSelector)
      .on('click.appColumnFilters', filterSelector, function (event) {
        event.stopPropagation();
      })
      .on(
        'keyup.appColumnFilters change.appColumnFilters input.appColumnFilters',
        filterSelector,
        function (event) {
          event.stopPropagation();

          const columnIndex = $(this).closest('th').index();
          const column = dataTable.column(columnIndex);

          if (column.search() !== this.value) {
            column.search(this.value).draw();
          }
        }
      );
  }

  function attachResetButton(dataTable, $table) {
    const tableId = $table.attr('id');
    const wrapperSelector = `#${tableId}_wrapper .dataTables_filter`;
    const $filterContainer = $(wrapperSelector);
    const $wrapper = $table.closest('.dataTables_wrapper');

    if (
      $filterContainer.length === 0 ||
      $filterContainer.find('.app-grid-reset-button').length > 0
    ) {
      return;
    }

    const $button = $(
      '<button type="button" class="app-grid-reset-button">Limpiar filtros</button>'
    );

    $button.on('click', function () {
      const $globalInput = $filterContainer.find('input[type="search"]');
      const $columnInputs = $wrapper.find('thead tr.data-grid-filters input');

      $globalInput.val('');
      $columnInputs.val('');
      dataTable.search('');
      dataTable.columns().search('');
      dataTable.order(resolveInitialOrder($table));
      dataTable.page('first').draw();
    });

    $filterContainer.append($button);
  }

  function initializeDataGrid(index, table) {
    const $table = $(table);

    if ($.fn.dataTable.isDataTable(table)) {
      return;
    }

    ensureTableId($table, index);
    buildFilterRow($table);
    const stickyActionColumn = getActionColumnIndex(table);
    applyStickyActionColumn(table, stickyActionColumn);

    const pageLength = Number($table.data('gridPageLength')) || 10;
    const dataTable = $table.DataTable({
      dom: $table.hasClass('app-grid-contained')
        ? '<"app-contained-grid"<"app-grid-toolbar"lf><"app-grid-scroll"t><"app-grid-footer"ip>>'
        : 'lfrtip',
      language,
      pageLength,
      lengthMenu: [10, 25, 50, 100],
      order: resolveInitialOrder($table),
      orderCellsTop: true,
      autoWidth: false,
      scrollX: resolveScrollX($table),
      searchDelay: 250,
      columnDefs: resolveColumnDefs($table, stickyActionColumn),
    });

    attachColumnFilters(dataTable, $table);
    attachResetButton(dataTable, $table);
  }

  function adjustTablesInTab(event) {
    const targetSelector = event.target && event.target.getAttribute('data-bs-target');

    if (!targetSelector) {
      return;
    }

    const tabPane = document.querySelector(targetSelector);

    if (!tabPane) {
      return;
    }

    const tables = tabPane.querySelectorAll(GRID_SELECTOR);

    tables.forEach(function (table) {
      if ($.fn.dataTable.isDataTable(table)) {
        $(table).DataTable().columns.adjust();
      }
    });
  }

  function initializeLaboratorioCellToggle() {
    document.addEventListener('click', function (event) {
      const toggleButton = event.target.closest('[data-labs-toggle="true"]');

      if (!toggleButton) {
        return;
      }

      const cell = toggleButton.closest('td');

      if (!cell) {
        return;
      }

      const textElement = cell.querySelector('[data-labs-text="true"]');

      if (!textElement) {
        return;
      }

      const isCollapsed = textElement.classList.contains('is-collapsed');

      if (isCollapsed) {
        textElement.classList.remove('is-collapsed');
        toggleButton.textContent = 'Ver menos';
        toggleButton.setAttribute('aria-expanded', 'true');
      } else {
        textElement.classList.add('is-collapsed');
        toggleButton.textContent = 'Ver más';
        toggleButton.setAttribute('aria-expanded', 'false');
      }
    });
  }

  function initializeEmailEditor() {
    const modalElement = document.querySelector('[data-email-editor-modal]');

    if (!modalElement || !window.bootstrap) {
      return;
    }

    if (modalElement.parentElement !== document.body) {
      document.body.appendChild(modalElement);
    }

    const form = modalElement.querySelector('[data-email-editor-form]');
    const feedbackElement = modalElement.querySelector('[data-email-editor-feedback]');
    const pageFeedbackElement = document.querySelector('[data-email-editor-page-feedback]');
    const saveButton = modalElement.querySelector('[data-email-editor-save]');
    const titleElement = modalElement.querySelector('[data-email-editor-title]');
    const subtitleElement = modalElement.querySelector('[data-email-editor-subtitle]');
    const hiddenDocumentInput = modalElement.querySelector('[data-email-editor-hidden-document]');
    const nameInput = modalElement.querySelector('[data-email-editor-name]');
    const documentInput = modalElement.querySelector('[data-email-editor-document]');
    const currentEmailInput = modalElement.querySelector('[data-email-editor-current]');
    const emailInput = modalElement.querySelector('[data-email-editor-input]');
    const modal = window.bootstrap.Modal.getOrCreateInstance(modalElement);
    let activeTrigger = null;

    function hideFeedback() {
      if (feedbackElement) {
        feedbackElement.classList.add('d-none');
        feedbackElement.textContent = '';
      }
    }

    function showFeedback(message) {
      if (!feedbackElement) {
        return;
      }

      feedbackElement.textContent = message;
      feedbackElement.classList.remove('d-none');
    }

    function showPageFeedback(message) {
      if (!pageFeedbackElement) {
        return;
      }

      pageFeedbackElement.textContent = message;
      pageFeedbackElement.classList.remove('d-none');
    }

    function resetModal() {
      hideFeedback();
      form.reset();
      activeTrigger = null;
      saveButton.disabled = false;
      saveButton.textContent = 'Guardar correo';
    }

    document.addEventListener('click', function (event) {
      const trigger = event.target.closest('[data-email-editor-trigger]');

      if (!trigger) {
        return;
      }

      activeTrigger = trigger;
      hideFeedback();

      const documentValue = trigger.getAttribute('data-email-editor-document') || '';
      const nameValue = trigger.getAttribute('data-email-editor-name') || '';
      const currentEmailValue = trigger.getAttribute('data-email-editor-current-email') || '';
      const labelValue = trigger.getAttribute('data-email-editor-label') || 'usuario';
      const endpointValue = trigger.getAttribute('data-email-editor-endpoint') || form.action;

      form.setAttribute('action', endpointValue);
      hiddenDocumentInput.value = documentValue;
      nameInput.value = nameValue;
      documentInput.value = documentValue;
      currentEmailInput.value = currentEmailValue;
      emailInput.value = currentEmailValue;
      titleElement.textContent = `Editar correo de ${labelValue}`;
      subtitleElement.textContent = 'Actualiza el correo institucional asociado a esta cuenta.';

      modal.show();
    });

    modalElement.addEventListener('hidden.bs.modal', function () {
      resetModal();
    });

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      hideFeedback();

      if (!activeTrigger) {
        showFeedback(
          'No encontramos la fila seleccionada. Cierra el modal e inténtalo nuevamente.'
        );
        return;
      }

      saveButton.disabled = true;
      saveButton.textContent = 'Guardando...';

      try {
        const formData = new window.FormData(form);
        const payload = new window.URLSearchParams(formData);
        const response = await window.fetch(form.action, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'X-Requested-With': 'fetch',
          },
          body: payload.toString(),
        });

        let result;

        try {
          result = await response.json();
        } catch {
          result = {
            ok: false,
            message: 'No fue posible procesar la respuesta del servidor.',
          };
        }

        if (!response.ok || !result.ok) {
          showFeedback(result.message || 'No fue posible actualizar el correo.');
          saveButton.disabled = false;
          saveButton.textContent = 'Guardar correo';
          return;
        }

        const row = activeTrigger.closest('tr');
        const emailCell = row ? row.querySelector('[data-email-cell]') : null;
        const nextEmail = result.correo || emailInput.value.trim();

        if (emailCell) {
          emailCell.textContent = nextEmail;
        }

        activeTrigger.setAttribute('data-email-editor-current-email', nextEmail);
        showPageFeedback('Correo actualizado correctamente.');
        modal.hide();
      } catch {
        showFeedback(
          'No fue posible actualizar el correo. Verifica la conexión e inténtalo nuevamente.'
        );
        saveButton.disabled = false;
        saveButton.textContent = 'Guardar correo';
      }
    });
  }

  function initializeFirstVisitGuide() {
    const body = document.body;
    const isAuthenticated = body && body.getAttribute('data-is-authenticated') === 'true';
    const storageKey = 'milab-guided-help-v1';

    if (!isAuthenticated || !window.driver || !window.driver.js) {
      return;
    }

    function hasSeenGuide() {
      try {
        return window.localStorage.getItem(storageKey) === 'true';
      } catch {
        return false;
      }
    }

    function markGuideAsSeen() {
      try {
        window.localStorage.setItem(storageKey, 'true');
      } catch {
        // Ignore storage restrictions.
      }
    }

    function resolveStepElement(selectors) {
      for (let index = 0; index < selectors.length; index += 1) {
        const element = document.querySelector(selectors[index]);
        if (element) {
          return element;
        }
      }

      return null;
    }

    function createStep(selectors, title, description, side, align) {
      return {
        selectors,
        popover: {
          title,
          description,
          side: side || 'bottom',
          align: align || 'center',
        },
      };
    }

    function resolveGuideModule(element) {
      const group = element.closest('.app-sidebar-group');
      const groupTitle = group
        ?.querySelector('.app-sidebar-group-toggle > span')
        ?.textContent.replace(/\s+/g, ' ')
        .trim();

      if (groupTitle) {
        return groupTitle;
      }

      const primaryLink = element.closest('.app-sidebar-primary .app-sidebar-link');
      const primaryTitle = primaryLink
        ?.querySelector('span')
        ?.textContent.replace(/\s+/g, ' ')
        .trim();

      return primaryTitle || 'General';
    }

    function expandNavigationForGuide(moduleId) {
      const expandedState = {
        collapses: [],
        dropdowns: [],
      };

      document.querySelectorAll('.app-sidebar .collapse').forEach(function (collapse) {
        const toggle = collapse.id
          ? document.querySelector(`[data-bs-target="#${collapse.id}"]`)
          : null;
        const group = collapse.closest('.app-sidebar-group');
        const groupLabel = group
          ?.querySelector('.app-sidebar-group-toggle > span')
          ?.textContent.trim();
        const shouldExpand =
          collapse.id === 'appSidebarNavigation' || !moduleId || groupLabel === moduleId;

        expandedState.collapses.push({
          element: collapse,
          wasShown: collapse.classList.contains('show'),
          toggle,
          previousExpanded: toggle ? toggle.getAttribute('aria-expanded') : null,
        });

        if (shouldExpand && !collapse.classList.contains('show')) {
          collapse.classList.add('show');
        }

        if (shouldExpand && toggle) {
          toggle.setAttribute('aria-expanded', 'true');
        }
      });

      return expandedState;
    }

    function restoreGuideDropdown(entry) {
      if (!entry.toggleWasShown) {
        entry.toggle.classList.remove('show');
      }

      if (!entry.menuWasShown) {
        entry.menu.classList.remove('show');
      }

      if (entry.previousExpanded === null) {
        entry.toggle.removeAttribute('aria-expanded');
      } else {
        entry.toggle.setAttribute('aria-expanded', entry.previousExpanded);
      }
    }

    function syncGuideDropdownForTarget(target, expandedState) {
      const dropdown = target ? target.closest('.dropdown') : null;
      const toggle = dropdown?.querySelector('[data-bs-toggle="dropdown"]');
      const menu = dropdown?.querySelector('.dropdown-menu');
      const activeDropdown = toggle && menu ? dropdown : null;

      expandedState.dropdowns.slice().forEach(function (entry) {
        if (entry.dropdown !== activeDropdown) {
          restoreGuideDropdown(entry);
          expandedState.dropdowns.splice(expandedState.dropdowns.indexOf(entry), 1);
        }
      });

      if (!activeDropdown) {
        return;
      }

      let entry = expandedState.dropdowns.find(function (item) {
        return item.dropdown === activeDropdown;
      });

      if (!entry) {
        entry = {
          dropdown: activeDropdown,
          toggle,
          menu,
          toggleWasShown: toggle.classList.contains('show'),
          menuWasShown: menu.classList.contains('show'),
          previousExpanded: toggle.getAttribute('aria-expanded'),
        };
        expandedState.dropdowns.push(entry);
      }

      toggle.classList.add('show');
      toggle.setAttribute('aria-expanded', 'true');
      menu.classList.add('show');
    }

    function scrollGuideTargetIntoView(element) {
      if (!element || typeof element.scrollIntoView !== 'function') {
        return;
      }

      const prefersReducedMotion =
        window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      element.scrollIntoView({
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
    }

    function restoreNavigationAfterGuide(expandedState) {
      if (!expandedState) {
        return;
      }

      expandedState.collapses.forEach(function (entry) {
        if (!entry.wasShown) {
          entry.element.classList.remove('show');
        }

        if (entry.toggle) {
          if (entry.previousExpanded === null) {
            entry.toggle.removeAttribute('aria-expanded');
          } else {
            entry.toggle.setAttribute('aria-expanded', entry.previousExpanded);
          }
        }
      });

      expandedState.dropdowns.forEach(function (entry) {
        restoreGuideDropdown(entry);
      });
    }

    function buildSteps(moduleId) {
      const candidateSteps = [
        createStep(
          ['[data-guide="main-navigation"]'],
          'Tu mapa de MiLab',
          'Aquí aparecen las áreas y acciones que tu perfil tiene habilitadas. El recorrido se adapta a este menú y solo muestra accesos disponibles para ti.',
          'bottom',
          'start'
        ),
        createStep(
          ['[data-guide="nav-inicio"]'],
          'Punto de partida',
          'Vuelve al inicio para orientarte y encontrar los accesos principales de tu jornada en MiLab.',
          'bottom',
          'center'
        ),
        createStep(
          ['[data-guide="nav-solicitar-certificado"]'],
          'Tu paz y salvo, paso a paso',
          'Inicia la solicitud del certificado que corresponde a tu perfil y consulta su estado desde los accesos disponibles.',
          'bottom',
          'center'
        ),
        createStep(
          ['[data-guide="nav-monitoreo"]'],
          'El pulso de la operación',
          'Revisa indicadores, tendencias y filtros en un solo tablero para entender qué ocurre y decidir dónde actuar.',
          'bottom',
          'center'
        ),
        createStep(
          ['[data-guide="nav-registro"]'],
          'Personas y roles, en orden',
          'Desde aquí se enrolan los perfiles que hacen posible la operación de los laboratorios y se mantiene actualizado quién puede hacer qué.',
          'bottom',
          'center'
        ),
        createStep(
          ['[data-guide="nav-registro-coordinadores"]'],
          'Coordinación con alcance claro',
          'Registra coordinadores y define el ámbito de facultades que acompañan. Así cada gestión llega a quien corresponde.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-registro-laboratoristas"]'],
          'Equipo de laboratorio',
          'Incorpora laboratoristas y asigna las UAL bajo su responsabilidad para que cada persona vea las tareas de su operación.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-registro-monitores"]'],
          'Monitores listos para apoyar',
          'Enrola monitores para acompañar préstamos y prácticas, con los permisos definidos para su función.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-gestores-laboratorio"]'],
          'Gestión con mirada universitaria',
          'Enrola o edita gestores de laboratorio. Su cobertura es institucional: no necesitan asignaciones a UAL.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-registro-admin"]'],
          'Accesos administrativos',
          'Registra o consulta cuentas administradoras solo cuando deban tener responsabilidades de configuración y control.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-consulta-control"]'],
          'Encuentra la información clave',
          'Este centro reúne consultas de personas, certificados, sanciones y estructura institucional para resolver gestiones sin saltar entre pantallas.',
          'bottom',
          'center'
        ),
        createStep(
          ['[data-guide="nav-certificados"]'],
          'Certificados bajo control',
          'Consulta los registros de certificados y verifica la información necesaria para atender solicitudes con confianza.',
          'bottom',
          'center'
        ),
        createStep(
          ['[data-guide="nav-consulta-masiva"]'],
          'De una consulta a una vista completa',
          'Reúne la información de varios estudiantes en un informe. La barra de progreso muestra qué documento se está consultando y cómo avanza el proceso.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-coordinadores-registrados"]'],
          'Coordinadores registrados',
          'Revisa quién coordina cada ámbito y consulta la información que facilita la continuidad de la gestión.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-estudiantes-docentes-registrados"]'],
          'Comunidad académica',
          'Consulta las cuentas de estudiantes y docentes registradas en MiLab y valida su información cuando una gestión lo requiera.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-laboratoristas-registrados"]'],
          'Laboratoristas registrados',
          'Encuentra el personal activo y revisa sus datos para mantener actualizada la operación de cada laboratorio.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-monitores-registrados"]'],
          'Monitores registrados',
          'Consulta los monitores enrolados y confirma quiénes están disponibles para apoyar los servicios.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-facultades-ual"]'],
          'El mapa institucional',
          'Explora facultades y UAL para ubicar cada laboratorio dentro de la estructura de la Universidad.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-logs"]'],
          'Trazabilidad cuando importa',
          'Consulta el registro de actividad para entender qué ocurrió, cuándo y en qué proceso.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-sanciones"]'],
          'Una ruta clara para las sanciones',
          'Consulta casos, gestiona registros y atiende reclamaciones con las herramientas habilitadas para tu perfil.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-listado-sanciones"]'],
          'Panorama de sanciones',
          'Filtra las sanciones registradas, revisa su estado y encuentra rápidamente el caso que necesitas.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-sanciones-estudiantes"]'],
          'Consulta de sanciones de estudiantes',
          'Busca por documento y revisa la información del estudiante y sus sanciones de laboratorio. Si eres administrador, también puedes abrir “Otras multas SGA” para consultar conceptos externos al catálogo de laboratorio.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-sanciones-docentes"]'],
          'Consulta de sanciones de docentes',
          'Busca al docente, revisa sus datos y gestiona las sanciones asociadas desde un flujo dedicado.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-reclamaciones"]'],
          'Reclamaciones, de principio a fin',
          'Sigue los casos recibidos, identifica los que esperan respuesta y mantén visible el avance de cada conversación.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-paz-y-salvos"]'],
          'Antes de emitir, verifica',
          'Comprueba el estado de cada persona y prepara consultas individuales o por lotes antes de continuar el trámite.',
          'bottom',
          'center'
        ),
        createStep(
          ['[data-guide="nav-verificar-estudiante"]'],
          'Verificación de estudiante',
          'Consulta el estado del estudiante y reúne la información necesaria para continuar el trámite de paz y salvo.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-verificar-docente"]'],
          'Verificación de docente',
          'Comprueba el estado del docente antes de avanzar con su certificado o paz y salvo.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-generar-pys-masivo"]'],
          'Paz y salvos, en lote',
          'Procesa hasta 50 documentos o códigos en una consulta y sigue el avance de cada caso sin perder el contexto.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-administracion"]'],
          'Herramientas para la gestión diaria',
          'Accede a las tareas operativas de sanciones que mantienen en marcha la atención de los laboratorios.',
          'bottom',
          'center'
        ),
        createStep(
          ['[data-guide="nav-configuracion"]'],
          'La plataforma, a tu medida',
          'Configura accesos y catálogos con cuidado: estos cambios determinan cómo se organiza y opera MiLab.',
          'bottom',
          'center'
        ),
        createStep(
          ['[data-guide="nav-roles"]'],
          'Roles y responsabilidades',
          'Consulta los roles disponibles y organiza los permisos de acuerdo con las funciones de cada equipo.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-permisos-menus"]'],
          'Cada perfil, sus herramientas',
          'Administra los menús visibles y las acciones habilitadas por rol para que cada persona encuentre lo que necesita.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-catalogo-sanciones"]'],
          'Un catálogo consistente',
          'Mantén organizados los conceptos de sanción para que los registros y reportes usen criterios compartidos.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-esquema-bd"]'],
          'Conoce la estructura de MiLab',
          'Explora en modo de consulta el esquema de base de datos de MiLab y sus relaciones, sin mezclar objetos de otros esquemas.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-inventarios"]'],
          'Inventario, con trazabilidad',
          'Este módulo reúne la gestión de bienes y las revisiones pendientes para mantener actualizado el inventario institucional.',
          'bottom',
          'center'
        ),
        createStep(
          ['[data-guide="nav-inventario-gestion"]'],
          'Gestión del inventario',
          'Registra, actualiza y consulta bienes; usa las herramientas de carga y exportación para trabajar con conjuntos de información.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-inventario-aprobaciones"]'],
          'Aprobaciones de inventario',
          'Revisa las cargas que esperan validación y aprueba o devuelve cada proceso con una decisión trazable.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-prestamos"]'],
          'Préstamos y prácticas, conectados',
          'Sigue el ciclo del servicio: disponibilidad, solicitudes, aprobaciones, entrega, devolución y prácticas.',
          'bottom',
          'center'
        ),
        createStep(
          ['[data-guide="nav-prestamos-inventario"]'],
          'Inventario para préstamos',
          'Consulta los recursos disponibles para atender solicitudes y controlar el movimiento de equipos.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-prestamos-equipos"]'],
          'Equipos',
          'Explora el catálogo de equipos y sus datos operativos antes de iniciar una solicitud o una gestión.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-prestamos-solicitar-equipo"]'],
          'Solicitar equipo',
          'Inicia una solicitud con la información requerida y consulta la disponibilidad según las reglas del servicio.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-prestamos-mis-solicitudes"]'],
          'Mis solicitudes',
          'Haz seguimiento a tus solicitudes y revisa en qué etapa se encuentra cada préstamo.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-prestamos-gestion-solicitudes"]'],
          'Gestión de solicitudes',
          'Revisa las solicitudes pendientes y administra su avance para que cada préstamo tenga una respuesta clara.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-prestamos-entrega-devolucion"]'],
          'Entrega y devolución',
          'Registra los movimientos del equipo y deja constancia de su estado al salir y regresar al laboratorio.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-prestamos-incidencias"]'],
          'Incidencias',
          'Documenta y consulta novedades para que los equipos de coordinación y laboratorio puedan darles seguimiento.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-prestamos-solicitar-practica"]'],
          'Reserva una práctica',
          'Solicita una práctica o espacio disponible con la información necesaria para coordinar la actividad.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-prestamos-mis-practicas"]'],
          'Mis prácticas',
          'Consulta tus reservas, revisa su estado y vuelve a la información de tus actividades cuando la necesites.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-prestamos-gestion-practicas"]'],
          'Gestión de prácticas',
          'Administra reservas y seguimiento operativo para que cada actividad llegue ordenada a su cierre.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-prestamos-salas"]'],
          'Salas',
          'Coordina espacios y salas vinculados a las actividades del módulo.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-prestamos-reportes"]'],
          'Reportes',
          'Convierte la actividad en información útil para revisar el servicio y detectar oportunidades de mejora.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-prestamos-auditoria"]'],
          'Auditoría',
          'Revisa la trazabilidad de eventos relevantes para soporte, control y seguimiento.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-prestamos-parametrizaciones"]'],
          'Parametrizaciones',
          'Ajusta los parámetros generales que determinan cómo opera el servicio de préstamos.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-prestamos-configuracion-practicas"]'],
          'Configuración de prácticas',
          'Define reglas y alcances para que las reservas de prácticas respondan a la operación de cada coordinación.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-hojas-vida-mantenimientos"]'],
          'La historia de cada equipo',
          'Consulta hojas de vida, registra mantenimientos y conserva la historia técnica para cuidar los equipos a largo plazo.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-capacitacion"]'],
          'Aprender también es parte del laboratorio',
          'Encuentra cursos, sesiones y certificaciones conectadas con los equipos y las necesidades de formación.',
          'bottom',
          'center'
        ),
        createStep(
          ['[data-guide="nav-capacitacion-cursos"]'],
          'Diseña la formación',
          'Crea cursos con información clara para que la comunidad encuentre las capacitaciones disponibles.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-capacitacion-asociacion-equipos"]'],
          'Cursos conectados con equipos',
          'Asocia cursos y equipos especializados para que la formación describa las herramientas que se usarán.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-capacitacion-gestion"]'],
          'De curso a experiencia',
          'Programa sesiones, gestiona inscripciones y asistencia, y consulta evidencias y reportes de capacitación.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-capacitacion-mis"]'],
          'Tu ruta de aprendizaje',
          'Descubre sesiones disponibles, gestiona tus inscripciones y consulta tus certificaciones en un solo lugar.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-encuentros"]'],
          'Encuentros que dejan huella',
          'Organiza eventos y experiencias de proyección con registro, asistencia y certificación integrados.',
          'bottom',
          'center'
        ),
        createStep(
          ['[data-guide="nav-gestionar-encuentros"]'],
          'Coordina cada encuentro',
          'Gestiona eventos, participantes y asistencia; al final, consulta reportes y certificados del proceso.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-mis-logros"]'],
          'Tus logros, siempre a mano',
          'Consulta las medallas y certificaciones obtenidas en los encuentros y actividades de la comunidad.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="account-menu"]'],
          'Tu espacio personal',
          'Abre tu perfil para revisar tus datos y los accesos asociados a tu cuenta.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="help-manuals"]'],
          'Ayuda cuando la necesites',
          'Vuelve a iniciar este tour o abre los manuales para profundizar en el uso de la plataforma.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="logout-action"]'],
          'Cierra tu sesión con seguridad',
          'Cuando termines, usa esta opción para salir de MiLab y proteger tu cuenta.',
          'right',
          'start'
        ),
        createStep(
          ['.app-frame', '.dashboard-page', '.app-page-shell', '.container'],
          'Tu área de trabajo',
          'Aquí aparece el contenido de cada módulo: formularios, consultas, reportes y el siguiente paso de tu gestión.',
          'top',
          'center'
        ),
      ];

      return candidateSteps
        .map(function (step) {
          const element = resolveStepElement(step.selectors);

          if (!element || !step.popover.title.trim() || !step.popover.description.trim()) {
            return null;
          }

          const module = resolveGuideModule(element);
          if (moduleId && module !== moduleId) {
            return null;
          }

          return {
            element,
            module,
            popover: step.popover,
          };
        })
        .filter(Boolean);
    }

    function startGuide(options) {
      const settings = options || {};
      const forceGuide = Boolean(settings.force);

      if (!forceGuide && hasSeenGuide()) {
        return;
      }

      const expandedNavigationState = expandNavigationForGuide(settings.module);
      const steps = buildSteps(settings.module);

      if (steps.length === 0) {
        restoreNavigationAfterGuide(expandedNavigationState);
        return;
      }

      const driver = window.driver.js.driver({
        allowClose: true,
        showProgress: true,
        animate: true,
        overlayOpacity: 0.55,
        nextBtnText: 'Siguiente',
        prevBtnText: 'Anterior',
        doneBtnText: 'Finalizar',
        progressText: '{{current}} de {{total}}',
        steps,
        onHighlighted: function (element) {
          syncGuideDropdownForTarget(element, expandedNavigationState);
          scrollGuideTargetIntoView(element);
        },
        onDestroyStarted: function () {
          markGuideAsSeen();
          driver.destroy();
        },
        onDestroyed: function () {
          restoreNavigationAfterGuide(expandedNavigationState);
          if (settings.cleanUrl) {
            cleanTourParameter();
          }
        },
      });

      markGuideAsSeen();
      window.setTimeout(function () {
        driver.drive();
      }, settings.delay || 350);
    }

    function cleanTourParameter() {
      const url = new window.URL(window.location.href);
      url.searchParams.delete('tour');
      window.history.replaceState({}, document.title, url.toString());
    }

    function getAvailableGuideModules() {
      return Array.from(
        new Set(
          buildSteps()
            .map(function (step) {
              return step.module;
            })
            .filter(Boolean)
        )
      );
    }

    let introModalInstance = null;
    let introSettings = null;
    let pendingGuideOptions = null;

    function showGuideIntro(options) {
      const modalElement = document.getElementById('milabTourIntroModal');
      const moduleSelect = modalElement?.querySelector('#milabTourModuleSelect');
      const moduleButton = modalElement?.querySelector('[data-guide-start="module"]');
      const allButton = modalElement?.querySelector('[data-guide-start="all"]');

      if (
        !modalElement ||
        !moduleSelect ||
        !moduleButton ||
        !allButton ||
        !window.bootstrap ||
        !window.bootstrap.Modal
      ) {
        startGuide({ ...(options || {}), force: true });
        return;
      }

      const modules = getAvailableGuideModules();
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Selecciona un módulo disponible';
      moduleSelect.replaceChildren(placeholder);

      modules.forEach(function (module) {
        const option = document.createElement('option');
        option.value = module;
        option.textContent = module;
        moduleSelect.appendChild(option);
      });

      moduleSelect.disabled = modules.length === 0;
      moduleButton.disabled = true;
      allButton.disabled = modules.length === 0;

      if (!modalElement.hasAttribute('data-guide-intro-bound')) {
        modalElement.setAttribute('data-guide-intro-bound', 'true');

        moduleSelect.addEventListener('change', function () {
          moduleButton.disabled = !moduleSelect.value;
        });

        modalElement.addEventListener('click', function (event) {
          const actionButton = event.target.closest('[data-guide-start]');
          if (!actionButton) {
            return;
          }

          const mode = actionButton.getAttribute('data-guide-start');
          const moduleId = mode === 'module' ? moduleSelect.value : null;
          if (mode === 'module' && !moduleId) {
            return;
          }

          event.preventDefault();
          pendingGuideOptions = {
            force: true,
            module: moduleId,
            cleanUrl: Boolean(introSettings && introSettings.cleanUrl),
            delay: (introSettings && introSettings.delay) || 350,
          };
          introModalInstance.hide();
        });

        modalElement.addEventListener('hidden.bs.modal', function () {
          const guideOptions = pendingGuideOptions;
          const settings = introSettings || {};
          pendingGuideOptions = null;
          introSettings = null;

          if (guideOptions) {
            startGuide(guideOptions);
            return;
          }

          markGuideAsSeen();
          if (settings.cleanUrl) {
            cleanTourParameter();
          }
        });
      }

      introSettings = options || {};
      introModalInstance = window.bootstrap.Modal.getOrCreateInstance(modalElement);
      introModalInstance.show();
    }

    window.MiLabGuide = {
      start: showGuideIntro,
      run: startGuide,
    };

    document.addEventListener('click', function (event) {
      const trigger = event.target.closest?.('[data-guide-restart="true"]');

      if (!trigger) {
        return;
      }

      event.preventDefault();
      showGuideIntro({ force: true, delay: 120 });
    });

    if (new window.URL(window.location.href).searchParams.get('tour') === '1') {
      showGuideIntro({ force: true, cleanUrl: true });
      return;
    }

    if (!hasSeenGuide()) {
      window.setTimeout(function () {
        showGuideIntro();
      }, 350);
    }
  }

  function initializeOatiLoadingIndicator() {
    const DEFAULT_MESSAGE = 'Consultando información en la OATI...';
    const DEFAULT_HINT =
      'El tiempo de espera depende de la respuesta del servicio externo, no de MILab.';
    let overlay = null;

    function buildOverlay() {
      const element = document.createElement('div');
      element.className =
        'position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center bg-dark bg-opacity-50';
      element.style.zIndex = '4000';
      element.setAttribute('role', 'status');
      element.setAttribute('aria-live', 'polite');
      element.innerHTML =
        '<div class="bg-white rounded-3 shadow p-4 text-center" style="max-width: 22rem;">' +
        '<div class="spinner-border text-primary mb-3" aria-hidden="true"></div>' +
        '<p class="fw-semibold mb-1 text-dark" data-oati-loading-message></p>' +
        '<p class="text-muted small mb-0">' +
        DEFAULT_HINT +
        '</p>' +
        '</div>';
      document.body.appendChild(element);
      return element;
    }

    function showOverlay(message) {
      if (!overlay) {
        overlay = buildOverlay();
      }

      const messageElement = overlay.querySelector('[data-oati-loading-message]');
      if (messageElement) {
        messageElement.textContent = message || DEFAULT_MESSAGE;
      }

      overlay.classList.remove('d-none');
    }

    document.addEventListener('submit', function (event) {
      const form = event.target;

      if (!form || form.getAttribute('data-oati-loading') !== 'true' || event.defaultPrevented) {
        return;
      }

      showOverlay(form.getAttribute('data-oati-loading-message'));
      const submitButtons = Array.from(form.querySelectorAll('button[type="submit"]'));
      if (submitButtons.includes(event.submitter) && !event.submitter.disabled) {
        window.MiLabSubmitLock.preserveSubmitter(form, event.submitter);
      }
      submitButtons.forEach(function (button) {
        button.disabled = true;
      });
    });
  }

  function initializeSingleSubmitGuard() {
    document.addEventListener('submit', function (event) {
      const form = event.target;

      if (!form || form.getAttribute('data-submit-once') !== 'true' || event.defaultPrevented) {
        return;
      }

      if (form.dataset.isSubmitting === 'true') {
        event.preventDefault();
        return;
      }

      form.dataset.isSubmitting = 'true';
      form.setAttribute('aria-busy', 'true');

      const submitButtons = Array.from(
        form.querySelectorAll('button[type="submit"], input[type="submit"]')
      );
      const submitter =
        event.submitter && submitButtons.includes(event.submitter) ? event.submitter : null;

      if (submitter && !submitter.disabled) {
        window.MiLabSubmitLock.preserveSubmitter(form, submitter);
      }
      submitButtons.forEach(function (button) {
        button.disabled = true;
      });

      if (submitter && submitter.tagName === 'BUTTON') {
        const loadingLabel = submitter.getAttribute('data-submit-loading-label') || 'Procesando...';
        submitter.dataset.originalLabel = submitter.innerHTML;
        submitter.innerHTML = loadingLabel;
      }

      if (submitter && submitter.tagName === 'INPUT') {
        const loadingLabel = submitter.getAttribute('data-submit-loading-label') || 'Procesando...';
        submitter.dataset.originalLabel = submitter.value;
        submitter.value = loadingLabel;
      }
    });
  }

  $(document).ready(function () {
    $(GRID_SELECTOR).each(initializeDataGrid);
    initializeStickyActionColumns();
    $('.ocultar-columna').hide();
    initializeLaboratorioCellToggle();
    initializeEmailEditor();
    initializeFirstVisitGuide();
    initializeOatiLoadingIndicator();
    initializeSingleSubmitGuard();
  });

  document.addEventListener('milab:initialize-data-grids', function (event) {
    const root = event.detail?.root || document;
    const tables = root.matches?.(GRID_SELECTOR)
      ? [root]
      : Array.from(root.querySelectorAll(GRID_SELECTOR));

    tables.forEach(initializeDataGrid);
    initializeStickyActionColumns();
  });

  document.addEventListener('shown.bs.tab', adjustTablesInTab);
  window.addEventListener('pageshow', function (event) {
    if (!event.persisted) return;

    const shouldRefreshSanctionActions = document.querySelector(
      '[data-sanction-person-actions-page="true"]'
    );
    const shouldRefreshDataGrid = document.querySelector(
      'table[data-grid-refresh-on-restore="true"]'
    );

    if (shouldRefreshSanctionActions || shouldRefreshDataGrid) window.location.reload();
  });
})(window, document);
