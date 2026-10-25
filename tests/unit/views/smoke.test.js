const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');
const { CAMPOS_POR_SECCION } = require('../../../src/libs/hojas-vida-campos');
const { TIPOS_EVENTO_MANUALES } = require('../../../src/libs/hojas-vida-eventos');
const {
  TIPOS_MANTENIMIENTO,
  ESTADOS_MANTENIMIENTO,
} = require('../../../src/libs/hojas-vida-mantenimientos');

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

test('nested navigation selects one accordion and renders its module breadcrumbs', async () => {
  const route = '/milab/api/get_list_estudiantes/get_consulta';
  const appNavigation = {
    primaryLinks: [{ label: 'Inicio', href: '/milab/inicio', icon: 'bi-house-door' }],
    secondaryGroups: [
      {
        title: 'Consulta y control',
        icon: 'bi-grid',
        items: [
          {
            label: 'Certificado de consulta y control',
            href: '/milab/api/get_list_estudiantes',
            icon: 'bi-file-earmark-check',
          },
        ],
      },
      {
        title: 'Paz y Salvos',
        icon: 'bi-patch-check',
        items: [
          {
            label: 'Generar Paz y Salvos Masivo',
            href: route,
            icon: 'bi-collection',
          },
        ],
      },
    ],
    accountLinks: [],
    role: 'admin',
    roleLabel: 'Admin',
  };
  const html = await renderView(
    'src/views/home/consulta_masiva.ejs',
    buildBaseViewLocals({
      appNavigation,
      navigationCurrentPath: route,
      sampleData1: 0,
      error: null,
      sgaConsultaOmitida: false,
    }),
    { async: false }
  );
  const accordionToggles = Array.from(
    html.matchAll(/<button\b[^>]*class="accordion-button app-sidebar-group-toggle[^"]*"[^>]*>/g),
    ([tag]) => tag
  );
  const expandedToggles = accordionToggles.filter((tag) => /aria-expanded="true"/.test(tag));
  const submenuLinks = Array.from(
    html.matchAll(/<a\b[^>]*class="app-sidebar-link app-sidebar-sub-link[^"]*"[^>]*>/g),
    ([tag]) => tag
  );
  const activeSubmenuLinks = submenuLinks.filter((tag) => /\bis-active\b/.test(tag));
  const breadcrumb = html.match(/<nav class="app-breadcrumb-nav"[\s\S]*?<\/nav>/)?.[0] || '';

  assert.equal(expandedToggles.length, 1);
  assert.match(expandedToggles[0], /data-bs-target="#appSidebarGroup1"/);
  assert.equal(activeSubmenuLinks.length, 1);
  assert.match(activeSubmenuLinks[0], /href="\/milab\/api\/get_list_estudiantes\/get_consulta"/);
  assert.match(breadcrumb, /Inicio[\s\S]*?Paz y Salvos[\s\S]*?Generar Paz y Salvos Masivo/);
  assert.match(html, /class="app-page-header app-page-header--inline"/);
  assert.match(html, /class="app-page-title-icon"/);
});

test('landing login uses the branded background and direct institutional access', async () => {
  const html = await renderView(
    'src/views/home/index_2.ejs',
    buildBaseViewLocals({
      recaptchaSiteKey: 'test-site-key',
      recaptchaError: null,
    }),
    { async: false }
  );

  assert.match(html, /url\('\/milab\/public\/img\/background_milab\.png'\)/);
  assert.match(html, /src="\/milab\/public\/img\/Logo_Escudo_Acreditacion_Horizontal\.png"/);
  assert.match(html, /Coordinación General de/);
  assert.match(html, /href="\/milab\/auth\/microsoft"/);
  assert.doesNotMatch(html, /href="\/milab\/auth\/login"/);
  assert.match(html, /data-sitekey="test-site-key"/);
  assert.match(html, /Bienvenido a MiLab/);
  assert.match(html, /Consulta de invitado/);
});

