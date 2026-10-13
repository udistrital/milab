const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const {
  INVENTORY_TYPES,
  InventoryImportError,
  parseWorkbook,
  validateInventoryRows,
} = require('../../../src/libs/inventario-import');

function createWorkbookBuffer(rows, bookType = 'xlsx') {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventario');
  return XLSX.write(workbook, { type: 'buffer', bookType });
}

test('parses legacy xls and current xlsx workbooks', () => {
  for (const [extension, bookType] of [
    ['.xls', 'xls'],
    ['.xlsx', 'xlsx'],
  ]) {
    const parsed = parseWorkbook(
      createWorkbookBuffer(
        [
          ['PLACA', 'DESCRIPCIÓN'],
          ['UD-001', 'Microscopio'],
        ],
        bookType
      ),
      `inventario${extension}`
    );

    const rows = validateInventoryRows(parsed, INVENTORY_TYPES.ARKA_EQUIPMENT);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].estado, 'exitosa');
    assert.equal(rows[0].payload.placa, 'UD-001');
    assert.equal(rows[0].payload.descripcion, 'Microscopio');
  }
});

test('requires official plate and description columns for ARKA equipment', () => {
  const parsed = parseWorkbook(
    createWorkbookBuffer([['DESCRIPCIÓN'], ['Microscopio']]),
    'inventario.xlsx'
  );

  assert.throws(
    () => validateInventoryRows(parsed, INVENTORY_TYPES.ARKA_EQUIPMENT),
    (error) =>
      error instanceof InventoryImportError &&
      error.code === 'missing_required_columns' &&
      /PLACA/.test(error.message)
  );
});

test('marks duplicate official plates within the workbook as failed', () => {
  const parsed = parseWorkbook(
    createWorkbookBuffer([
      ['PLACA', 'DESCRIPCIÓN'],
      ['UD-001', 'Microscopio'],
      [' ud-001 ', 'Balanza'],
    ]),
    'inventario.xlsx'
  );

  const rows = validateInventoryRows(parsed, INVENTORY_TYPES.ARKA_EQUIPMENT);
  assert.deepEqual(
    rows.map((row) => row.estado),
    ['exitosa', 'fallida']
  );
  assert.match(rows[1].errores.join(' '), /repetido/i);
});

test('keeps ARKA parallel identifiers separate from the official plate', () => {
  const parsed = parseWorkbook(
    createWorkbookBuffer([
      ['PLACA', 'PLACA UD', 'QR', 'DESCRIPCIÓN'],
      ['ARKA-001', 'LOCAL-001', 'QR-001', 'Microscopio'],
    ]),
    'inventario.xlsx'
  );

  const [row] = validateInventoryRows(parsed, INVENTORY_TYPES.ARKA_EQUIPMENT);
  assert.equal(row.estado, 'exitosa');
  assert.equal(row.payload.placa, 'ARKA-001');
  assert.deepEqual(row.payload.identificadores, [
    { tipo: 'qr', valor: 'QR-001' },
    { tipo: 'placa_local', valor: 'LOCAL-001' },
  ]);
});

test('accepts PLACA UD as the only available official identifier column', () => {
  const parsed = parseWorkbook(
    createWorkbookBuffer([
      ['PLACA UD', 'DESCRIPCIÓN'],
      ['UD-001', 'Microscopio'],
    ]),
    'inventario.xlsx'
  );

  const [row] = validateInventoryRows(parsed, INVENTORY_TYPES.ARKA_EQUIPMENT);
  assert.equal(row.estado, 'exitosa');
  assert.equal(row.payload.placa, 'UD-001');
  assert.deepEqual(row.payload.identificadores, [{ tipo: 'placa_local', valor: 'UD-001' }]);
});

test('keeps equipment name and description distinct and validates optional IDs', () => {
  const parsed = parseWorkbook(
    createWorkbookBuffer([
      ['EQUIPO', 'DESCRIPCIÓN', 'ID', 'PLACA'],
      ['Microscopio', 'Óptico compuesto', 'INV-001', 'ARKA-001'],
    ]),
    'inventario.xlsx'
  );

  const [row] = validateInventoryRows(parsed, INVENTORY_TYPES.ARKA_EQUIPMENT);
  assert.equal(row.estado, 'exitosa');
  assert.equal(row.payload.descripcion, 'Óptico compuesto');
  assert.deepEqual(row.payload.identificadores, [{ tipo: 'identificador_id', valor: 'INV-001' }]);
});

