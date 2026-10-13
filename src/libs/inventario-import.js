const path = require('node:path');
const XLSX = require('xlsx');

const INVENTORY_TYPES = Object.freeze({
  ARKA_EQUIPMENT: 'equipo_arka',
  COMPLEMENTARY: 'complementario',
  REAGENT: 'reactivo',
});

const HEADER_ALIASES = Object.freeze({
  description: ['descripcion', 'nombre', 'nombre del bien', 'nombre del material', 'reactivo'],
  equipmentName: ['equipo', 'nombre del equipo'],
  plate: ['placa'],
  internalCode: ['codigo interno', 'codigo local', 'codigo'],
  identifierId: ['id', 'identificador', 'consecutivo alterno'],
  serial: ['serial', 'serie', 'no de serie', 'numero de serie'],
  barcode: ['codigo de barras', 'barcode'],
  qr: ['qr'],
  localPlate: ['placa local', 'placa ud'],
  taggedCode: ['etiquetado codificacion interna', 'identificador interno'],
  brand: ['marca'],
  model: ['modelo'],
  provider: ['proveedor'],
  observations: ['observacion', 'observaciones'],
  quantity: ['cantidad actual', 'cantidad', 'existencia actual', 'existencias'],
  reference: ['referencia'],
  stockTechnical: ['stock gt', 'stock g t', 'stock grado tecnico', 'stock tecnico'],
  stockAnalytical: ['stock ra', 'stock r a', 'stock reactivo analitico', 'stock analitico'],
  circulationTechnical: [
    'circulacion gt',
    'circulacion g t',
    'circulacion grado tecnico',
    'circulacion tecnico',
  ],
  circulationAnalytical: [
    'circulacion ra',
    'circulacion r a',
    'circulacion reactivo analitico',
    'circulacion analitico',
  ],
});

class InventoryImportError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'InventoryImportError';
    this.code = code;
  }
}

function normalizeHeader(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeIdentifier(value) {
  return String(value || '')
    .trim()
    .toLocaleUpperCase('es-CO')
    .replace(/\s+/g, '');
}

function toCellText(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object' && 'text' in value) return String(value.text || '').trim();
  return String(value).trim();
}

function normalizeSpreadsheetHeaders(matrix) {
  const firstRow = matrix[0] || [];
  const secondRow = matrix[1] || [];
  const firstHeaders = firstRow.map(normalizeHeader);
  const secondHeaders = secondRow.map(normalizeHeader);
  const hasTechnicalGrade = secondHeaders.some((header) =>
    ['gt', 'g t', 'grado tecnico', 'tecnico'].includes(header)
  );
  const hasAnalyticalGrade = secondHeaders.some((header) =>
    ['ra', 'r a', 'reactivo analitico', 'analitico'].includes(header)
  );
  const hasStockOrCirculation = firstHeaders.some((header) =>
    ['stock', 'circulacion'].includes(header)
  );

  if (!hasTechnicalGrade || !hasAnalyticalGrade || !hasStockOrCirculation) {
    return { headers: firstHeaders, headerRowCount: 1 };
  }

  let groupHeader = '';
  const headers = firstRow.map((value, index) => {
    const header = firstHeaders[index];
    const subheader = secondHeaders[index];

    if (header === 'stock' || header === 'circulacion') {
      groupHeader = header;
      return normalizeHeader(`${toCellText(value)} ${toCellText(secondRow[index])}`);
    }
    if (header) {
      groupHeader = '';
      return header;
    }
    if (groupHeader && subheader) {
      return normalizeHeader(`${groupHeader} ${toCellText(secondRow[index])}`);
    }
    return subheader;
  });

  return { headers, headerRowCount: 2 };
}

function parseQuantity(value) {
  const text = toCellText(value);
  if (!text) return null;

  const match = text.match(/^(-?\d+(?:[.,]\d+)?)\s*([a-zA-ZÁÉÍÓÚÜáéíóúü]+)?$/);
  if (!match) return { error: 'La cantidad debe ser un número y puede incluir unidad.' };

  const quantity = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(quantity) || quantity < 0) {
    return { error: 'La cantidad debe ser un número mayor o igual a cero.' };
  }

  return {
    quantity,
    unit: match[2] ? match[2].toLocaleLowerCase('es-CO') : null,
  };
}

function parseWorkbook(buffer, fileName) {
  const extension = path.extname(String(fileName || '')).toLowerCase();
  if (!['.xls', '.xlsx'].includes(extension)) {
    throw new InventoryImportError(
      'El archivo debe tener formato .xls o .xlsx.',
      'unsupported_format'
    );
  }

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new InventoryImportError('El archivo está vacío o no es válido.', 'empty_file');
  }

  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, dense: true });
  } catch {
    throw new InventoryImportError('No fue posible leer el libro de Excel.', 'invalid_workbook');
  }

  const firstSheetName = workbook.SheetNames[0];
  const worksheet = firstSheetName ? workbook.Sheets[firstSheetName] : null;
  if (!worksheet) {
    throw new InventoryImportError('El archivo no contiene una hoja de cálculo.', 'missing_sheet');
  }

  const matrix = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
    blankrows: true,
    raw: false,
  });
  if (!matrix.length || !matrix[0].some((value) => toCellText(value))) {
    throw new InventoryImportError('La primera fila debe contener encabezados.', 'missing_headers');
  }

  const { headers, headerRowCount } = normalizeSpreadsheetHeaders(matrix);
  const rows = matrix
    .slice(headerRowCount)
    .map((row, index) => ({
      rowNumber: index + headerRowCount + 1,
      cells: Array.from({ length: headers.length }, (_, columnIndex) => row[columnIndex] ?? ''),
    }))
    .filter((row) => row.cells.some((value) => toCellText(value)));

  return { headers, rows };
}

