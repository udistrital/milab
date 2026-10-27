const test = require('node:test');
const assert = require('node:assert/strict');
const { inflateSync } = require('node:zlib');
const ExcelJS = require('exceljs');
const { PDFDocument } = require('pdf-lib');

const {
  HISTORICAL_PARTICIPATION_HEADERS,
  PARTICIPANT_EXPORT_HEADERS,
  buildHistoricalParticipationTemplateBuffer,
  buildParticipantTemplateBuffer,
  generateCertificatePdf,
  hasFileSignature,
  isSafeXlsxArchive,
  normalizeDocument,
  previewHistoricalParticipationWorkbook,
  previewParticipantWorkbook,
  validateEventInput,
  validateParticipant,
  validatePdfTemplate,
  validateTemplateConfig,
} = require('../../../src/libs/encuentros');

const certificateConfig = {
  nombre: { x: 250, y: 200, fontSize: 20, align: 'center' },
  qr_verificacion: { x: 20, y: 20, width: 64, type: 'qr' },
};

test('normalizes document identity while preserving leading zeroes', () => {
  assert.equal(normalizeDocument(' 00.123-AB '), '00123AB');
  assert.equal(
    validateParticipant({
      nombre: 'Persona de prueba',
      documento: '000123',
      correo: 'persona@example.edu',
      rol: 'Docente',
      facultad: 'Ingeniería',
      laboratorio: 'Lab 1',
    }).participante.documento,
    '000123'
  );
});

test('validates event fields, strict calendar dates, and ordered times', () => {
  assert.deepEqual(
    validateEventInput({
      nombre: 'Encuentro académico',
      fecha: '2026-10-20',
      hora_inicio: '09:00',
      hora_fin: '10:00',
      lugar: 'Sede',
      organizador: 'MiLab',
    }).errores,
    []
  );

  const invalid = validateEventInput({
    nombre: '',
    fecha: '2026-02-30',
    hora_inicio: '12:00',
    hora_fin: '11:59',
    lugar: '',
    organizador: '',
  });
  assert.ok(invalid.errores.length >= 5);
});

test('validates participant contact information and required fields', () => {
  const result = validateParticipant({
    nombre: '',
    documento: '',
    correo: 'correo-invalido',
    rol: '',
    facultad: '',
    laboratorio: '',
  });
  assert.equal(result.errores.length, 6);
});

test('requires a QR verification position in valid template configuration', () => {
  assert.deepEqual(validateTemplateConfig(certificateConfig), []);
  assert.ok(
    validateTemplateConfig({ nombre: { x: 10, y: 20 } }).some((error) =>
      error.includes('qr_verificacion')
    )
  );
  assert.ok(
    validateTemplateConfig({
      qr_verificacion: { type: 'qr', x: -1, y: 0, width: 70 },
    }).some((error) => error.includes('coordenada x'))
  );
});

test('recognizes PDF, image, and XLSX file signatures', () => {
  assert.equal(hasFileSignature({ buffer: Buffer.from('%PDF-1.7') }, 'pdf'), true);
  assert.equal(
    hasFileSignature({ buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) }, 'png'),
    true
  );
  assert.equal(hasFileSignature({ buffer: Buffer.from([0xff, 0xd8, 0xff]) }, 'jpeg'), true);
  assert.equal(hasFileSignature({ buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]) }, 'xlsx'), true);
  assert.equal(hasFileSignature({ buffer: Buffer.from('not a PDF') }, 'pdf'), false);
});

test('creates an Excel participant template with the expected headings', async () => {
  const template = await buildParticipantTemplateBuffer();
  assert.equal(isSafeXlsxArchive(template), true);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(template);
  assert.deepEqual(workbook.worksheets[0].getRow(1).values.slice(1), [
    'Nombre completo',
    'Número de documento',
    'Correo electrónico',
    'Cargo',
    'Facultad',
    'Unidad Académica de Laboratorio (UAL)',
  ]);
  assert.equal(workbook.worksheets[0].getColumn(2).numFmt, '@');
  assert.deepEqual((await previewParticipantWorkbook(template)).errores_estructura, []);
  assert.equal(isSafeXlsxArchive(Buffer.from([0x50, 0x4b, 0x03, 0x04])), false);
});

test('previews historical participation files with timezone-aware attendance', async () => {
  const template = await buildHistoricalParticipationTemplateBuffer();
  const templateWorkbook = new ExcelJS.Workbook();
  await templateWorkbook.xlsx.load(template);
  assert.deepEqual(
    templateWorkbook.worksheets[0].getRow(1).values.slice(1),
    PARTICIPANT_EXPORT_HEADERS
  );
  assert.equal(templateWorkbook.worksheets[0].getColumn(2).numFmt, '@');
  assert.deepEqual((await previewHistoricalParticipationWorkbook(template)).errores_estructura, []);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Participaciones');
  sheet.addRow(HISTORICAL_PARTICIPATION_HEADERS);
  sheet.addRow([
    'Persona Uno',
    '0000123',
    'uno@example.edu',
    'Docente',
    'Ingeniería',
    'Lab 1',
    '2026-10-20T09:00:00-05:00',
    '2026-10-20T10:00:00-05:00',
  ]);
  sheet.addRow([
    'Persona Dos',
    '0000124',
    'dos@example.edu',
    'Docente',
    'Ingeniería',
    'Lab 2',
    '2026-02-30T09:00:00-05:00',
    '2026-10-20T08:00:00-05:00',
  ]);

  const preview = await previewHistoricalParticipationWorkbook(
    Buffer.from(await workbook.xlsx.writeBuffer())
  );
  assert.deepEqual(preview.errores_estructura, []);
  assert.equal(preview.filas.length, 2);
  assert.equal(preview.filas[0].entrada_en, '2026-10-20T14:00:00.000Z');
  assert.equal(preview.filas[0].salida_en, '2026-10-20T15:00:00.000Z');
  assert.deepEqual(preview.filas[0].errores, []);
  assert.match(preview.filas[1].errores.join(' '), /Entrada: La fecha u hora no es válida/);
  assert.match(
    preview.filas[1].errores.join(' '),
    /No se puede registrar una salida sin una entrada/
  );
});