test('supports a complementary group without an assigned identifier', () => {
  const parsed = parseWorkbook(
    createWorkbookBuffer([
      ['NOMBRE DEL MATERIAL', 'CANTIDAD', 'MARCA'],
      ['Flexómetro', '20', 'Genérica'],
    ]),
    'complementarios.xlsx'
  );

  const [row] = validateInventoryRows(parsed, INVENTORY_TYPES.COMPLEMENTARY);
  assert.equal(row.estado, 'exitosa');
  assert.equal(row.payload.modoControl, 'cantidad');
  assert.deepEqual(row.payload.existencias, [
    { grado: 'NA', ubicacion: 'EXISTENCIA', cantidad: 20, unidad: 'unidad' },
  ]);
});

test('does not treat a material issue quantity as current stock', () => {
  const parsed = parseWorkbook(
    createWorkbookBuffer([
      ['NOMBRE DEL MATERIAL', 'CANTIDAD DE SALIDA'],
      ['Escobillón', 5],
    ]),
    'materiales.xlsx'
  );

  const [row] = validateInventoryRows(parsed, INVENTORY_TYPES.COMPLEMENTARY);
  assert.equal(row.estado, 'exitosa');
  assert.equal(row.payload.existencias.length, 0);
});

test('keeps reagent balances separate by grade and stock or circulation', () => {
  const parsed = parseWorkbook(
    createWorkbookBuffer([
      ['REFERENCIA', 'REACTIVO', 'STOCK G.T', 'STOCK R.A', 'CIRCULACION G.T', 'CIRCULACION R.A'],
      ['A-01', 'Acetamida', '', '2000 g', '', '400 g'],
      ['A-03', 'Albúmina', '450 g', '400 g', '450 g', ''],
    ]),
    'reactivos.xlsx'
  );

  const rows = validateInventoryRows(parsed, INVENTORY_TYPES.REAGENT);
  assert.equal(rows[0].estado, 'exitosa');
  assert.deepEqual(rows[0].payload.existencias, [
    { grado: 'RA', ubicacion: 'STOCK', cantidad: 2000, unidad: 'g' },
    { grado: 'RA', ubicacion: 'CIRCULACION', cantidad: 400, unidad: 'g' },
  ]);
  assert.deepEqual(rows[1].payload.existencias, [
    { grado: 'GT', ubicacion: 'STOCK', cantidad: 450, unidad: 'g' },
    { grado: 'RA', ubicacion: 'STOCK', cantidad: 400, unidad: 'g' },
    { grado: 'GT', ubicacion: 'CIRCULACION', cantidad: 450, unidad: 'g' },
  ]);
});

test('reads reagent templates with two-row stock and circulation headings', () => {
  const parsed = parseWorkbook(
    createWorkbookBuffer([
      ['REFERENCIA', 'REACTIVO', 'STOCK', '', 'CIRCULACION', '', 'OBSERVACIÓN'],
      ['', '', 'G.T', 'R.A', 'G.T', 'R.A', ''],
      ['A-01', 'Acetamida', '', '2000 g', '', '400 g', 'Mantener cerrado'],
    ]),
    'reactivos.xlsx'
  );

  const [row] = validateInventoryRows(parsed, INVENTORY_TYPES.REAGENT);
  assert.equal(row.estado, 'exitosa');
  assert.equal(row.numeroFila, 3);
  assert.deepEqual(row.payload.existencias, [
    { grado: 'RA', ubicacion: 'STOCK', cantidad: 2000, unidad: 'g' },
    { grado: 'RA', ubicacion: 'CIRCULACION', cantidad: 400, unidad: 'g' },
  ]);
});

test('rejects unsupported spreadsheet extensions and invalid quantities', () => {
  assert.throws(() => parseWorkbook(Buffer.from('not excel'), 'inventario.csv'), {
    code: 'unsupported_format',
  });

  const parsed = parseWorkbook(
    createWorkbookBuffer([
      ['REFERENCIA', 'REACTIVO', 'STOCK G.T'],
      ['A-01', 'Acetamida', 'dos gramos'],
    ]),
    'reactivos.xls'
  );
  const [row] = validateInventoryRows(parsed, INVENTORY_TYPES.REAGENT);
  assert.equal(row.estado, 'fallida');
  assert.match(row.errores.join(' '), /cantidad debe ser un número/i);
});