function findColumnIndexes(headers, logicalField) {
  const aliases = HEADER_ALIASES[logicalField] || [];
  const normalizedAliases = new Set(aliases.map(normalizeHeader));
  return headers.reduce((indexes, header, index) => {
    if (normalizedAliases.has(header)) indexes.push(index);
    return indexes;
  }, []);
}

function readField(row, headers, logicalField) {
  const values = findColumnIndexes(headers, logicalField)
    .map((index) => toCellText(row.cells[index]))
    .filter(Boolean);
  if (!values.length) return { value: '' };

  const normalizedValues = new Set(values.map((value) => normalizeIdentifier(value)));
  if (normalizedValues.size > 1) {
    return { value: '', error: 'Hay valores contradictorios en columnas equivalentes.' };
  }
  return { value: values[0] };
}

function readIdentifiers(row, headers) {
  const identifierFields = [
    ['codigo_interno', 'internalCode'],
    ['identificador_id', 'identifierId'],
    ['serie', 'serial'],
    ['codigo_barras', 'barcode'],
    ['qr', 'qr'],
    ['placa_local', 'localPlate'],
    ['etiquetado', 'taggedCode'],
  ];
  const identifiers = [];
  const seenValues = new Set();

  identifierFields.forEach(([tipo, fieldName]) => {
    findColumnIndexes(headers, fieldName).forEach((index) => {
      const valor = toCellText(row.cells[index]);
      const normalized = normalizeIdentifier(valor);
      if (!normalized || seenValues.has(normalized)) return;
      seenValues.add(normalized);
      identifiers.push({ tipo, valor });
    });
  });

  return identifiers;
}

function readOfficialPlate(row, headers) {
  const officialPlateIndex = findColumnIndexes(headers, 'plate').find((index) =>
    toCellText(row.cells[index])
  );
  if (officialPlateIndex !== undefined) {
    return toCellText(row.cells[officialPlateIndex]);
  }

  const alternatePlateIndex = findColumnIndexes(headers, 'localPlate').find((index) =>
    toCellText(row.cells[index])
  );
  return alternatePlateIndex === undefined ? '' : toCellText(row.cells[alternatePlateIndex]);
}

