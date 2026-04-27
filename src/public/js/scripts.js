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

  function resolveColumnDefs($table) {
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
    const $filterCells = $table.find('thead tr.data-grid-filters th');

    dataTable.columns().every(function (index) {
      const column = this;
      const $input = $filterCells.eq(index).find('input');

      if ($input.length === 0) {
        return;
      }

      $input.on('click', function (event) {
        event.stopPropagation();
      });

      $input.on('keyup change clear', function (event) {
        event.stopPropagation();

        if (column.search() !== this.value) {
          column.search(this.value).draw();
        }
      });
    });
  }

  function attachResetButton(dataTable, $table) {
    const tableId = $table.attr('id');
    const wrapperSelector = `#${tableId}_wrapper .dataTables_filter`;
    const $filterContainer = $(wrapperSelector);

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
      const $columnInputs = $table.find('thead tr.data-grid-filters input');

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

    const pageLength = Number($table.data('gridPageLength')) || 10;
    const dataTable = $table.DataTable({
      language,
      pageLength,
      lengthMenu: [10, 25, 50, 100],
      order: resolveInitialOrder($table),
      orderCellsTop: true,
      autoWidth: false,
      scrollX: resolveScrollX($table),
      searchDelay: 250,
      columnDefs: resolveColumnDefs($table),
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

    function expandNavigationForGuide() {
      const expandedState = {
        collapses: [],
        dropdowns: [],
      };

      document.querySelectorAll('.app-navbar .collapse').forEach(function (collapse) {
        expandedState.collapses.push({
          element: collapse,
          wasShown: collapse.classList.contains('show'),
        });

        if (!collapse.classList.contains('show')) {
          collapse.classList.add('show');
        }
      });

      document
        .querySelectorAll('.app-navbar .nav-item.dropdown, .app-user-tools .dropdown')
        .forEach(function (dropdown) {
          const toggle = dropdown.querySelector('[data-bs-toggle="dropdown"]');
          const menu = dropdown.querySelector('.dropdown-menu');

          if (!toggle || !menu) {
            return;
          }

          expandedState.dropdowns.push({
            toggle,
            menu,
            toggleWasShown: toggle.classList.contains('show'),
            menuWasShown: menu.classList.contains('show'),
            previousExpanded: toggle.getAttribute('aria-expanded'),
          });

          toggle.classList.add('show');
          toggle.setAttribute('aria-expanded', 'true');
          menu.classList.add('show');
        });

      return expandedState;
    }

    function restoreNavigationAfterGuide(expandedState) {
      if (!expandedState) {
        return;
      }

      expandedState.collapses.forEach(function (entry) {
        if (!entry.wasShown) {
          entry.element.classList.remove('show');
        }
      });

      expandedState.dropdowns.forEach(function (entry) {
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
      });
    }

    function buildSteps() {
      const candidateSteps = [
        createStep(
          ['[data-guide="main-navigation"]'],
          'Navegacion principal',
          'Desde aqui puedes acceder a los modulos principales y a las opciones disponibles segun tu perfil.',
          'bottom',
          'start'
        ),
        createStep(
          ['[data-guide="nav-solicitar-certificado"]'],
          'Solicitar certificado',
          'Este acceso permite iniciar la solicitud del paz y salvo o certificado disponible para estudiantes y docentes.',
          'bottom',
          'center'
        ),
        createStep(
          ['[data-guide="nav-autorizaciones"]'],
          'Autorizaciones',
          'Aqui se revisan y gestionan solicitudes pendientes que requieren validacion del coordinador.',
          'bottom',
          'center'
        ),
        createStep(
          ['[data-guide="nav-registro"]'],
          'Registro',
          'Este menu agrupa los formularios de creacion de cuentas y configuracion inicial de nuevos usuarios operativos.',
          'bottom',
          'center'
        ),
        createStep(
          ['[data-guide="nav-registro-coordinadores"]'],
          'Registro de coordinadores',
          'Permite crear coordinadores con su informacion institucional y el alcance correspondiente dentro del sistema.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-registro-laboratoristas"]'],
          'Registro de laboratoristas',
          'Sirve para crear cuentas de laboratoristas y asociarlas a las facultades o UAL autorizadas.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-consulta-control"]'],
          'Consulta y control',
          'Este menu concentra consultas operativas y herramientas de seguimiento para revisar registros, estados y sanciones.',
          'bottom',
          'center'
        ),
        createStep(
          ['[data-guide="nav-consulta-masiva"]'],
          'Consulta masiva',
          'Permite cargar varios codigos o documentos para revisar resultados en lote de forma mas rapida.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-estudiantes-docentes-registrados"]'],
          'Estudiantes y docentes registrados',
          'Muestra el listado consolidado de usuarios registrados para seguimiento y consulta administrativa.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-laboratoristas-registrados"]'],
          'Laboratoristas registrados',
          'Aqui puedes consultar el personal laboratorista activo y la informacion relacionada con su gestion.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-sanciones"]'],
          'Sanciones',
          'Este acceso permite consultar sanciones registradas y su estado actual dentro de la plataforma.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-paz-y-salvos"]'],
          'Paz y Salvos',
          'Agrupa las herramientas para verificar si estudiantes o docentes cumplen las condiciones para su certificacion.',
          'bottom',
          'center'
        ),
        createStep(
          ['[data-guide="nav-verificar-estudiante"]'],
          'Verificar estudiante',
          'Sirve para consultar el estado de un estudiante antes de emitir o validar su paz y salvo.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-verificar-docente"]'],
          'Verificar docente',
          'Permite revisar el estado de un docente y validar si puede obtener su certificado.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-administracion"]'],
          'Administracion',
          'Este menu reune acciones operativas para gestionar novedades y procesos internos de sanciones.',
          'bottom',
          'center'
        ),
        createStep(
          ['[data-guide="nav-sanciones-estudiantes"]'],
          'Sanciones de estudiantes',
          'Desde aqui se registran o administran sanciones asociadas a estudiantes segun el flujo del laboratorista.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="nav-sanciones-docentes"]'],
          'Sanciones de docentes',
          'Este acceso permite gestionar sanciones asociadas a docentes cuando el perfil tiene ese permiso.',
          'right',
          'start'
        ),
        createStep(
          ['[data-guide="account-menu"]', '[data-guide="account-menu-mobile"]'],
          'Cuenta del usuario',
          'Este bloque te permite consultar tu informacion, cambiar la contrasena, cambiar el tema y cerrar sesion.',
          'bottom',
          'end'
        ),
        createStep(
          ['[data-guide="help-manuals"]', '[data-guide="help-manuals-mobile"]'],
          'Centro de ayuda',
          'Desde este menu puedes volver a abrir el tour guiado o consultar la carpeta de manuales en PDF.',
          'bottom',
          'center'
        ),
        createStep(
          ['[data-guide="theme-toggle"]'],
          'Tema visual',
          'Aqui puedes alternar entre modo claro y oscuro segun tu preferencia de visualizacion.',
          'left',
          'center'
        ),
        createStep(
          ['[data-guide="logout-action"]'],
          'Cerrar sesion',
          'Utiliza esta opcion para salir de forma segura cuando termines de usar la plataforma.',
          'left',
          'center'
        ),
        createStep(
          ['.app-frame', '.dashboard-page', '.app-page-shell', '.container'],
          'Area de trabajo',
          'En esta zona se cargan formularios, tablas, reportes y demas contenidos del sistema.',
          'top',
          'center'
        ),
      ];

      return candidateSteps
        .map(function (step) {
          const element = resolveStepElement(step.selectors);

          if (!element) {
            return null;
          }

          return {
            element,
            popover: step.popover,
          };
        })
        .filter(Boolean);
    }

    function startGuide(options) {
      const settings = options || {};
      const url = new window.URL(window.location.href);
      const forceGuide = Boolean(settings.force);
      const steps = buildSteps();
      let expandedNavigationState = null;

      if (!forceGuide && hasSeenGuide()) {
        return;
      }

      if (steps.length === 0) {
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
        steps,
        onHighlighted: function () {
          if (!expandedNavigationState) {
            expandedNavigationState = expandNavigationForGuide();
          }
        },
        onDestroyStarted: function () {
          markGuideAsSeen();
          driver.destroy();
        },
        onDestroyed: function () {
          restoreNavigationAfterGuide(expandedNavigationState);
          if (settings.cleanUrl) {
            url.searchParams.delete('tour');
            window.history.replaceState({}, document.title, url.toString());
          }
        },
      });

      markGuideAsSeen();
      window.setTimeout(function () {
        driver.drive();
      }, settings.delay || 350);
    }

    window.MiLabGuide = {
      start: startGuide,
    };

    document.addEventListener('click', function (event) {
      const trigger = event.target.closest('[data-guide-restart="true"]');

      if (!trigger) {
        return;
      }

      event.preventDefault();
      startGuide({ force: true, delay: 120 });
    });

    if (new window.URL(window.location.href).searchParams.get('tour') === '1') {
      startGuide({ force: true, cleanUrl: true });
      return;
    }

    startGuide();
  }

  $(document).ready(function () {
    $(GRID_SELECTOR).each(initializeDataGrid);
    $('.ocultar-columna').hide();
    initializeEmailEditor();
    initializeFirstVisitGuide();
  });

  document.addEventListener('shown.bs.tab', adjustTablesInTab);
})(window, document);
