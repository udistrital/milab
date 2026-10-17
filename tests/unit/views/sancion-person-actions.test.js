const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');

const workspaceRoot = path.resolve(__dirname, '../../../');
const viewPath = path.join(workspaceRoot, 'src/views/home/sancion-person-actions.ejs');
const lookupToken = 'a'.repeat(64);

function renderPaso2(overrides = {}) {
  return ejs.renderFile(viewPath, {
    tipo: 'laboratorista',
    csrfToken: 'csrf-token',
    cspNonce: 'test-nonce',
    personType: 'estudiante',
    person: {
      codigo: '2024100001',
      documento: '79520182',
      nombre: 'Estudiante Prueba',
      carrera: 'Ingenieria',
      estado: 'ACTIVO',
      usuarioId: 1,
    },
    lookupToken,
    registrationUrl: '/milab/api/get-info-multa',
    removalUrl: '/milab/api/get-info-erase-multa',
    searchUrl: '/milab/api/get-info-multa/get',
    activeSanctionCount: 0,
    sanctionCategories: [],
    sanctionHistory: [],
    sanctionHistoryError: '',
    sga: { configured: false, debts: [], failed: false },
    successFeedback: null,
    ...overrides,
  });
}

function renderDocente() {
  return ejs.renderFile(viewPath, {
    tipo: 'laboratorista',
    csrfToken: 'csrf-token',
    cspNonce: 'test-nonce',
    personType: 'docente',
    person: {
      codigo: '',
      documento: '1020304050',
      nombre: 'Docente Prueba',
      carrera: '',
      estado: 'ACTIVO',
      usuarioId: 2,
    },
    lookupToken,
    registrationUrl: '/milab/api/get-info-multa-docente',
    removalUrl: '/milab/api/get-info-erase-multa-docente',
    searchUrl: '/milab/api/get-info-multa-docente/get',
    activeSanctionCount: 0,
  });
}

const sampleDebt = {
  DEU_MATERIAL: 'Reposición de insumos',
  DEU_MULTA: '50000',
  DEU_FECHA: '2024-06-04',
  DEU_ESTADO: 'PENDIENTE',
  DEU_ANO: '2024',
  DEU_PER: '1',
  DEU_FECHA_PAGO: '',
};

test('paso 2 student view shows Agregar and Retirar as lookup-token forms', async () => {
  const html = await renderPaso2();

  assert.match(html, /action="\/milab\/api\/get-info-multa"/);
  assert.match(html, /action="\/milab\/api\/get-info-erase-multa"/);
  assert.match(html, /Agregar sanción/);
  assert.match(html, /Retirar sanción/);
  assert.match(html, /name="lookup_token" value="a{64}"/);
  assert.match(
    html,
    /<a class="btn btn-outline-secondary" href="\/milab\/api\/get-info-multa\/get">Buscar otra persona<\/a>/
  );
});

test('paso 2 disables Retirar when the student has no active sanctions', async () => {
  const html = await renderPaso2({ activeSanctionCount: 0 });
  const retirar = html.match(/<button[^>]*>\s*<i class="bi bi-dash-circle"[\s\S]*?Retirar sanción/);

  assert.ok(retirar);
  assert.match(retirar[0], /disabled/);
});

test('paso 2 enables Retirar when the student has active sanctions', async () => {
  const html = await renderPaso2({ activeSanctionCount: 2 });
  const retirar = html.match(/<button[^>]*>\s*<i class="bi bi-dash-circle"[\s\S]*?Retirar sanción/);

  assert.ok(retirar);
  assert.doesNotMatch(retirar[0], /disabled/);
});

test('paso 2 shows the SGA counter and popup only when SGA has sanctions', async () => {
  const html = await renderPaso2({
    sga: { configured: true, debts: [sampleDebt], failed: false },
  });

  assert.match(html, /1 sanciones en SGA · Ver detalle/);
  assert.match(html, /data-bs-target="#sgaSancionesPersonaModal"/);
  assert.match(html, /id="sgaSancionesPersonaModal"/);
  assert.match(html, /Reposición de insumos/);
  assert.match(html, /50000/);
  assert.match(html, /PENDIENTE/);
});

test('paso 2 does not open an SGA popup when SGA has no sanctions', async () => {
  const html = await renderPaso2({ sga: { configured: true, debts: [], failed: false } });

  assert.match(html, /0 sanciones en SGA/);
  assert.doesNotMatch(html, /data-bs-target="#sgaSancionesPersonaModal"/);
  assert.doesNotMatch(html, /id="sgaSancionesPersonaModal"/);
});

test('paso 2 reports an SGA failure without breaking the panel', async () => {
  const html = await renderPaso2({ sga: { configured: true, debts: [], failed: true } });

  assert.match(html, /No fue posible consultar SGA/);
  assert.match(html, /Agregar sanción/);
  assert.doesNotMatch(html, /id="sgaSancionesPersonaModal"/);
});

test('paso 2 hides the SGA counter when SGA is not configured', async () => {
  const html = await renderPaso2();

  assert.doesNotMatch(html, /sanciones en SGA/);
});

test('paso 2 shows the history notice when the scope cannot load history', async () => {
  const html = await renderPaso2({
    sanctionHistoryError: 'El coordinador no tiene facultades asociadas.',
  });

  assert.match(
    html,
    /No fue posible mostrar el historial de sanciones: El coordinador no tiene facultades asociadas\./
  );
  assert.doesNotMatch(html, /no tiene sanciones registradas en MILab/);
});

test('paso 2 shows the empty history message when there are no sanctions', async () => {
  const html = await renderPaso2();

  assert.match(html, /no tiene sanciones registradas en MILab/);
  assert.doesNotMatch(html, /app-sanctions-report/);
});

test('paso 2 renders the history with the listado grid and detail modal', async () => {
  const html = await renderPaso2({
    activeSanctionCount: 1,
    sanctionHistory: [
      {
        id: 10,
        con_estado_multa: 'ACTIVA',
        cat_multa: 'Reposición de materiales',
        tipo_multa: 'Reposición',
        con_fecha: '2024-06-04',
        laboratorista_nombre: 'Laboratorista Prueba',
        laboratorio_nombre: 'LAB',
        facultad_nombre: 'FACULTAD',
        dependencia_nombre: 'DEPENDENCIA',
        observacion: 'Observación de prueba',
        actions: { canEdit: true, canApprove: false },
      },
    ],
  });

  assert.match(html, /app-sanctions-report/);
  assert.match(html, /js-data-grid/);
  assert.match(html, /id="detalleSancionModal"/);
  assert.match(html, /src="\/milab\/public\/js\/sanction-detail-modal\.js"/);
  assert.match(html, /name="source" value="get-info-multa-persona"/);
  assert.match(html, /name="lookup_token" value="a{64}"/);
});

test('paso 2 shows the success alert from a completed action', async () => {
  const html = await renderPaso2({ successFeedback: 'aplazada' });

  assert.match(html, /La sanción se aplazó correctamente\./);
});

test('docente view keeps the previous layout without student-only actions', async () => {
  const html = await renderDocente();

  assert.doesNotMatch(html, /Agregar sanción/);
  assert.match(html, /<h3 class="h5 mt-3">Retirar sanción<\/h3>/);
  assert.doesNotMatch(html, /app-sanctions-report/);
  assert.doesNotMatch(html, /id="sgaSancionesPersonaModal"/);
});