function validateInventoryRows(parsedWorkbook, inventoryType) {
  const supportedTypes = new Set(Object.values(INVENTORY_TYPES));
  if (!supportedTypes.has(inventoryType)) {
    throw new InventoryImportError(
      'El tipo de inventario seleccionado no es válido.',
      'invalid_type'
    );
  }

  const { headers, rows } = parsedWorkbook;
  const requiredFields =
    inventoryType === INVENTORY_TYPES.ARKA_EQUIPMENT
      ? ['plate', 'description']
      : inventoryType === INVENTORY_TYPES.REAGENT
        ? ['reference', 'description']
        : ['description'];
  const missingColumns = requiredFields.filter((field) => {
    if (field === 'plate') {
      return (
        findColumnIndexes(headers, 'plate').length === 0 &&
        findColumnIndexes(headers, 'localPlate').length === 0
      );
    }
    if (field === 'description') {
      return (
        findColumnIndexes(headers, 'description').length === 0 &&
        findColumnIndexes(headers, 'equipmentName').length === 0
      );
    }
    return findColumnIndexes(headers, field).length === 0;
  });
  if (missingColumns.length) {
    const labels = missingColumns.map((field) => {
      if (field === 'plate') return 'PLACA';
      if (field === 'reference') return 'REFERENCIA';
      return 'DESCRIPCIÓN o EQUIPO';
    });
    throw new InventoryImportError(
      `Faltan columnas obligatorias: ${labels.join(', ')}.`,
      'missing_required_columns'
    );
  }

  const seenIdentifiers = new Set();
  return rows.map((row) => {
    const errors = [];
    const descriptionField = readField(row, headers, 'description');
    const equipmentNameField = readField(row, headers, 'equipmentName');
    const plateField = readField(row, headers, 'plate');
    const plate = plateField.value || readOfficialPlate(row, headers);
    const identifiers = readIdentifiers(row, headers);
    const brandField = readField(row, headers, 'brand');
    const modelField = readField(row, headers, 'model');
    const serialField = readField(row, headers, 'serial');
    const providerField = readField(row, headers, 'provider');
    const observationsField = readField(row, headers, 'observations');
    const originalData = Object.fromEntries(
      headers.map((header, index) => [
        header || `columna_${index + 1}`,
        toCellText(row.cells[index]),
      ])
    );

    [
      descriptionField,
      equipmentNameField,
      plateField,
      brandField,
      modelField,
      serialField,
      providerField,
      observationsField,
    ].forEach((field) => {
      if (field.error) errors.push(field.error);
    });

    const description = descriptionField.value || equipmentNameField.value;
    const internalCode =
      identifiers.find((identifier) => identifier.tipo === 'codigo_interno')?.valor || '';

    if (!description) errors.push('La descripción es obligatoria.');
    if (inventoryType === INVENTORY_TYPES.ARKA_EQUIPMENT && !plate) {
      errors.push('La placa oficial de ARKA es obligatoria.');
    }
    if (inventoryType === INVENTORY_TYPES.ARKA_EQUIPMENT && plate.length > 50) {
      errors.push('La placa oficial no puede superar 50 caracteres.');
    }
    if (serialField.value.length > 100) {
      errors.push('El serial no puede superar 100 caracteres.');
    }
    if (identifiers.some((identifier) => identifier.valor.length > 255)) {
      errors.push('Los identificadores adicionales no pueden superar 255 caracteres.');
    }

    const rowIdentifiers = [
      ...(inventoryType === INVENTORY_TYPES.ARKA_EQUIPMENT
        ? [{ tipo: 'placa_arka', valor: plate }]
        : []),
      ...identifiers,
    ];
    const identifiersInRow = new Set();
    rowIdentifiers.forEach((identifierItem) => {
      const normalizedIdentifier = normalizeIdentifier(identifierItem.valor);
      if (!normalizedIdentifier || identifiersInRow.has(normalizedIdentifier)) return;
      identifiersInRow.add(normalizedIdentifier);
      if (normalizedIdentifier && seenIdentifiers.has(normalizedIdentifier)) {
        errors.push('El identificador está repetido en el archivo.');
      } else if (normalizedIdentifier) {
        seenIdentifiers.add(normalizedIdentifier);
      }
    });

    const payload = {
      tipo: inventoryType,
      descripcion: description,
      placa: inventoryType === INVENTORY_TYPES.ARKA_EQUIPMENT ? plate : '',
      serie: serialField.value,
      codigoInterno: internalCode,
      identificadores: identifiers,
      marca: brandField.value,
      modelo: modelField.value,
      proveedor: providerField.value,
      observaciones: observationsField.value,
      atributos: originalData,
      modoControl: 'individual',
      existencias: [],
      referencia: '',
    };

    if (inventoryType === INVENTORY_TYPES.COMPLEMENTARY) {
      const quantityField = readField(row, headers, 'quantity');
      if (quantityField.error) errors.push(quantityField.error);
      if (quantityField.value) {
        const parsedQuantity = parseQuantity(quantityField.value);
        if (parsedQuantity?.error) {
          errors.push(parsedQuantity.error);
        } else {
          payload.modoControl = 'cantidad';
          payload.existencias.push({
            grado: 'NA',
            ubicacion: 'EXISTENCIA',
            cantidad: parsedQuantity.quantity,
            unidad: parsedQuantity.unit || 'unidad',
          });
        }
      } else if (!internalCode) {
        payload.modoControl = 'cantidad';
      }
    }

    if (inventoryType === INVENTORY_TYPES.REAGENT) {
      const referenceField = readField(row, headers, 'reference');
      if (referenceField.error) errors.push(referenceField.error);
      payload.referencia = referenceField.value;
      if (!payload.referencia) errors.push('La referencia del reactivo es obligatoria.');
      payload.modoControl = 'cantidad';

      const balances = [
        ['GT', 'STOCK', 'stockTechnical'],
        ['RA', 'STOCK', 'stockAnalytical'],
        ['GT', 'CIRCULACION', 'circulationTechnical'],
        ['RA', 'CIRCULACION', 'circulationAnalytical'],
      ];
      balances.forEach(([grade, location, fieldName]) => {
        const field = readField(row, headers, fieldName);
        if (field.error) errors.push(field.error);
        if (!field.value) return;
        const quantity = parseQuantity(field.value);
        if (quantity?.error) {
          errors.push(`${location} ${grade}: ${quantity.error}`);
        } else {
          if (!quantity.unit) {
            errors.push(`${location} ${grade}: la unidad de medida es obligatoria.`);
            return;
          }
          payload.existencias.push({
            grado: grade,
            ubicacion: location,
            cantidad: quantity.quantity,
            unidad: quantity.unit,
          });
        }
      });
    }

    return {
      numeroFila: row.rowNumber,
      estado: errors.length ? 'fallida' : 'exitosa',
      errores: errors,
      payload,
      datosOriginales: originalData,
    };
  });
}

module.exports = {
  INVENTORY_TYPES,
  InventoryImportError,
  normalizeHeader,
  normalizeIdentifier,
  parseQuantity,
  parseWorkbook,
  validateInventoryRows,
};
