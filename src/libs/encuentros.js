const ExcelJS = require('exceljs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const QRCode = require('qrcode');

const PARTICIPANT_HEADERS = [
  'Nombre completo',
  'Número de documento',
  'Correo electrónico',
  'Facultad',
  'Laboratorio',
];

const CERTIFICATE_VARIABLES = new Set([
  'nombre',
  'documento',
  'correo',
  'facultad',
  'laboratorio',
  'evento',
  'fecha_evento',
  'lugar',
  'organizador',
  'rol',
  'fecha_emision',
  'codigo_certificado',
  'qr_verificacion',
]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOCUMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 .-]{0,49}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function normalizeDocument(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalizeHeader(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function getCellText(cell) {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'object' && Array.isArray(cell.richText)) {
    return cell.richText
      .map((part) => part.text || '')
      .join('')
      .trim();
  }
  if (typeof cell === 'object' && cell.text) return String(cell.text).trim();
  if (typeof cell === 'object' && cell.result !== undefined) return String(cell.result).trim();
  return String(cell).trim();
}

function validateParticipant(raw) {
  const name = String(raw?.nombre || '').trim();
  const document = String(raw?.documento || '').trim();
  const email = String(raw?.correo || '')
    .trim()
    .toLowerCase();
  const faculty = String(raw?.facultad || '').trim();
  const laboratory = String(raw?.laboratorio || '').trim();
  const errors = [];

  if (!name || name.length > 255)
    errors.push('Nombre completo es obligatorio (máximo 255 caracteres).');
  if (!document || !DOCUMENT_PATTERN.test(document)) {
    errors.push(
      'Número de documento obligatorio y debe contener hasta 50 letras, números, espacios, puntos o guiones.'
    );
  } else if (!normalizeDocument(document)) {
    errors.push('Número de documento inválido.');
  }
  if (!email || email.length > 255 || !EMAIL_PATTERN.test(email)) {
    errors.push('Correo electrónico obligatorio y con formato válido.');
  }
  if (!faculty || faculty.length > 255)
    errors.push('Facultad es obligatoria (máximo 255 caracteres).');
  if (!laboratory || laboratory.length > 255) {
    errors.push('Laboratorio es obligatorio (máximo 255 caracteres).');
  }

  return {
    participante: {
      nombre: name,
      documento: document,
      documento_normalizado: normalizeDocument(document),
      correo: email,
      facultad: faculty,
      laboratorio: laboratory,
    },
    errores: errors,
  };
}

function validateEventInput(input) {
  const event = {
    nombre: String(input?.nombre || '').trim(),
    descripcion: String(input?.descripcion || '').trim(),
    fecha: String(input?.fecha || '').trim(),
    hora_inicio: String(input?.hora_inicio || '').trim(),
    hora_fin: String(input?.hora_fin || '').trim(),
    lugar: String(input?.lugar || '').trim(),
    organizador: String(input?.organizador || '').trim(),
  };
  const errors = [];

  if (!event.nombre || event.nombre.length > 255)
    errors.push('Nombre del evento es obligatorio (máximo 255 caracteres).');
  const parsedDate = DATE_PATTERN.exec(event.fecha);
  const dateParts = parsedDate ? event.fecha.split('-').map(Number) : [];
  const dateValue = dateParts.length
    ? new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2]))
    : null;
  if (
    !parsedDate ||
    !dateValue ||
    dateValue.getUTCFullYear() !== dateParts[0] ||
    dateValue.getUTCMonth() + 1 !== dateParts[1] ||
    dateValue.getUTCDate() !== dateParts[2]
  ) {
    errors.push('Fecha debe tener el formato AAAA-MM-DD.');
  }
  if (!TIME_PATTERN.test(event.hora_inicio))
    errors.push('Hora de inicio debe tener formato HH:mm.');
  if (!TIME_PATTERN.test(event.hora_fin))
    errors.push('Hora de finalización debe tener formato HH:mm.');
  if (
    TIME_PATTERN.test(event.hora_inicio) &&
    TIME_PATTERN.test(event.hora_fin) &&
    event.hora_fin <= event.hora_inicio
  ) {
    errors.push('La hora de finalización debe ser posterior a la hora de inicio.');
  }
  if (!event.lugar || event.lugar.length > 255)
    errors.push('Lugar es obligatorio (máximo 255 caracteres).');
  if (!event.organizador || event.organizador.length > 255) {
    errors.push('Organizador es obligatorio (máximo 255 caracteres).');
  }
  if (event.descripcion.length > 5000) errors.push('Descripción no puede superar 5000 caracteres.');

  return { evento: event, errores: errors };
}

function validateTemplateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return ['La configuración de plantilla debe ser un objeto JSON.'];
  }

  const errors = [];
  const keys = Object.keys(config);
  if (!keys.length) errors.push('Configura al menos una variable de la plantilla.');
  if (!Object.hasOwn(config, 'qr_verificacion')) {
    errors.push('La plantilla debe incluir la variable qr_verificacion.');
  }

  keys.forEach((key) => {
    const field = config[key];
    if (!CERTIFICATE_VARIABLES.has(key)) {
      errors.push(`La variable "${key}" no está disponible.`);
      return;
    }
    if (!field || typeof field !== 'object' || Array.isArray(field)) {
      errors.push(`La configuración de "${key}" debe ser un objeto.`);
      return;
    }
    const { x, y } = field;
    if (!Number.isFinite(Number(x)) || Number(x) < 0 || Number(x) > 10000) {
      errors.push(`La coordenada x de "${key}" debe estar entre 0 y 10000.`);
    }
    if (!Number.isFinite(Number(y)) || Number(y) < 0 || Number(y) > 10000) {
      errors.push(`La coordenada y de "${key}" debe estar entre 0 y 10000.`);
    }
    if (
      field.page !== undefined &&
      (!Number.isInteger(Number(field.page)) || Number(field.page) < 0)
    ) {
      errors.push(`La página de "${key}" debe ser un entero igual o mayor que 0.`);
    }

    if (key === 'qr_verificacion') {
      if (field.type !== 'qr') errors.push('qr_verificacion debe tener type "qr".');
      if (
        !Number.isFinite(Number(field.width)) ||
        Number(field.width) < 24 ||
        Number(field.width) > 500
      ) {
        errors.push('El ancho del QR debe estar entre 24 y 500 puntos.');
      }
      return;
    }

    if (field.type !== undefined && field.type !== 'text') {
      errors.push(`El tipo de "${key}" debe ser "text".`);
    }
    if (
      field.fontSize !== undefined &&
      (!Number.isFinite(Number(field.fontSize)) ||
        Number(field.fontSize) < 6 ||
        Number(field.fontSize) > 96)
    ) {
      errors.push(`El tamaño de fuente de "${key}" debe estar entre 6 y 96.`);
    }
    if (field.align !== undefined && !['left', 'center', 'right'].includes(field.align)) {
      errors.push(`La alineación de "${key}" debe ser left, center o right.`);
    }
    if (field.color !== undefined && !/^#[0-9a-f]{6}$/i.test(String(field.color))) {
      errors.push(`El color de "${key}" debe usar formato hexadecimal #RRGGBB.`);
    }
  });

  return errors;
}

function hasFileSignature(file, kind) {
  if (!file?.buffer || !Buffer.isBuffer(file.buffer)) return false;
  if (kind === 'pdf') return file.buffer.subarray(0, 5).toString() === '%PDF-';
  if (kind === 'png')
    return file.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (kind === 'jpeg')
    return file.buffer[0] === 0xff && file.buffer[1] === 0xd8 && file.buffer[2] === 0xff;
  if (kind === 'xlsx')
    return file.buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  return false;
}

function isSafeXlsxArchive(buffer) {
  if (
    !Buffer.isBuffer(buffer) ||
    !buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  ) {
    return false;
  }
  const searchStart = Math.max(0, buffer.length - 65557);
  let endRecord = -1;
  for (let index = buffer.length - 22; index >= searchStart; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      endRecord = index;
      break;
    }
  }
  if (endRecord < 0) return false;

  const entryCount = buffer.readUInt16LE(endRecord + 10);
  const directorySize = buffer.readUInt32LE(endRecord + 12);
  const directoryOffset = buffer.readUInt32LE(endRecord + 16);
  if (
    entryCount < 1 ||
    entryCount > 256 ||
    entryCount === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset + directorySize > endRecord
  ) {
    return false;
  }

  let offset = directoryOffset;
  let totalUncompressedBytes = 0;
  const forbiddenParts = ['xl/vbaproject.bin', 'xl/externallinks/'];
  for (let entry = 0; entry < entryCount; entry += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) return false;
    const flags = buffer.readUInt16LE(offset + 8);
    const uncompressedBytes = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const entryEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (
      flags & 1 ||
      uncompressedBytes === 0xffffffff ||
      entryEnd > directoryOffset + directorySize
    ) {
      return false;
    }
    const entryName = buffer
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString('utf8')
      .toLowerCase();
    if (forbiddenParts.some((part) => entryName.includes(part))) return false;
    totalUncompressedBytes += uncompressedBytes;
    if (totalUncompressedBytes > 30 * 1024 * 1024) return false;
    offset = entryEnd;
  }
  return offset === directoryOffset + directorySize;
}