test('sanction list action forms carry filter state without accepting arbitrary return urls', async () => {
  const html = await renderView(
    'src/views/partials/sanction-detail-modal.ejs',
    buildBaseViewLocals({
      returnSource: 'listado',
      returnFilters: {
        fecha_desde: '2026-01-01',
        estado_multa: 'Pendiente',
        facultad_id: '10',
        unexpected_filter: 'ignored',
      },
      SANCTION_TYPES: [],
      sanctionCategories: [],
    }),
    { async: false }
  );

  assert.match(html, /name="fecha_desde" value="2026-01-01"/);
  assert.match(html, /name="estado_multa" value="Pendiente"/);
  assert.match(html, /name="facultad_id" value="10"/);
  assert.doesNotMatch(html, /unexpected_filter/);
  assert.doesNotMatch(html, /return_url/);
});

test('sanction list passes active filters into its action modal', async () => {
  const html = await renderView(
    'src/views/home/get_list_multas.ejs',
    buildBaseViewLocals({
      sampleData: [],
      SANCTION_TYPES: [],
      sanctionCategories: [],
      sancionesEstudiantes: [],
      sancionesDocentes: [],
      filtros: {
        fecha_desde: '2026-01-01',
        estado_multa: 'Pendiente',
        facultad_id: '10',
      },
      filterAccess: { facultad: false, dependencia: false, ual: false },
      locationOptions: { facultades: [], dependencias: [], uals: [] },
      successFeedback: null,
      sgaConfigured: false,
    }),
    { async: false }
  );

  assert.match(html, /action="\/milab\/api\/aprobacion_multa\/activar"/);
  assert.match(html, /name="fecha_desde" value="2026-01-01"/);
  assert.match(html, /name="estado_multa" value="Pendiente"/);
  assert.match(html, /name="facultad_id" value="10"/);
});

