const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');

const workspaceRoot = path.resolve(__dirname, '../../../');

function renderView(relativePath, data, options = {}) {
  const filePath = path.join(workspaceRoot, relativePath);
  return ejs.renderFile(filePath, data, {
    async: true,
    views: [path.join(workspaceRoot, 'src/views')],
    ...options,
  });
}

function buildBaseViewLocals(overrides = {}) {
  return {
    csrfToken: 'csrf-token',
    cspNonce: 'test-nonce',
    appVersion: 'test',
    appNavigation: {
      primaryLinks: [],
      secondaryGroups: [],
      accountLinks: [],
      role: 'admin',
      roleLabel: 'Admin',
    },
    isAuthenticated: true,
    tipo: 'admin',
    nombre: 'Usuario Prueba',
    documento: '100',
    pendingSanctionsCount: 0,
    pendingInventoryApprovalsCount: 0,
    environmentName: 'test',
    isNonProductionEnvironment: true,
    ...overrides,
  };
}

test('inventory approval navigation shows a pending-count badge only when needed', async () => {
  const appNavigation = {
    primaryLinks: [],
    secondaryGroups: [
      {
        title: 'Inventarios',
        icon: 'bi-boxes',
        items: [
          {
            label: 'Aprobaciones de inventario',
            href: '/milab/inventarios/aprobaciones',
            icon: 'bi-clipboard-check',
          },
        ],
      },
    ],
    accountLinks: [],
    role: 'coordinador',
    roleLabel: 'Coordinador',
  };
  const pageData = {
    batches: [],
    inventoryLabels: {},
    errorMessage: '',
    successMessage: '',
  };
  const pendingHtml = await renderView(
    'src/views/home/inventarios/aprobaciones/index.ejs',
    buildBaseViewLocals({
      ...pageData,
      appNavigation,
      pendingInventoryApprovalsCount: 4,
      tipo: 'coordinador',
    }),
    { async: false }
  );
  const emptyHtml = await renderView(
    'src/views/home/inventarios/aprobaciones/index.ejs',
    buildBaseViewLocals({ ...pageData, appNavigation, tipo: 'coordinador' }),
    { async: false }
  );

  assert.match(pendingHtml, /aria-label="4 aprobaciones de inventario pendientes">4<\/span>/);
  assert.doesNotMatch(emptyHtml, /aprobaciones de inventario pendientes/);
});

test('inventory dashboard renders as content for the shared dashboard tab', async () => {
  const html = await renderView('src/views/home/dashboard/inventarios.ejs', {
    metrics: {
      aprobados: 12,
      descripciones: 8,
      laboratorios: 2,
      disponiblesPrestamo: 4,
      prestados: 1,
      enMantenimiento: 1,
      fueraServicio: 0,
      activos: 10,
      inactivos: 2,
    },
    loadMetrics: { pendientes_aprobacion: 3, devueltas_correccion: 1 },
    typeRows: [],
    laboratoryRows: [],
    inventoryLabels: {},
  });

  assert.match(html, /Registros aprobados/);
  assert.match(html, /Aprobaciones pendientes/);
  assert.match(html, /Detalle por laboratorio y tipo/);
  assert.doesNotMatch(html, /<main|<header|<footer|Volver al monitoreo/);
});

test('register_monitor view renders with minimal monitor registration context', async () => {
  const html = await renderView(
    'src/views/home/register_monitor.ejs',
    buildBaseViewLocals({
      error: null,
      coordinadores: [],
      selectedCoordinatorDocument: '',
      lookupDocumento: '',
      lookupMessage: null,
      lookupStatus: null,
      lookupData: null,
      successMessage: null,
      facultades: [],
      uals: [],
      formValues: { ual_ids: [] },
    })
  );

  assert.match(html, /Registro de monitor/i);
  assert.match(html, /Correo electrónico institucional/i);
});

test('monitores_registrados view renders empty-state and populated tables', async () => {
  const emptyHtml = await renderView(
    'src/views/home/monitores_registrados.ejs',
    buildBaseViewLocals({ monitores: [], successMessage: null })
  );
  const populatedHtml = await renderView(
    'src/views/home/monitores_registrados.ejs',
    buildBaseViewLocals({
      monitores: [
        {
          nombre: 'Monitor Demo',
          documento: '12345',
          correo: 'monitor@udistrital.edu.co',
          codigo: '20241001',
          numero_contrato: 'CPS-01',
          tipo_vinculacion: 'Monitoria',
          fecha_inicio: '2026-01-01',
          fecha_fin: '2026-12-31',
          facultades: 'Facultad 10',
          uales: 'Lab 11',
        },
      ],
      successMessage: 'ok',
    })
  );

  assert.match(emptyHtml, /No hay monitores registrados/i);
  assert.match(populatedHtml, /Monitor Demo/i);
  assert.match(populatedHtml, /Facultades/i);
});

test('prestamos practicas configuracion view renders with minimal configuration context', async () => {
  const html = await renderView(
    'src/views/home/prestamos/practicas/configuracion.ejs',
    buildBaseViewLocals({
      selectedFacultyName: 'Facultad 10',
      selectedLaboratoryName: 'Lab 11',
      selectedFacultyId: 10,
      selectedUalId: 11,
      successMessage: null,
      errorMessage: null,
      academicPractices: [],
      dynamicPracticeSchema: { campos_adicionales: [] },
      facultades: [{ facultad_id: 10, nombre: 'Facultad 10' }],
      laboratorios: [{ ual_id: 11, nombre: 'Lab 11' }],
      config: {},
    })
  );

  assert.match(html, /Configuracion De Practicas/i);
  assert.match(html, /Esquema Dinamico Del Laboratorio/i);
});

test('capacitacion management view renders scoped report filters and JSON export wiring', async () => {
  const html = await renderView(
    'src/views/home/capacitacion-gestion.ejs',
    buildBaseViewLocals({
      tipo: 'laboratorista',
      navigation: { role: 'laboratorista' },
      sessionRoleLabel: 'Laboratorista',
    })
  );

  assert.match(html, /id="report-codigo-curso"/);
  assert.match(html, /id="report-ual"/);
  assert.match(html, /id="report-facultad"/);
  assert.match(html, /id="btn-exportar-json"/);
  assert.match(html, /reporteJson:\s*BASE_PATH \+ '\/gestion\/reporte\.json'/);
  assert.match(html, /qs\.push\('codigo_curso='/);
  assert.match(html, /qs\.push\('ual_id='/);
  assert.match(html, /qs\.push\('facultad_id='/);
  assert.match(
    html,
    /getElementById\('btn-exportar-json'\)\?\.addEventListener\('click', onExportarJson\)/
  );
});

test('profile view renders the active program selector during registration', async () => {
  const html = await renderView(
    'src/views/home/profile.ejs',
    buildBaseViewLocals({
      modo: 'crear',
      nombre: 'Estudiante Prueba',
      correo: 'est@udistrital.edu.co',
      documento: '1001219870',
      codigo: '',
      estado: '',
      carrera: '',
      tipo_usuario: 'estudiante',
      readonly: false,
      profileLocked: true,
      error: null,
      success: null,
      opcionesCodigo: [
        { codigo: '20242583011', carrera: 'INGENIERIA', estado: 'ACTIVO' },
        { codigo: '2023999', carrera: 'TECNOLOGIA', estado: 'ACTIVO' },
      ],
    })
  );

  assert.match(html, /<select class="form-select" id="codigo" name="codigo" required>/);
  assert.match(html, /20242583011 - INGENIERIA/);
  assert.match(html, /2023999 - TECNOLOGIA/);
});