async function buildParticipantTemplateBuffer() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Participantes');
  sheet.addRow(PARTICIPANT_HEADERS);
  sheet.getRow(1).font = { bold: true };
  sheet.columns = [
    { width: 32 },
    { width: 24, style: { numFmt: '@' } },
    { width: 36 },
    { width: 32 },
    { width: 32 },
  ];
  sheet.getColumn(2).numFmt = '@';
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function previewParticipantWorkbook(buffer) {
  if (!isSafeXlsxArchive(buffer)) {
    throw new Error('El archivo Excel está incompleto o no es seguro para procesar.');
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 1) {
    return { filas: [], errores_estructura: ['El archivo no contiene una hoja de participantes.'] };
  }

  const actualHeaders = PARTICIPANT_HEADERS.map((_, index) =>
    normalizeHeader(getCellText(sheet.getRow(1).getCell(index + 1).value))
  );
  const expectedHeaders = PARTICIPANT_HEADERS.map(normalizeHeader);
  if (
    actualHeaders.length !== expectedHeaders.length ||
    expectedHeaders.some((header, index) => actualHeaders[index] !== header) ||
    sheet.getRow(1).cellCount !== PARTICIPANT_HEADERS.length
  ) {
    return {
      filas: [],
      errores_estructura: [`Los encabezados deben ser: ${PARTICIPANT_HEADERS.join(', ')}.`],
    };
  }

  if (sheet.rowCount > 2001) {
    return {
      filas: [],
      errores_estructura: ['El archivo supera el máximo de 2000 participantes.'],
    };
  }

  const filas = [];
  const firstRowByDocument = new Map();
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const values = PARTICIPANT_HEADERS.map((_, index) => row.getCell(index + 1).value);
    if (values.every((value) => value === null || value === undefined || value === '')) continue;

    const documentCell = values[1];
    const rawDocument = getCellText(documentCell);
    const validation = validateParticipant({
      nombre: getCellText(values[0]),
      documento: rawDocument,
      correo: getCellText(values[2]),
      facultad: getCellText(values[3]),
      laboratorio: getCellText(values[4]),
    });
    if (typeof documentCell === 'number') {
      validation.errores.push(
        'El documento se guardó como número y podría haber perdido ceros iniciales. Cambie la celda a Texto e importe nuevamente.'
      );
    }

    const normalizedDocument = validation.participante.documento_normalizado;
    if (normalizedDocument && firstRowByDocument.has(normalizedDocument)) {
      validation.errores.push(
        `Documento duplicado en las filas ${firstRowByDocument.get(normalizedDocument)} y ${rowNumber}.`
      );
    } else if (normalizedDocument) {
      firstRowByDocument.set(normalizedDocument, rowNumber);
    }

    filas.push({
      fila: rowNumber,
      participante: validation.participante,
      errores: validation.errores,
    });
  }

  return { filas, errores_estructura: [] };
}

function hexToRgb(value) {
  const normalized = String(value || '#000000').replace('#', '');
  return rgb(
    Number.parseInt(normalized.slice(0, 2), 16) / 255,
    Number.parseInt(normalized.slice(2, 4), 16) / 255,
    Number.parseInt(normalized.slice(4, 6), 16) / 255
  );
}

async function generateCertificatePdf({ templateBuffer, templateConfig, values, verificationUrl }) {
  const configErrors = validateTemplateConfig(templateConfig);
  if (configErrors.length) throw new Error(configErrors.join(' '));

  const document = await PDFDocument.load(templateBuffer);
  const font = await document.embedFont(StandardFonts.Helvetica);

  for (const [key, field] of Object.entries(templateConfig)) {
    const pageIndex = Number(field.page || 0);
    const page = document.getPages()[pageIndex];
    if (!page) throw new Error(`La página configurada para "${key}" no existe en la plantilla.`);

    if (key === 'qr_verificacion') {
      const qrBuffer = await QRCode.toBuffer(verificationUrl, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 512,
      });
      const qrImage = await document.embedPng(qrBuffer);
      const width = Number(field.width);
      if (Number(field.x) + width > page.getWidth() || Number(field.y) + width > page.getHeight()) {
        throw new Error('La posición del QR está fuera de los límites de la página configurada.');
      }
      page.drawImage(qrImage, {
        x: Number(field.x),
        y: Number(field.y),
        width,
        height: width,
      });
      continue;
    }

    const text = String(values?.[key] ?? '');
    if (!text) continue;
    const fontSize = Number(field.fontSize || 18);
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    const x = Number(field.x);
    const drawX =
      field.align === 'center' ? x - textWidth / 2 : field.align === 'right' ? x - textWidth : x;
    if (drawX < 0 || drawX + textWidth > page.getWidth() || Number(field.y) > page.getHeight()) {
      throw new Error(
        `El texto configurado para "${key}" queda fuera de los límites de la página.`
      );
    }
    page.drawText(text, {
      x: drawX,
      y: Number(field.y),
      size: fontSize,
      font,
      color: hexToRgb(field.color),
      maxWidth: page.getWidth() - drawX,
    });
  }

  return Buffer.from(await document.save());
}

async function validatePdfTemplate(buffer) {
  const document = await PDFDocument.load(buffer);
  const pages = document.getPages();
  if (!pages.length) throw new Error('La plantilla PDF debe contener al menos una página.');
  return pages.length;
}

module.exports = {
  CERTIFICATE_VARIABLES,
  EMAIL_PATTERN,
  PARTICIPANT_HEADERS,
  buildParticipantTemplateBuffer,
  generateCertificatePdf,
  hasFileSignature,
  isSafeXlsxArchive,
  normalizeDocument,
  previewParticipantWorkbook,
  validatePdfTemplate,
  validateEventInput,
  validateParticipant,
  validateTemplateConfig,
};
