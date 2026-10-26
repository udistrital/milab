const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');

const workspaceRoot = path.resolve(__dirname, '../../../');
const viewPath = path.join(workspaceRoot, 'src/views/home/sancion-person-actions.ejs');
const lookupToken = 'a'.repeat(64);

function renderRegistration(personType) {
  const isTeacher = personType === 'docente';
  const registrationPath = path.join(
    workspaceRoot,
    `src/views/home/reg_multa${isTeacher ? '_docente' : ''}.ejs`
  );

  return ejs.renderFile(registrationPath, {
    tipo: 'laboratorista',
    csrfToken: 'csrf-token',
    cspNonce: 'test-nonce',
    lookupToken,
    con_codigo: '2024100001',
    con_estado: 'ACTIVO',
    con_documento: '79520182',
    tipo_busqueda: 'codigo',
    con_carrera: 'Ingenieria',
    con_nombre: isTeacher ? 'Docente Prueba' : 'Estudiante Prueba',
    nombre_lab: 'Lab Prueba',
    cc_lab: '1024467835',
    uals: [],
    sanctionCategories: [],
    SANCTION_TYPES: [],
  });
}

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

function renderDocente(overrides = {}) {
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
    searchUrl: '/milab/api/get-info-multa-docente/get',
    activeSanctionCount: 0,
    ...overrides,
  });
}

const sampleDebt = {
  DEU_MATERIAL: 'Reposición de insumos',
  DEU_MULTA: '50000',
  DEU_CPTO_COD: '4',
  DEU_CPTO_NOMBRE: 'LABORATORIO DE QUIMICA',
  DEU_FECHA: '2024-06-04',
  DEU_ESTADO: 'PENDIENTE',
  DEU_ANO: '2024',
  DEU_PER: '1',
  DEU_FECHA_PAGO: '',
};

test('paso 2 student view keeps Agregar and removes the Retirar action', async () => {
  const html = await renderPaso2();

  assert.match(html, /action="\/milab\/api\/get-info-multa"/);
  assert.match(html, /Agregar sanción/);
  assert.doesNotMatch(html, /Retirar sanción/);
  assert.match(html, /data-sanction-person-actions-page="true"/);
  assert.match(html, /name="lookup_token" value="a{64}"/);
  assert.match(
    html,
    /<a class="btn btn-outline-secondary" href="\/milab\/api\/get-info-multa\/get">Buscar otra persona<\/a>/
  );
});

test('paso 2 does not restore Retirar when the student has active sanctions', async () => {
  const html = await renderPaso2({ activeSanctionCount: 2 });

  assert.doesNotMatch(html, /Retirar sanción/);
});

test('paso 2 shows the SGA counter and popup only when SGA has sanctions', async () => {
  const html = await renderPaso2({
    sga: { configured: true, debts: [sampleDebt], failed: false },
  });

  assert.match(html, /1\s+multa de laboratorio en SGA ·\s+Ver detalle/);
  assert.match(html, /data-bs-target="#sgaSancionesPersonaModal"/);
  assert.match(html, /id="sgaSancionesPersonaModal"/);
  assert.match(html, /Reposición de insumos/);
  assert.match(html, /Laboratorio \/ dependencia/);
  assert.match(html, /LABORATORIO DE QUIMICA/);
  assert.match(html, /Código SGA: 4/);
  assert.match(html, /50000/);
  assert.match(html, /PENDIENTE/);
});

test('paso 2 does not open an SGA popup when SGA has no sanctions', async () => {
  const html = await renderPaso2({ sga: { configured: true, debts: [], failed: false } });

  assert.match(html, /0 multas de laboratorio en SGA/);
  assert.doesNotMatch(html, /data-bs-target="#sgaSancionesPersonaModal"/);
  assert.doesNotMatch(html, /id="sgaSancionesPersonaModal"/);
});

test('paso 2 shows other SGA debts in a popup only for admins', async () => {
  const otherDebt = {
    nombre_concepto: 'BIBLIOTECA INGENIERÍA',
    codigo_concepto: '1',
    categoria: 'Libro pendiente',
    estado: '2',
    valor: '50000',
    fecha: '2026-10-26',
    id_sga: 'debt-1',
  };
  const [adminHtml, laboratoristaHtml] = await Promise.all([
    renderPaso2({
      tipo: 'admin',
      isAdmin: true,
      sga: { configured: true, debts: [], otherDebts: [otherDebt], failed: false },
    }),
    renderPaso2({
      sga: { configured: true, debts: [], otherDebts: [otherDebt], failed: false },
    }),
  ]);

  assert.match(adminHtml, /Otras multas SGA/);
  assert.match(adminHtml, /data-bs-target="#sgaOtrasMultasModal"/);
  assert.match(adminHtml, /id="sgaOtrasMultasModal"/);
  assert.match(adminHtml, /BIBLIOTECA INGENIERÍA/);
  assert.match(adminHtml, /Libro pendiente/);
  assert.match(adminHtml, /Vista informativa para administración/);
  assert.doesNotMatch(laboratoristaHtml, /Otras multas SGA/);
  assert.doesNotMatch(laboratoristaHtml, /id="sgaOtrasMultasModal"/);
});

test('admin sees an empty-state popup when there are no other SGA debts', async () => {
  const html = await renderPaso2({
    tipo: 'admin',
    isAdmin: true,
    sga: { configured: true, debts: [], otherDebts: [], failed: false },
  });

  assert.match(html, /Otras multas SGA/);
  assert.match(html, /No se encontraron otras multas activas de SGA para este documento/);
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

test('paso 2 edit form includes a required sanction date field', async () => {
  const html = await renderPaso2({ activeSanctionCount: 1, sanctionHistory: [] });

  assert.match(
    html,
    /<input type="date" id="fecha_sancion_edicion_listado" name="fecha_multa" class="form-control" required>/
  );
});

test('paso 2 shows the success alert from a completed action', async () => {
  const html = await renderPaso2({ successFeedback: 'aplazada' });

  assert.match(html, /La sanción se aplazó correctamente\./);
});

test('student and teacher success views offer a direct return to registration', async () => {
  const [studentHtml, teacherHtml] = await Promise.all([
    renderPaso2({ successFeedback: 'registrada' }),
    renderDocente({ successFeedback: 'registrada' }),
  ]);

  assert.match(studentHtml, /Volver al registro/);
  assert.doesNotMatch(studentHtml, /Agregar sanción/);
  assert.match(teacherHtml, /Volver al registro/);
  assert.doesNotMatch(teacherHtml, /Continuar con el registro/);
});

test('docente view keeps the previous layout without student-only actions', async () => {
  const html = await renderDocente();

  assert.doesNotMatch(html, /Agregar sanción/);
  assert.match(html, /Registrar sanción/);
  assert.doesNotMatch(html, /Retirar sanción/);
  assert.doesNotMatch(html, /app-sanctions-report/);
  assert.doesNotMatch(html, /id="sgaSancionesPersonaModal"/);
});

test('student and teacher registration forms carry the lookup token through submission', async () => {
  const [studentHtml, teacherHtml] = await Promise.all([
    renderRegistration('estudiante'),
    renderRegistration('docente'),
  ]);

  assert.match(studentHtml, /name="lookup_token" value="a{64}"/);
  assert.match(teacherHtml, /name="lookup_token" value="a{64}"/);
});