test('admin error detail is written to the browser console only when present', async () => {
  const html = await renderView(
    'src/views/home/message_error.ejs',
    buildBaseViewLocals({
      message: 'Error',
      message2: 'Intenta nuevamente.',
      limit: null,
      adminErrorDetail: 'Error: dashboard render failure',
    }),
    { async: false }
  );

  assert.match(html, /data-admin-error-detail/);
  assert.match(html, /console\.error\('\[MILab\] Error de aplicación:'/);
  assert.match(html, /test-nonce/);
});

test('Paz y Salvos verification pages use compact inline headers', async () => {
  const verificationViews = [
    'src/views/home/verificar_estudiante.ejs',
    'src/views/home/verificar_docente.ejs',
  ];

  for (const view of verificationViews) {
    const html = await renderView(view, buildBaseViewLocals(), { async: false });
    assert.match(html, /class="app-page-header app-page-header--inline"/);
    assert.match(html, /class="app-page-title">Verificar (?:estudiante|docente)<\/h1>/);
    assert.match(html, /class="app-page-subtitle">Consulta el estado/);
  }
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
    typeRows: [
      {
        tipo_inventario: 'equipo_arka',
        aprobados: 12,
        activos: 10,
        inactivos: 2,
        descripciones_agrupadas: 8,
        laboratorios_aprobados: 2,
      },
      {
        tipo_inventario: 'complementario',
        aprobados: 4,
        activos: 4,
        inactivos: 0,
        descripciones_agrupadas: 3,
        laboratorios_aprobados: 1,
      },
    ],
    laboratoryRows: [
      {
        ual_id: 1,
        laboratorio: 'Laboratorio Uno',
        facultad: 'Facultad A',
        tipo_inventario: 'equipo_arka',
        aprobados: 7,
        descripciones_agrupadas: 4,
        inactivos: 1,
        disponibles_prestamo: 3,
        prestados: 1,
        en_mantenimiento: 1,
        fuera_servicio: 0,
        lineas_existencia: 5,
      },
      {
        ual_id: 2,
        laboratorio: 'Laboratorio Dos',
        facultad: 'Facultad B',
        tipo_inventario: 'complementario',
        aprobados: 4,
        descripciones_agrupadas: 3,
        inactivos: 0,
        disponibles_prestamo: 0,
        prestados: 0,
        en_mantenimiento: 0,
        fuera_servicio: 0,
        lineas_existencia: 2,
      },
    ],
    inventoryLabels: {
      equipo_arka: 'Equipos ARKA',
      complementario: 'Inventario complementario',
      reactivo: 'Reactivos',
    },
    scopeDescription: 'Indicadores consolidados de inventario.',
  });

  assert.match(html, /Registros aprobados/);
  assert.match(html, /Aprobaciones pendientes/);
  assert.match(html, /Resumen por tipo de inventario/);
  assert.match(html, /Estado de los equipos/);
  assert.match(html, /Registros aprobados por laboratorio y tipo/);
  assert.match(html, /data-dashboard-inventory-chart="laboratory-equipment"/);
  assert.doesNotMatch(html, /<table\b|js-data-grid/);
  assert.doesNotMatch(html, /<main|<header|<footer|Volver al monitoreo/);
  const chartData = JSON.parse(
    html.match(
      /<script type="application\/json" data-dashboard-inventory-chart-data>([\s\S]*?)<\/script>/
    )[1]
  );
  assert.deepEqual(chartData.typeSummary.labels, ['Equipos ARKA', 'Inventario complementario']);
  assert.deepEqual(chartData.laboratoryInventory.labels, [
    'Laboratorio Uno · Facultad A',
    'Laboratorio Dos · Facultad B',
  ]);
  assert.deepEqual(chartData.laboratoryInventory.datasets[0].values, [7, 0]);
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

test('hojas-vida confirmar view renders the confirmation form with catalog fields', async () => {
  const html = await renderView(
    'src/views/home/prestamos/hojas-vida/confirmar.ejs',
    buildBaseViewLocals({
      hojaVida: {
        id: 42,
        estado: 'PENDIENTE_CONFIRMACION',
        nombre_equipo: 'Equipo Demo',
        marca: 'MarcaX',
        numero_serie: 'SN-0001',
        codigo_inventario: 'INV-0001',
      },
      equipo: {
        codigo: 'EQ-01',
        nombre: 'Equipo Demo',
        ubicacion: 'Lab 11',
        facultad: 'Facultad 10',
        laboratorio: 'Lab 11',
      },
      documentos: [{ tipo_documento: 'EXCEL_ORIGEN', nombre_archivo: 'sigud.xlsx' }],
      secciones: CAMPOS_POR_SECCION,
      obligatorios: ['marca', 'numero_serie', 'codigo_inventario'],
      maxFotoMB: 5,
      successMessage: null,
      errorMessage: null,
    })
  );

  assert.match(html, /Confirmar Hoja de Vida/i);
  assert.match(html, /id="hv-confirmar-form"/);
  assert.match(html, /name="foto"/);
  assert.match(html, /EXCEL_ORIGEN/);
  assert.match(html, /id="hv-campo-marca"[\s\S]*?required/);
  assert.match(html, /value="MarcaX"/);
  assert.match(html, /var hojaVidaId = 42;/);
  assert.match(html, /nonce="test-nonce"/);
});

test('hojas-vida historial view renders the event timeline and registration form', async () => {
  const html = await renderView(
    'src/views/home/prestamos/hojas-vida/historial.ejs',
    buildBaseViewLocals({
      hojaVida: { id: 42, equipo_id: 7, estado: 'ACTIVA' },
      equipo: {
        codigo: 'EQ-01',
        nombre: 'Equipo Demo',
        ubicacion: 'Lab 11',
        facultad: 'Facultad 10',
        laboratorio: 'Lab 11',
      },
      eventos: [
        {
          id: 1,
          tipo_evento: 'CONFIRMACION',
          tipo_evento_etiqueta: 'Confirmación de la hoja de vida',
          tipo_evento_clase: 'success',
          descripcion: 'Confirmación de la hoja de vida (creación oficial).',
          usuario: '100',
          fecha_display: '15/10/2026 08:00',
        },
      ],
      tiposEvento: TIPOS_EVENTO_MANUALES,
      successMessage: null,
      errorMessage: null,
    })
  );

  assert.match(html, /Historial del ciclo de vida/i);
  assert.match(html, /id="hv-evento-form"/);
  assert.match(html, /name="tipo_evento"/);
  assert.match(html, /Confirmación de la hoja de vida/);
  assert.match(html, /data-testid="historial-evento"/);
  assert.match(html, /var HOJA_VIDA_ID = 42;/);
  assert.match(html, /nonce="test-nonce"/);
});

test('hojas-vida historial view renders the empty state when there are no events', async () => {
  const html = await renderView(
    'src/views/home/prestamos/hojas-vida/historial.ejs',
    buildBaseViewLocals({
      hojaVida: { id: 42, equipo_id: 7, estado: 'ACTIVA' },
      equipo: { codigo: 'EQ-01', nombre: 'Equipo Demo', ubicacion: 'Lab 11' },
      eventos: [],
      tiposEvento: TIPOS_EVENTO_MANUALES,
      successMessage: null,
      errorMessage: null,
    })
  );

  assert.match(html, /data-testid="historial-vacio"/);
  assert.match(html, /0 eventos/);
});

test('hojas-vida ver view renders the read-only detail with documents and actions', async () => {
  const html = await renderView(
    'src/views/home/prestamos/hojas-vida/ver.ejs',
    buildBaseViewLocals({
      hojaVida: {
        id: 42,
        equipo_id: 7,
        estado: 'ACTIVA',
        nombre_equipo: 'Equipo Demo',
        marca: 'MarcaX',
        fecha_adquisicion: '2024-05-10',
      },
      equipo: {
        codigo: 'EQ-01',
        nombre: 'Equipo Demo',
        ubicacion: 'Lab 11',
        facultad: 'Facultad 10',
        laboratorio: 'Lab 11',
      },
      secciones: CAMPOS_POR_SECCION,
      documentos: [
        {
          id: 5,
          tipo_documento: 'EXCEL_ORIGEN',
          nombre_archivo: 'sigud.xlsx',
          fecha_carga_display: '15/10/2026 08:00',
        },
        {
          id: 6,
          tipo_documento: 'FOTOGRAFIA_EQUIPO',
          nombre_archivo: 'foto.png',
          fecha_carga_display: '15/10/2026 08:01',
        },
      ],
      successMessage: null,
      errorMessage: null,
    })
  );

  assert.match(html, /Hoja de Vida del Equipo/i);
  assert.match(html, /data-testid="hv-ver"/);
  assert.match(html, /data-testid="hv-estado">Activa/);
  assert.match(html, /data-testid="action-imprimir-hv"/);
  assert.match(html, /\/milab\/prestamos\/hojas-vida\/7\/imprimir/);
  assert.match(html, /data-testid="hv-ver-campo-marca"[\s\S]*?MarcaX/);
  assert.match(html, /data-testid="hv-documento"/);
  assert.match(html, /\/milab\/prestamos\/hojas-vida\/42\/documento\/5/);
  assert.match(html, /data-testid="hv-fotografia"/);
});

test('hojas-vida ver view renders the empty document state', async () => {
  const html = await renderView(
    'src/views/home/prestamos/hojas-vida/ver.ejs',
    buildBaseViewLocals({
      hojaVida: { id: 42, equipo_id: 7, estado: 'ACTIVA', nombre_equipo: 'Equipo Demo' },
      equipo: { codigo: 'EQ-01', nombre: 'Equipo Demo', ubicacion: 'Lab 11' },
      secciones: CAMPOS_POR_SECCION,
      documentos: [],
      successMessage: null,
      errorMessage: null,
    })
  );

  assert.match(html, /data-testid="hv-documentos-vacio"/);
});

test('hojas-vida editar view renders the editable form with current photo', async () => {
  const html = await renderView(
    'src/views/home/prestamos/hojas-vida/editar.ejs',
    buildBaseViewLocals({
      hojaVida: {
        id: 42,
        equipo_id: 7,
        estado: 'ACTIVA',
        nombre_equipo: 'Equipo Demo',
        marca: 'MarcaX',
        fecha_adquisicion: '2024-05-10',
      },
      equipo: { codigo: 'EQ-01', nombre: 'Equipo Demo', ubicacion: 'Lab 11' },
      secciones: CAMPOS_POR_SECCION,
      obligatorios: ['marca'],
      documentos: [
        {
          id: 6,
          tipo_documento: 'FOTOGRAFIA_EQUIPO',
          nombre_archivo: 'foto.png',
          tipo_mime: 'image/png',
          fecha_carga: '2026-10-15T08:01:00.000Z',
        },
      ],
      maxFotoMB: 5,
      successMessage: null,
      errorMessage: null,
    })
  );

  assert.match(html, /Editar Hoja de Vida/i);
  assert.match(html, /id="hv-editar-form"/);
  assert.match(html, /id="hv-editar-btn"/);
  assert.match(html, /data-testid="hv-editar-foto-actual"/);
  assert.match(html, /data-testid="hv-editar-foto-actual"[\s\S]*?\/documento\/6/);
  assert.match(html, /value="MarcaX"/);
  assert.match(html, /var hojaVidaId = 42;/);
  assert.match(html, /var equipoId = 7;/);
  assert.match(html, /nonce="test-nonce"/);
});

test('hojas-vida mantenimiento-nuevo view renders the form with catalogs', async () => {
  const html = await renderView(
    'src/views/home/prestamos/hojas-vida/mantenimiento-nuevo.ejs',
    buildBaseViewLocals({
      hojaVida: { id: 42, equipo_id: 7, estado: 'ACTIVA', nombre_equipo: 'Equipo Demo' },
      equipo: { codigo: 'EQ-01', nombre: 'Equipo Demo', ubicacion: 'Lab 11' },
      tiposMantenimiento: TIPOS_MANTENIMIENTO,
      estadosMantenimiento: ESTADOS_MANTENIMIENTO,
      estadoDefault: 'PENDIENTE',
      successMessage: null,
      errorMessage: null,
    })
  );

  assert.match(html, /Registrar Mantenimiento/i);
  assert.match(html, /id="hv-mto-form"/);
  assert.match(html, /id="hv-mto-tipo"/);
  assert.match(html, /id="hv-mto-item"/);
  assert.match(html, /Preventivo/);
  assert.match(html, /value="CUMPLIDO"/);
  assert.match(html, /name="estado"/);
  assert.match(html, /var equipoId = 7;/);
  assert.match(html, /nonce="test-nonce"/);
});

test('hojas-vida mantenimientos view lists records and the empty state', async () => {
  const baseOverrides = {
    hojaVida: { id: 42, equipo_id: 7, estado: 'ACTIVA' },
    equipo: { codigo: 'EQ-01', nombre: 'Equipo Demo', ubicacion: 'Lab 11' },
    successMessage: null,
    errorMessage: null,
  };

  const conDatos = await renderView(
    'src/views/home/prestamos/hojas-vida/mantenimientos.ejs',
    buildBaseViewLocals({
      ...baseOverrides,
      mantenimientos: [
        {
          id: 1,
          item: 'Cambio de rodamiento',
          tipo_mantenimiento: 'PREVENTIVO',
          tipo_mantenimiento_etiqueta: 'Preventivo',
          fecha_realizacion_display: '10/05/2024',
          estado: 'CUMPLIDO',
          estado_etiqueta: 'Cumplido',
          estado_clase: 'success',
          responsable: 'Juan Perez',
        },
      ],
    })
  );

  assert.match(conDatos, /Mantenimientos del Equipo/i);
  assert.match(conDatos, /data-testid="action-nuevo-mantenimiento"/);
  assert.match(conDatos, /data-testid="hv-mto-item"/);
  assert.match(conDatos, /Cambio de rodamiento/);
  assert.match(conDatos, /bg-success/);

  const sinDatos = await renderView(
    'src/views/home/prestamos/hojas-vida/mantenimientos.ejs',
    buildBaseViewLocals({ ...baseOverrides, mantenimientos: [] })
  );

  assert.match(sinDatos, /data-testid="hv-mto-vacio"/);
});
