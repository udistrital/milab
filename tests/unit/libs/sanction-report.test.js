const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');

const templatePath = path.resolve(__dirname, '../../../src/views/home/get_list_multas.ejs');
const cellsPath = path.resolve(__dirname, '../../../src/views/partials/sanction-report-cells.ejs');
const infoCellPath = path.resolve(__dirname, '../../../src/views/partials/sanction-info-cell.ejs');
const actionsCellPath = path.resolve(
  __dirname,
  '../../../src/views/partials/sanction-actions-cell.ejs'
);

test('sanction report renders identity, name, laboratory, date, state and existing actions', async () => {
  const sanction = {
    id: 42,
    codigo_sancionado: '20260001',
    documento_sancionado: '1000123456',
    nombre_sancionado: 'Ana <Prueba>',
    ual: 'Química & Materiales',
    fecha_multa_formateada: '2026-10-08',
    con_estado_multa: 'ACTIVA',
    nombre_laboratorista: 'Laboratorista',
    tipo_sancionado: 'estudiante',
    cat_multa: 'Entrega tardía',
    canEdit: true,
  };
  const html = await ejs.renderFile(templatePath, {
    tipo: 'admin',
    cspNonce: 'test-nonce',
    csrfToken: 'test-token',
    sgaConfigured: false,
    sanctionCategories: [{ id: 1, nombre: 'Entrega', descripcion: 'Entrega tardía', activo: true }],
    sancionesEstudiantes: [sanction],
    sancionesDocentes: [{ ...sanction, id: 43, tipo_sancionado: 'docente' }],
  });

  assert.match(html, /container-fluid app-page-shell app-sanctions-report/);
  assert.match(html, /<th>Estudiante<\/th>/);
  assert.match(html, /<th>Docente<\/th>/);
  assert.equal((html.match(/<th>Identificación<\/th>/g) || []).length, 2);
  assert.equal((html.match(/<th>Laboratorio<\/th>/g) || []).length, 2);
  assert.equal(
    (html.match(/<th class="app-sanction-info-column">Información de sanción<\/th>/g) || []).length,
    2
  );
  assert.doesNotMatch(html, /<th>(?:ID|Documento|Código|Fecha|Estado)<\/th>/);
  assert.match(html, /Ana &lt;Prueba&gt;/);
  assert.match(html, /Química &amp; Materiales/);
  assert.match(html, /data-order="2026-10-08"/);
  assert.match(html, /data-sancion-id="42"/);
  assert.match(html, /data-sancion-action="edit"/);
  assert.match(html, /get_list_multas\/export\/excel/);
  assert.match(html, /value="Entrega tardía"/);
  assert.equal((html.match(/js-data-grid app-grid-contained/g) || []).length, 2);
});

test('sanction report cells show explicit missing identity and laboratory values', async () => {
  const html = await ejs.renderFile(cellsPath, {
    sanction: { id: 1, con_estado_multa: 'ACTIVA' },
  });
  assert.match(html, /Sin código/);
  assert.match(html, /Sin documento/);
  assert.match(html, /Nombre no registrado/);
  assert.match(html, /Laboratorio no registrado/);
  assert.equal((html.match(/<td(?:\s|>)/g) || []).length, 3);
  assert.doesNotMatch(html, /Sin fecha|app-sanction-state/);
});

test('sanction info cell shows category, type, date, laboratorista and state with explicit fallbacks', async () => {
  for (const [state, style] of [
    ['ACTIVA', 'danger'],
    ['APLAZADA', 'secondary'],
    ['Pendiente', 'warning'],
    ['POR SALDAR', 'info'],
    ['SALDADA', 'success'],
  ]) {
    const html = await ejs.renderFile(infoCellPath, {
      sanction: {
        id: 1,
        con_estado_multa: state,
        cat_multa: 'Entrega tardía',
        fecha_multa_formateada: '2026-10-08',
      },
    });
    assert.match(html, /<td class="app-sanction-info-cell" data-order="2026-10-08">/);
    assert.match(html, /Entrega tardía/);
    assert.match(html, /Por definir/);
    assert.match(html, /No registrado/);
    assert.match(html, /<time datetime="2026-10-08">2026-10-08<\/time>/);
    assert.ok(html.includes(`text-bg-${style}`));
    assert.ok(html.includes(state));
    assert.equal((html.match(/<td(?:\s|>)/g) || []).length, 1);
  }
});

test('sanction info cell shows explicit missing date and state', async () => {
  const html = await ejs.renderFile(infoCellPath, { sanction: { id: 1 } });
  assert.match(html, /Sin fecha/);
  assert.match(html, /Sin estado/);
  assert.match(html, /text-bg-secondary/);
  assert.match(html, /data-order=""/);
});

test('sanction actions cell shows only icon actions allowed for each state', async () => {
  const cases = [
    {
      state: 'PENDIENTE',
      flags: { canActivate: true },
      primary: 'activate',
      title: 'Activar',
      extra: [],
    },
    {
      state: 'POR SALDAR',
      flags: { canSaldar: true },
      primary: 'saldar',
      title: 'Saldar',
      extra: [],
    },
    {
      state: 'ACTIVA',
      flags: { canRemove: true, canAplazar: true, canEdit: true },
      primary: 'remove',
      title: 'Saldar',
      extra: ['Aplazar', 'Editar'],
    },
    {
      state: 'APLAZADA',
      flags: { canReactivar: true },
      primary: 'reactivate',
      title: 'Reactivar',
      extra: [],
    },
  ];

  for (const { state, flags, primary, title, extra } of cases) {
    const html = await ejs.renderFile(actionsCellPath, {
      sanction: { id: 7, con_estado_multa: state, ...flags },
      sgaConfigured: false,
    });
    assert.match(html, /<td class="app-sanction-actions">/);
    assert.match(html, /title="Ver detalle"\s+aria-label="Ver detalle"/);
    assert.match(html, new RegExp(`data-sancion-action="${primary}"`));
    assert.match(html, new RegExp(`title="${title}"\\s+aria-label="${title}"`));
    assert.doesNotMatch(html, /class="[^"]*\bbtn\b/);
    assert.doesNotMatch(html, />\s*(Ver detalle|Activar|Saldar|Reactivar|Aplazar|Editar)\s*</);
    for (const label of ['Aplazar', 'Editar']) {
      const present = html.includes(`aria-label="${label}"`);
      assert.equal(present, extra.includes(label), `${state} ${label}`);
    }
  }
});

test('sanction actions cell keeps only the detail icon when no state action is allowed', async () => {
  const html = await ejs.renderFile(actionsCellPath, {
    sanction: { id: 8, con_estado_multa: 'SALDADA' },
    sgaConfigured: false,
  });
  assert.equal((html.match(/<button/g) || []).length, 1);
  assert.match(html, /app-detail-button/);
});
