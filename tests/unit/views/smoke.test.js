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
      tipoUsoClaves: ['ACADEMICO', 'OTROS'],
      tipoUsoOtro: 'Certificacion externa',
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
  assert.match(html, /name="tipo_uso"[\s\S]*?value="ACADEMICO"[\s\S]*?checked/);
  assert.match(html, /id="hv-uso-OTROS"[\s\S]*?checked/);
  assert.match(html, /name="tipo_uso_otro"[\s\S]*?value="Certificacion externa"/);
  assert.match(html, /name="tipo_uso_grupo"/);
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
          tipo_evento: 'CREACION',
          tipo_evento_etiqueta: 'Creación de la hoja de vida',
          tipo_evento_clase: 'success',
          descripcion: 'Carga inicial de la hoja de vida.',
          usuario: '100',
          fecha_display: '15/10/2026 08:00',
          referencia_display: 'Documento #5',
        },
        {
          id: 2,
          tipo_evento: 'CONFIRMACION',
          tipo_evento_etiqueta: 'Confirmación de la hoja de vida',
          tipo_evento_clase: 'success',
          descripcion: 'Confirmación de la hoja de vida (creación oficial).',
          usuario: '100',
          fecha_display: '15/10/2026 08:05',
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
  assert.match(html, /Creación de la hoja de vida/);
  assert.match(html, /Confirmación de la hoja de vida/);
  assert.match(html, /data-testid="historial-evento"/);
  assert.match(html, /data-testid="historial-evento-referencia">\s*Referencia: Documento #5/);
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
      tipoUsoTexto: 'Académico, Otros: Certificación',
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
  assert.match(html, /data-testid="hv-ver-campo-tipo_uso"[^>]*>Académico, Otros: Certificación/);
  assert.match(html, /data-testid="hv-estado">Activa/);
  assert.match(html, /data-testid="action-imprimir-hv"/);
  assert.match(html, /\/milab\/prestamos\/hojas-vida\/7\/imprimir/);
  assert.match(html, /data-testid="action-agregar-mantenimiento-hv"/);
  assert.match(html, /\/milab\/prestamos\/hojas-vida\/7\/mantenimientos\/nuevo/);
  assert.match(html, /data-testid="hv-ver-campo-marca"[\s\S]*?MarcaX/);
  assert.match(html, /data-testid="hv-documento"/);
  assert.match(html, /\/milab\/prestamos\/hojas-vida\/42\/documento\/5/);
  assert.match(html, /Documento original \(Excel\)/);
  assert.match(html, /Fotografía del equipo/);
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
      tipoUsoClaves: ['SERVICIOS'],
      tipoUsoOtro: '',
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
  assert.match(html, /data-testid="hv-editar-foto-eliminar-wrap"/);
  assert.match(html, /name="eliminar_foto"/);
  assert.match(html, /value="MarcaX"/);
  assert.match(html, /name="tipo_uso"[\s\S]*?value="SERVICIOS"[\s\S]*?checked/);
  assert.match(html, /id="hv-uso-otros-texto"[\s\S]*?disabled/);
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
    diasAlerta: 30,
    costoAcumulado: 0,
    costoAcumuladoDisplay: '$0',
    estadosMantenimiento: ESTADOS_MANTENIMIENTO,
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

test('hojas-vida mantenimiento-editar view renders the editable form with current values', async () => {
  const html = await renderView(
    'src/views/home/prestamos/hojas-vida/mantenimiento-editar.ejs',
    buildBaseViewLocals({
      hojaVida: { id: 42, equipo_id: 7, estado: 'ACTIVA' },
      equipo: { codigo: 'EQ-01', nombre: 'Equipo Demo', ubicacion: 'Lab 11' },
      mantenimiento: {
        id: 9,
        item: 'Cambio de rodamiento',
        tipo_mantenimiento: 'PREVENTIVO',
        estado: 'EN_EJECUCION',
        fecha_realizacion: '2024-05-10',
        costo: 150000,
        responsable: 'Juan Perez',
        datos_empresa_contratada: 'Servitec',
        observaciones_repuestos: 'Rodamiento nuevo',
      },
      tiposMantenimiento: TIPOS_MANTENIMIENTO,
      estadosMantenimiento: [ESTADOS_MANTENIMIENTO[1]],
      successMessage: null,
      errorMessage: null,
    })
  );

  assert.match(html, /Editar Mantenimiento/i);
  assert.match(html, /data-testid="hv-mto-editar-form"/);
  assert.match(html, /value="Cambio de rodamiento"/);
  assert.match(html, /value="2024-05-10"/);
  assert.match(html, /value="150000"/);
  assert.match(html, /name="estado" value="EN_EJECUCION"/);
  assert.match(html, /var mantenimientoId = 9;/);
  assert.match(html, /nonce="test-nonce"/);
});

test('hojas-vida ver view renders the maintenance summary and history', async () => {
  const html = await renderView(
    'src/views/home/prestamos/hojas-vida/ver.ejs',
    buildBaseViewLocals({
      hojaVida: { id: 42, equipo_id: 7, estado: 'ACTIVA', nombre_equipo: 'Equipo Demo' },
      equipo: { codigo: 'EQ-01', nombre: 'Equipo Demo', ubicacion: 'Lab 11' },
      secciones: CAMPOS_POR_SECCION,
      documentos: [],
      mantenimientos: [
        {
          id: 9,
          item: 'Cambio de rodamiento',
          tipo_mantenimiento_etiqueta: 'Preventivo',
          fecha_realizacion_display: '10/05/2024',
          estado_etiqueta: 'Cumplido',
          estado_clase: 'success',
          responsable: 'Juan Perez',
          datos_empresa_contratada: 'Servitec',
          observaciones_repuestos: 'Rodamiento nuevo',
          costo_display: '$150.000',
          fecha_cierre_display: '11/05/2024 10:00',
        },
      ],
      resumen: {
        dias_alerta_vencimiento: 30,
        alerta: { codigo: 'VENCIDO', etiqueta: 'Mantenimiento vencido', clase: 'danger' },
        mantenimientos_total: 1,
        costo_mantenimiento: 150000,
        costo_mantenimiento_display: '$150.000',
        prestamos_total: 247,
      },
      successMessage: null,
      errorMessage: null,
    })
  );

  assert.match(html, /data-testid="hv-resumen-uso"/);
  assert.match(html, /data-testid="hv-alerta-mantenimiento">Mantenimiento vencido/);
  assert.match(html, /data-testid="hv-resumen-prestamos">247/);
  assert.match(html, /data-testid="hv-historial-mantenimientos"/);
  assert.match(html, /data-testid="hv-historial-mantenimiento-item">Cambio de rodamiento/);
  assert.match(html, /Servitec/);
});

test('hojas-vida ver view renders the empty maintenance history', async () => {
  const html = await renderView(
    'src/views/home/prestamos/hojas-vida/ver.ejs',
    buildBaseViewLocals({
      hojaVida: { id: 42, equipo_id: 7, estado: 'ACTIVA' },
      equipo: { codigo: 'EQ-01', nombre: 'Equipo Demo', ubicacion: 'Lab 11' },
      secciones: CAMPOS_POR_SECCION,
      documentos: [],
      mantenimientos: [],
      resumen: { dias_alerta_vencimiento: 30, alerta: null },
      successMessage: null,
      errorMessage: null,
    })
  );

  assert.match(html, /data-testid="hv-historial-mantenimientos-vacio"/);
});

test('hojas-vida reportes views render filters and data panels', async () => {
  const base = {
    successMessage: null,
    errorMessage: null,
  };

  const mantenimientos = await renderView(
    'src/views/home/prestamos/hojas-vida/reportes-mantenimientos.ejs',
    buildBaseViewLocals({
      ...base,
      tiposMantenimiento: TIPOS_MANTENIMIENTO,
      estadosMantenimiento: ESTADOS_MANTENIMIENTO,
    })
  );
  assert.match(mantenimientos, /data-testid="reportes-mantenimientos"/);
  assert.match(mantenimientos, /data-testid="rm-total"/);
  assert.match(mantenimientos, /id="rm-filtros"/);

  const alertas = await renderView(
    'src/views/home/prestamos/hojas-vida/reportes-alertas.ejs',
    buildBaseViewLocals({ ...base })
  );
  assert.match(alertas, /data-testid="reportes-alertas"/);
  assert.match(alertas, /id="ra-tbody"/);

  const utilizacion = await renderView(
    'src/views/home/prestamos/hojas-vida/reportes-utilizacion.ejs',
    buildBaseViewLocals({ ...base })
  );
  assert.match(utilizacion, /data-testid="reportes-utilizacion"/);
  assert.match(utilizacion, /id="ru-filtros"/);
  assert.match(utilizacion, /reportes\/mantenimientos/);
});