test('previews participant exports for migration with registration and attendance timestamps', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Participantes');
  sheet.addRow(PARTICIPANT_EXPORT_HEADERS);
  sheet.addRow([
    'Persona Migrada',
    '0000123',
    'migrada@example.edu',
    'Docente',
    'Ingeniería',
    'Lab 1',
    new Date('2026-10-01T14:00:00.000Z'),
    new Date('2026-10-20T14:00:00.000Z'),
    new Date('2026-10-20T16:00:00.000Z'),
    'completada',
    'TEST-CERT-123',
    'enviado',
    'valido',
    new Date('2026-10-20T17:00:00.000Z'),
    new Date('2026-10-20T17:01:00.000Z'),
    true,
  ]);

  const preview = await previewHistoricalParticipationWorkbook(
    Buffer.from(await workbook.xlsx.writeBuffer())
  );
  assert.deepEqual(preview.errores_estructura, []);
  assert.equal(preview.filas.length, 1);
  assert.equal(preview.filas[0].fecha_inscripcion, '2026-10-01T14:00:00.000Z');
  assert.equal(preview.filas[0].entrada_en, '2026-10-20T14:00:00.000Z');
  assert.equal(preview.filas[0].salida_en, '2026-10-20T16:00:00.000Z');
  assert.deepEqual(preview.filas[0].errores, []);
});

test('accepts the previous Laboratorio header as a UAL alias', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Participantes');
  sheet.addRow([
    'Nombre completo',
    'Número de documento',
    'Correo electrónico',
    'Cargo',
    'Facultad',
  ]);
  sheet.getRow(1).getCell(6).value = 'Laboratorio';

  const preview = await previewParticipantWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()));
  assert.deepEqual(preview.errores_estructura, []);
});

test('previews valid, duplicate, and numeric-document spreadsheet rows', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Participantes');
  sheet.addRow([
    'Nombre completo',
    'Número de documento',
    'Correo electrónico',
    'Cargo',
    'Facultad',
    'Unidad Académica de Laboratorio (UAL)',
  ]);
  sheet.addRow(['Persona Uno', '0000123', 'uno@example.edu', 'Docente', 'Ingeniería', 'Lab 1']);
  sheet.addRow(['Persona Dos', '0000123', 'dos@example.edu', 'Estudiante', 'Ingeniería', 'Lab 2']);
  sheet.addRow(['Persona Tres', 9876, 'tres@example.edu', 'Monitor', 'Ingeniería', 'Lab 3']);
  sheet.getRow(4).getCell(2).numFmt = '00000000';
  sheet.addRow([
    'Persona Cuatro',
    1234567890123456,
    'cuatro@example.edu',
    'Monitor',
    'Ingeniería',
    'Lab 4',
  ]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

  const preview = await previewParticipantWorkbook(buffer);
  assert.deepEqual(preview.errores_estructura, []);
  assert.equal(preview.filas.length, 4);
  assert.equal(preview.filas[0].participante.documento, '0000123');
  assert.equal(preview.filas[0].participante.rol, 'Docente');
  assert.match(preview.filas[1].errores.join(' '), /duplicado/i);
  assert.equal(preview.filas[2].participante.documento, '00009876');
  assert.deepEqual(preview.filas[2].errores, []);
  assert.match(preview.filas[2].advertencias.join(' '), /ceros iniciales/i);
  assert.match(preview.filas[3].errores.join(' '), /rango de precisión segura/i);
});

test('validates and personalizes a PDF using configured text and QR coordinates', async () => {
  const template = await PDFDocument.create();
  template.addPage([500, 300]);
  const templateBuffer = Buffer.from(await template.save());
  assert.equal(await validatePdfTemplate(templateBuffer), 1);

  const output = await generateCertificatePdf({
    templateBuffer,
    templateConfig: certificateConfig,
    values: { nombre: 'Participante áéíóúñü de prueba' },
    verificationUrl: 'https://example.edu/milab/encuentros/verificar/abc',
  });
  const generatedPdf = await PDFDocument.load(output);
  assert.equal(generatedPdf.getPageCount(), 1);
  assert.ok(output.length > templateBuffer.length);
  const contentStream = generatedPdf.context.lookup(generatedPdf.getPage(0).node.Contents().get(0));
  const pageContent = inflateSync(Buffer.from(contentStream.getContents())).toString('latin1');
  const encodedUppercaseName = Buffer.from('PARTICIPANTE ÁÉÍÓÚÑÜ DE PRUEBA', 'latin1')
    .toString('hex')
    .toUpperCase();
  assert.ok(pageContent.includes(encodedUppercaseName));
  await assert.rejects(
    generateCertificatePdf({
      templateBuffer,
      templateConfig: { ...certificateConfig, nombre: { x: 1000, y: 200 } },
      values: { nombre: 'Persona' },
      verificationUrl: 'https://example.edu/check',
    }),
    /fuera de los límites/
  );
});
