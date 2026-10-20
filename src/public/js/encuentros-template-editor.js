/* global window, document */

(function () {
  const pdfJsBase = '/milab/public/vendor/pdfjs';
  const fieldSelect = document.getElementById('template-field-select');
  const editor = document.getElementById('template-editor');
  const canvas = document.getElementById('template-preview-canvas');
  const overlayCanvas = document.getElementById('template-preview-overlay');
  const canvasWrap = document.getElementById('template-preview-canvas-wrap');
  const surface = document.getElementById('template-preview-surface');
  const pageLabel = document.getElementById('template-page-label');
  const previousPage = document.getElementById('template-page-prev');
  const nextPage = document.getElementById('template-page-next');
  const status = document.getElementById('template-editor-status');
  const configInput = document.getElementById('template-config');
  const placementList = document.getElementById('template-placement-list');
  const textOptions = document.getElementById('template-text-options');
  const qrOptions = document.getElementById('template-qr-options');
  const fontSizeInput = document.getElementById('template-field-font-size');
  const alignmentInput = document.getElementById('template-field-align');
  const colorInput = document.getElementById('template-field-color');
  const qrWidthInput = document.getElementById('template-qr-width');
  const removeFieldButton = document.getElementById('template-remove-field');
  const fileInput = document.getElementById('event-template');
  const fieldOptions = Array.from(fieldSelect.options).filter((option) => option.value);
  const labels = new Map(fieldOptions.map((option) => [option.value, option.textContent]));
  const fieldOrder = new Map(fieldOptions.map((option, index) => [option.value, index]));
  const previewValues = {
    nombre: 'Nombre del participante',
    documento: '00000000',
    correo: 'participante@example.edu',
    facultad: 'Facultad',
    laboratorio: 'Laboratorio',
    evento: 'Nombre del evento',
    fecha_evento: '20/10/2026',
    lugar: 'Lugar del evento',
    organizador: 'Organizador',
    rol: 'Cargo del participante',
    fecha_emision: '20 de octubre de 2026',
    codigo_certificado: 'CERTIFICADO-0001',
  };
  const state = {
    document: null,
    pageNumber: 1,
    config: {},
    renderTask: null,
    renderId: 0,
    loadId: 0,
    viewport: null,
    pdfJs: null,
    draggingKey: null,
    pointerStart: null,
    pointerMoved: false,
    pointerWasPlaced: false,
  };

  function setStatus(message, variant = 'muted') {
    status.textContent = message;
    status.className = `small mt-2 text-${variant}`;
  }

  function parseConfig(value) {
    const config = typeof value === 'string' ? JSON.parse(value) : value;
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('La configuración guardada de la plantilla no tiene un formato válido.');
    }
    return JSON.parse(JSON.stringify(config));
  }

  function syncConfig() {
    configInput.value = JSON.stringify(state.config);
    renderPlacements();
    updateFieldControls();
  }

  function renderPlacements() {
    placementList.replaceChildren();
    const entries = Object.entries(state.config).sort(
      ([first], [second]) =>
        (fieldOrder.get(first) ?? Number.MAX_SAFE_INTEGER) -
        (fieldOrder.get(second) ?? Number.MAX_SAFE_INTEGER)
    );

    if (!entries.length) {
      const empty = document.createElement('li');
      empty.className = 'list-group-item small text-muted px-0';
      empty.textContent = 'Aún no has ubicado campos.';
      placementList.appendChild(empty);
      return;
    }

    entries.forEach(([key, field]) => {
      const item = document.createElement('li');
      item.className = 'template-placement-item border-bottom';
      const selectButton = document.createElement('button');
      selectButton.type = 'button';
      selectButton.className = 'btn btn-sm btn-link p-0';
      selectButton.textContent = `${labels.get(key) || key} · página ${Number(field.page || 0) + 1}`;
      selectButton.setAttribute('aria-pressed', String(fieldSelect.value === key));
      selectButton.addEventListener('click', () => {
        fieldSelect.value = key;
        updateFieldControls();
        const fieldPage = Number(field.page || 0) + 1;
        if (state.document && fieldPage !== state.pageNumber) {
          state.pageNumber = fieldPage;
          renderCurrentPage().catch(showRenderError);
        } else {
          drawOverlays();
        }
      });

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'btn btn-sm btn-outline-danger';
      removeButton.textContent = 'Quitar';
      removeButton.disabled = key === 'qr_verificacion';
      removeButton.setAttribute('aria-label', `Quitar ${labels.get(key) || key} de la plantilla`);
      removeButton.addEventListener('click', () => {
        delete state.config[key];
        syncConfig();
        if (state.document) drawOverlays();
      });

      item.append(selectButton, removeButton);
      placementList.appendChild(item);
    });
  }

  function updateFieldControls() {
    const key = fieldSelect.value;
    const field = state.config[key];
    const isQr = key === 'qr_verificacion';
    textOptions.classList.toggle('d-none', isQr);
    qrOptions.classList.toggle('d-none', !isQr);
    removeFieldButton.disabled = !field || isQr;

    if (isQr) {
      qrWidthInput.value = field?.width ?? 70;
      return;
    }
    fontSizeInput.value = field?.fontSize ?? 18;
    alignmentInput.value = field?.align ?? 'center';
    colorInput.value = field?.color || '#000000';
  }

  function showRenderError(error) {
    console.error('[encuentros-template-editor:render]', error);
    setStatus('No fue posible mostrar esta página del PDF.', 'danger');
  }

  function updatePageControls() {
    const pageCount = state.document?.numPages || 0;
    pageLabel.textContent = pageCount
      ? `Página ${state.pageNumber} de ${pageCount}`
      : 'Página 0 de 0';
    previousPage.disabled = !pageCount || state.pageNumber <= 1;
    nextPage.disabled = !pageCount || state.pageNumber >= pageCount;
  }

  async function getPdfJs() {
    if (!state.pdfJs) {
      state.pdfJs = import(`${pdfJsBase}/pdf.mjs`).then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = `${pdfJsBase}/pdf.worker.mjs`;
        return pdfjs;
      });
    }
    return state.pdfJs;
  }

  async function renderCurrentPage() {
    if (!state.document) return;
    const renderId = ++state.renderId;
    if (state.renderTask) {
      const previousTask = state.renderTask;
      state.renderTask = null;
      previousTask.cancel();
      try {
        await previousTask.promise;
      } catch (error) {
        if (error.name !== 'RenderingCancelledException') throw error;
      }
    }
    if (renderId !== state.renderId) return;

    const page = await state.document.getPage(state.pageNumber);
    if (renderId !== state.renderId) return;
    const baseViewport = page.getViewport({ scale: 1 });
    const surfaceStyle = window.getComputedStyle(surface);
    const horizontalPadding =
      Number.parseFloat(surfaceStyle.paddingLeft) + Number.parseFloat(surfaceStyle.paddingRight);
    const availableWidth = Math.max(200, surface.clientWidth - horizontalPadding);
    const scale = Math.min(1.35, availableWidth / baseViewport.width);
    const viewport = page.getViewport({ scale });
    const pixelRatio = window.devicePixelRatio || 1;
    const context = canvas.getContext('2d');
    canvas.width = Math.ceil(viewport.width * pixelRatio);
    canvas.height = Math.ceil(viewport.height * pixelRatio);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    overlayCanvas.width = canvas.width;
    overlayCanvas.height = canvas.height;
    overlayCanvas.style.width = `${viewport.width}px`;
    overlayCanvas.style.height = `${viewport.height}px`;
    canvasWrap.style.width = `${viewport.width}px`;
    canvasWrap.style.height = `${viewport.height}px`;
    state.viewport = viewport;

    const task = page.render({
      canvasContext: context,
      viewport,
      transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0],
    });
    state.renderTask = task;
    try {
      await task.promise;
    } catch (error) {
      if (error.name === 'RenderingCancelledException') return;
      throw error;
    } finally {
      if (state.renderTask === task) state.renderTask = null;
    }
    if (renderId !== state.renderId) return;
    drawOverlays();
    updatePageControls();
  }

  function getFieldBounds(key, field, context) {
    if (!state.viewport || Number(field.page || 0) !== state.pageNumber - 1) return null;
    const x = Number(field.x);
    const y = Number(field.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    const [pointX, pointY] = state.viewport.convertToViewportPoint(x, y);
    if (key === 'qr_verificacion') {
      const width = Number(field.width);
      if (!Number.isFinite(width)) return null;
      const [otherX, otherY] = state.viewport.convertToViewportPoint(x + width, y + width);
      return {
        left: Math.min(pointX, otherX) - 4,
        top: Math.min(pointY, otherY) - 4,
        right: Math.max(pointX, otherX) + 4,
        bottom: Math.max(pointY, otherY) + 4,
        pointX,
        pointY,
      };
    }

    const fontSize = Number(field.fontSize || 18);
    const sample = previewValues[key] || labels.get(key) || key;
    context.font = `${Math.max(8, fontSize * state.viewport.scale)}px sans-serif`;
    context.textAlign = field.align || 'center';
    const textWidth = context.measureText(sample).width;
    const left =
      context.textAlign === 'center'
        ? pointX - textWidth / 2
        : context.textAlign === 'right'
          ? pointX - textWidth
          : pointX;
    return {
      left: left - 6,
      top: pointY - fontSize * state.viewport.scale - 5,
      right: left + textWidth + 6,
      bottom: pointY + 5,
      pointX,
      pointY,
      fontSize,
      sample,
    };
  }

  function drawOverlays() {
    const context = overlayCanvas.getContext('2d');
    const pixelRatio = window.devicePixelRatio || 1;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    if (!state.document || !state.viewport) {
      context.restore();
      return;
    }
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    Object.entries(state.config).forEach(([key, field]) => {
      const bounds = getFieldBounds(key, field, context);
      if (!bounds) return;
      const selected = fieldSelect.value === key;
      const width = bounds.right - bounds.left;
      const height = bounds.bottom - bounds.top;

      if (key === 'qr_verificacion') {
        context.fillStyle = 'rgb(255 255 255 / 92%)';
        context.fillRect(bounds.left, bounds.top, width, height);
        context.strokeStyle = selected ? '#0d6efd' : 'rgb(13 110 253 / 72%)';
        context.lineWidth = selected ? 2 : 1;
        context.setLineDash(selected ? [] : [5, 3]);
        context.strokeRect(bounds.left, bounds.top, width, height);
        context.setLineDash([]);
        context.fillStyle = '#0d6efd';
        context.font = 'bold 12px sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText('QR', bounds.left + width / 2, bounds.top + height / 2);
        return;
      }

      context.font = `${Math.max(8, bounds.fontSize * state.viewport.scale)}px sans-serif`;
      context.textAlign = field.align || 'center';
      context.textBaseline = 'alphabetic';
      context.fillStyle = 'rgb(255 255 255 / 92%)';
      context.fillRect(bounds.left, bounds.top, width, height);
      context.strokeStyle = selected ? '#0d6efd' : 'rgb(13 110 253 / 72%)';
      context.lineWidth = selected ? 2 : 1;
      context.setLineDash(selected ? [] : [5, 3]);
      context.strokeRect(bounds.left, bounds.top, width, height);
      context.setLineDash([]);
      context.fillStyle = field.color || '#000000';
      context.fillText(bounds.sample, bounds.pointX, bounds.pointY);
      if (selected) {
        context.beginPath();
        context.arc(bounds.pointX, bounds.pointY, 3, 0, Math.PI * 2);
        context.fillStyle = '#0d6efd';
        context.fill();
      }
    });
    context.restore();
  }

  async function loadPdfData(data, loadId) {
    setStatus('Cargando y preparando la plantilla…');
    try {
      const pdfjs = await getPdfJs();
      const loadingTask = pdfjs.getDocument({ data });
      const document = await loadingTask.promise;
      if (loadId !== state.loadId) {
        await document.destroy();
        return;
      }
      const previousDocument = state.document;
      state.document = document;
      state.pageNumber = 1;
      state.viewport = null;
      editor.classList.remove('d-none');
      updatePageControls();
      await renderCurrentPage();
      setStatus(
        Object.hasOwn(state.config, 'qr_verificacion')
          ? 'Haz clic en un espacio libre para colocar un campo o arrastra una caja para moverla.'
          : 'Selecciona el código QR y haz clic para colocarlo; luego puedes arrastrar su caja.'
      );
      if (previousDocument) {
        previousDocument.destroy().catch((error) => {
          console.error('[encuentros-template-editor:destroy-previous]', error);
        });
      }
    } catch (error) {
      if (loadId !== state.loadId) return;
      console.error('[encuentros-template-editor:load]', error);
      setStatus('No se pudo leer el PDF. Verifica que sea válido y no esté protegido.', 'danger');
      throw error;
    }
  }

  async function loadFile(file) {
    if (!file) return;
    const loadId = ++state.loadId;
    if (file.size > 8 * 1024 * 1024) {
      setStatus('El PDF no puede superar 8 MB.', 'danger');
      return;
    }
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      if (loadId !== state.loadId) return;
      await loadPdfData(data, loadId);
    } catch (error) {
      if (loadId !== state.loadId) return;
      console.error('[encuentros-template-editor:file]', error);
      window.MiLabDialogs.alert('No fue posible abrir la plantilla PDF seleccionada.');
    }
  }

  async function loadUrl(url) {
    const loadId = ++state.loadId;
    let response;
    try {
      response = await fetch(url, { credentials: 'same-origin' });
    } catch (error) {
      if (loadId !== state.loadId) return;
      throw error;
    }
    if (loadId !== state.loadId) return;
    if (!response.ok) throw new Error('No fue posible obtener la plantilla PDF guardada.');
    const data = new Uint8Array(await response.arrayBuffer());
    if (loadId !== state.loadId) return;
    await loadPdfData(data, loadId);
  }

  function setConfig(config) {
    try {
      state.config = parseConfig(config || {});
    } catch (error) {
      state.config = {};
      setStatus(error.message, 'danger');
    }
    const firstConfiguredField = Object.keys(state.config).find((key) => labels.has(key));
    fieldSelect.value = firstConfiguredField || 'nombre';
    syncConfig();
    if (state.document) drawOverlays();
  }

  function getConfigJson() {
    syncConfig();
    return configInput.value;
  }

  function hasQrPlacement() {
    return Boolean(state.config.qr_verificacion);
  }

  function reset() {
    state.loadId += 1;
    state.renderId += 1;
    if (state.renderTask) {
      state.renderTask.cancel();
      state.renderTask = null;
    }
    if (state.document) {
      state.document.destroy().catch((error) => {
        console.error('[encuentros-template-editor:destroy]', error);
      });
    }
    state.draggingKey = null;
    state.pointerStart = null;
    state.pointerMoved = false;
    state.document = null;
    state.pageNumber = 1;
    state.config = {};
    state.viewport = null;
    fileInput.value = '';
    canvas.width = 0;
    canvas.height = 0;
    canvas.style.width = '';
    canvas.style.height = '';
    overlayCanvas.width = 0;
    overlayCanvas.height = 0;
    overlayCanvas.style.width = '';
    overlayCanvas.style.height = '';
    canvasWrap.style.width = '';
    canvasWrap.style.height = '';
    editor.classList.add('d-none');
    configInput.value = '';
    setStatus('Carga una plantilla PDF para comenzar.');
    updatePageControls();
    syncConfig();
  }

  function placeSelectedField(key, x, y) {
    if (!state.document || !state.viewport || !key) return false;
    if (key === 'qr_verificacion') {
      const width = Number(qrWidthInput.value);
      if (!Number.isFinite(width) || width < 24 || width > 500) {
        setStatus('El tamaño del QR debe estar entre 24 y 500 puntos.', 'danger');
        return false;
      }
      state.config[key] = {
        x: Number(x.toFixed(2)),
        y: Number(y.toFixed(2)),
        page: state.pageNumber - 1,
        width,
        type: 'qr',
      };
    } else {
      const fontSize = Number(fontSizeInput.value);
      if (!Number.isFinite(fontSize) || fontSize < 6 || fontSize > 96) {
        setStatus('El tamaño de texto debe estar entre 6 y 96 puntos.', 'danger');
        return false;
      }
      state.config[key] = {
        x: Number(x.toFixed(2)),
        y: Number(y.toFixed(2)),
        page: state.pageNumber - 1,
        fontSize,
        align: alignmentInput.value,
        color: colorInput.value,
        type: 'text',
      };
    }
    syncConfig();
    drawOverlays();
    setStatus(
      `${labels.get(key)} ubicado en la página ${state.pageNumber}. Arrastra su caja para moverlo.`,
      'success'
    );
    return true;
  }

  function pointerPosition(event) {
    const rect = overlayCanvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    const [pdfX, pdfY] = state.viewport.convertToPdfPoint(x, y);
    return { x, y, pdfX, pdfY };
  }

  function findFieldAtPosition(x, y) {
    const context = overlayCanvas.getContext('2d');
    const fields = Object.entries(state.config).reverse();
    for (const [key, field] of fields) {
      const bounds = getFieldBounds(key, field, context);
      if (
        bounds &&
        x >= bounds.left &&
        x <= bounds.right &&
        y >= bounds.top &&
        y <= bounds.bottom
      ) {
        return key;
      }
    }
    return null;
  }

  function beginFieldDrag(event) {
    if (event.button !== 0 || !state.document || !state.viewport) return;
    event.preventDefault();
    const position = pointerPosition(event);
    let key = findFieldAtPosition(position.x, position.y);
    const placedOnPointerDown = !key;
    if (key) {
      fieldSelect.value = key;
      updateFieldControls();
      drawOverlays();
    } else {
      key = fieldSelect.value;
      if (!placeSelectedField(key, position.pdfX, position.pdfY)) return;
    }
    state.draggingKey = key;
    state.pointerStart = { x: event.clientX, y: event.clientY };
    state.pointerMoved = false;
    state.pointerWasPlaced = placedOnPointerDown;
    overlayCanvas.setPointerCapture(event.pointerId);
  }

  function moveFieldDrag(event) {
    if (!state.draggingKey || !state.pointerStart) return;
    if (
      !state.pointerMoved &&
      Math.hypot(event.clientX - state.pointerStart.x, event.clientY - state.pointerStart.y) < 2
    ) {
      return;
    }
    state.pointerMoved = true;
    const position = pointerPosition(event);
    const field = state.config[state.draggingKey];
    field.x = Number(position.pdfX.toFixed(2));
    field.y = Number(position.pdfY.toFixed(2));
    field.page = state.pageNumber - 1;
    drawOverlays();
  }

  function endFieldDrag(event) {
    const key = state.draggingKey;
    if (!key) return;
    if (overlayCanvas.hasPointerCapture(event.pointerId)) {
      overlayCanvas.releasePointerCapture(event.pointerId);
    }
    const moved = state.pointerMoved;
    const placed = state.pointerWasPlaced;
    state.draggingKey = null;
    state.pointerStart = null;
    state.pointerMoved = false;
    state.pointerWasPlaced = false;
    syncConfig();
    if (moved) {
      setStatus(`${labels.get(key)} movido en la página ${state.pageNumber}.`, 'success');
    } else if (!placed) {
      setStatus(`${labels.get(key)} seleccionado. Arrastra su caja para moverlo.`, 'info');
    }
  }

  function updateSelectedFieldStyle() {
    const key = fieldSelect.value;
    const field = state.config[key];
    if (!field) return;
    if (key === 'qr_verificacion') {
      const width = Number(qrWidthInput.value);
      if (!Number.isFinite(width) || width < 24 || width > 500) {
        updateFieldControls();
        setStatus('El tamaño del QR debe estar entre 24 y 500 puntos.', 'danger');
        return;
      }
      field.width = width;
    } else {
      const fontSize = Number(fontSizeInput.value);
      if (!Number.isFinite(fontSize) || fontSize < 6 || fontSize > 96) {
        updateFieldControls();
        setStatus('El tamaño de texto debe estar entre 6 y 96 puntos.', 'danger');
        return;
      }
      field.fontSize = fontSize;
      field.align = alignmentInput.value;
      field.color = colorInput.value;
    }
    syncConfig();
    drawOverlays();
  }

  fieldSelect.addEventListener('change', () => {
    updateFieldControls();
    drawOverlays();
  });
  [fontSizeInput, alignmentInput, colorInput, qrWidthInput].forEach((input) => {
    input.addEventListener('change', updateSelectedFieldStyle);
  });
  removeFieldButton.addEventListener('click', () => {
    const key = fieldSelect.value;
    if (!key || key === 'qr_verificacion' || !state.config[key]) return;
    delete state.config[key];
    syncConfig();
    drawOverlays();
  });
  overlayCanvas.addEventListener('pointerdown', beginFieldDrag);
  overlayCanvas.addEventListener('pointermove', moveFieldDrag);
  overlayCanvas.addEventListener('pointerup', endFieldDrag);
  overlayCanvas.addEventListener('pointercancel', endFieldDrag);
  fileInput.addEventListener('change', () => loadFile(fileInput.files[0]));
  previousPage.addEventListener('click', () => {
    if (!state.document || state.pageNumber <= 1) return;
    state.pageNumber -= 1;
    renderCurrentPage().catch(showRenderError);
  });
  nextPage.addEventListener('click', () => {
    if (!state.document || state.pageNumber >= state.document.numPages) return;
    state.pageNumber += 1;
    renderCurrentPage().catch(showRenderError);
  });
  window.addEventListener('resize', () => {
    if (state.document) renderCurrentPage().catch(showRenderError);
  });

  updateFieldControls();
  updatePageControls();
  window.EncounterTemplateEditor = { getConfigJson, hasQrPlacement, loadUrl, reset, setConfig };
})();
