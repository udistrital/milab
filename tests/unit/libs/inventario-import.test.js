const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const {
  INVENTORY_TYPES,
  InventoryImportError,
  getAdditionalIdentifierHeaders,
  parseQuantity,
  parseWorkbook,
  validateInventoryRows,
} = require('../../../src/libs/inventario-import');

function createWorkbookBuffer(rows, bookType = 'xlsx') {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventario');
  return XLSX.write(workbook, { type: 'buffer', bookType });
}

test('detects only unrecognized spreadsheet columns for additional nomenclature', () => {
  const parsed = parseWorkbook(
    createWorkbookBuffer([
      ['PLACA', 'DESCRIPCIÓN', 'CÓDIGO DE CATÁLOGO', 'CÓDIGO DE CATÁLOGO'],
      ['ARKA-001', 'Microscopio', 'CAT-001', 'CAT-001'],
    ]),
    'inventario.xlsx'
  );

  assert.deepEqual(getAdditionalIdentifierHeaders(parsed.headers), ['codigo de catalogo']);
});

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

test('does not allow PLACA UD to substitute for an official ARKA plate', () => {
  const parsed = parseWorkbook(
    createWorkbookBuffer([
      ['PLACA UD', 'DESCRIPCIÓN'],
      ['UD-001', 'Microscopio'],
    ]),
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

test('accepts equipment and complementary descriptions up to 1000 characters', () => {
  const descriptions = [462, 1000, 1001].map((length) => 'D'.repeat(length));
  const equipmentRows = validateInventoryRows(
    parseWorkbook(
      createWorkbookBuffer([
        ['PLACA', 'DESCRIPCIÓN'],
        ...descriptions.map((description, index) => [`ARKA-${index + 1}`, description]),
      ]),
      'equipos.xlsx'
    ),
    INVENTORY_TYPES.ARKA_EQUIPMENT
  );
  const complementaryRows = validateInventoryRows(
    parseWorkbook(
      createWorkbookBuffer([['DESCRIPCIÓN'], ...descriptions.map((description) => [description])]),
      'complementarios.xlsx'
    ),
    INVENTORY_TYPES.COMPLEMENTARY
  );

  [equipmentRows, complementaryRows].forEach((rows) => {
    assert.deepEqual(
      rows.map((row) => row.estado),
      ['exitosa', 'exitosa', 'fallida']
    );
    assert.match(rows[2].errores.join(' '), /descripción tiene 1001 caracteres.*1000/i);
  });
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

test('rejects Excel quantities that exceed NUMERIC(14,3) or VARCHAR(50)', () => {
  assert.match(parseQuantity('100000000000 g').error, /11 dígitos enteros/i);
  assert.match(parseQuantity('1.2345 g').error, /3 decimales/i);
  assert.match(parseQuantity(`1 ${'g'.repeat(51)}`).error, /máximo permitido es 50/i);
  assert.equal(parseQuantity('99999999999.999 g').quantity, 99999999999.999);
});

test('marks fields over database and form lengths as row errors with the field and size', () => {
  const parsed = parseWorkbook(
    createWorkbookBuffer([
      [
        'PLACA',
        'DESCRIPCIÓN',
        'SERIE',
        'CÓDIGO INTERNO',
        'MARCA',
        'MODELO',
        'PROVEEDOR',
        'OBSERVACIONES',
      ],
      [
        'P'.repeat(51),
        'D'.repeat(1001),
        'S'.repeat(101),
        'I'.repeat(256),
        'M'.repeat(256),
        'O'.repeat(256),
        'P'.repeat(256),
        'N'.repeat(2001),
      ],
    ]),
    'inventario.xlsx'
  );

  const [row] = validateInventoryRows(parsed, INVENTORY_TYPES.ARKA_EQUIPMENT);
  const errors = row.errores.join(' ');
  assert.equal(row.estado, 'fallida');
  assert.match(errors, /descripción tiene 1001 caracteres.*1000/i);
  assert.match(errors, /placa oficial tiene 51 caracteres.*50/i);
  assert.match(errors, /serial tiene 101 caracteres.*100/i);
  assert.match(errors, /codigo_interno tiene 256 caracteres.*255/i);
  assert.match(errors, /marca tiene 256 caracteres.*255/i);
  assert.match(errors, /modelo tiene 256 caracteres.*255/i);
  assert.match(errors, /proveedor tiene 256 caracteres.*255/i);
  assert.match(errors, /observaciones tiene 2001 caracteres.*2000/i);
});

test('marks overlong reagent references and quantities as row errors', () => {
  const parsed = parseWorkbook(
    createWorkbookBuffer(
      [
        ['REFERENCIA', 'REACTIVO', 'STOCK G.T'],
        ['R'.repeat(256), 'Acetamida', '1.2345 g'],
        ['REF-002', 'Solución', `1 ${'g'.repeat(51)}`],
        ['REF-003', 'Etanol', '100000000000 g'],
      ],
      'xlsx'
    ),
    'reactivos.xlsx'
  );

  const rows = validateInventoryRows(parsed, INVENTORY_TYPES.REAGENT);
  assert.equal(rows[0].estado, 'fallida');
  assert.match(rows[0].errores.join(' '), /referencia tiene 256 caracteres.*255/i);
  assert.equal(rows[1].estado, 'fallida');
  assert.match(rows[1].errores.join(' '), /unidad tiene 51 caracteres.*50/i);
  assert.equal(rows[2].estado, 'fallida');
  assert.match(rows[2].errores.join(' '), /11 dígitos enteros/i);
});

test('counts Unicode characters like PostgreSQL when enforcing column lengths', () => {
  const parsed = parseWorkbook(
    createWorkbookBuffer([
      ['PLACA', 'DESCRIPCIÓN'],
      ['ARKA-001', '\u{1f4bb}'.repeat(1000)],
      ['ARKA-002', '\u{1f4bb}'.repeat(1001)],
    ]),
    'inventario.xlsx'
  );

  const rows = validateInventoryRows(parsed, INVENTORY_TYPES.ARKA_EQUIPMENT);
  assert.equal(rows[0].estado, 'exitosa');
  assert.equal(rows[1].estado, 'fallida');
  assert.match(rows[1].errores.join(' '), /descripción tiene 1001 caracteres.*1000/i);
});
