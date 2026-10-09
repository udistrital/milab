const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');

const templatePath = path.resolve(__dirname, '../../../src/views/home/get_list_multas.ejs');
const cellsPath = path.resolve(__dirname, '../../../src/views/partials/sanction-report-cells.ejs');

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
  assert.doesNotMatch(html, /<th>(?:ID|Documento|Código)<\/th>/);
  assert.match(html, /Ana &lt;Prueba&gt;/);
  assert.match(html, /Química &amp; Materiales/);
  assert.match(html, /data-order="2026-10-08"/);
  assert.match(html, /data-sancion-id="42"/);
  assert.match(html, /data-sancion-action="edit"/);
  assert.match(html, /get_list_multas\/export\/excel/);
  assert.match(html, /value="Entrega tardía"/);
  assert.equal((html.match(/js-data-grid app-grid-contained/g) || []).length, 2);
});

test('sanction report cells show explicit missing values and distinguish every state', async () => {
  for (const [state, style] of [
    ['ACTIVA', 'danger'],
    ['APLAZADA', 'secondary'],
    ['Pendiente', 'warning'],
    ['POR SALDAR', 'info'],
    ['SALDADA', 'success'],
  ]) {
    const html = await ejs.renderFile(cellsPath, {
      sanction: { id: 1, con_estado_multa: state },
    });
    assert.match(html, /Sin código/);
    assert.match(html, /Sin documento/);
    assert.match(html, /Nombre no registrado/);
    assert.match(html, /Laboratorio no registrado/);
    assert.match(html, /Sin fecha/);
    assert.ok(html.includes(`text-bg-${style}`));
    assert.ok(html.includes(state));
    assert.equal((html.match(/<td(?:\s|>)/g) || []).length, 5);
  }
});
