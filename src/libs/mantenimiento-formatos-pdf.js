const fs = require('node:fs');
const path = require('node:path');
const PDFDocument = require('pdfkit');

const FONT_REGULAR = path.join(__dirname, '..', 'public', 'fonts', 'NotoSansJP-Regular.otf');
const FONT_BOLD = path.join(__dirname, '..', 'public', 'fonts', 'NotoSansJP-Bold.otf');
const ESCUDO_PATH = path.join(
  __dirname,
  '..',
  'public',
  'img',
  'Logo_Escudo_Acreditacion_Horizontal.png'
);

const MESES = [
  { codigo: 'enero', etiqueta: 'Enero' },
  { codigo: 'febrero', etiqueta: 'Febrero' },
  { codigo: 'marzo', etiqueta: 'Marzo' },
  { codigo: 'abril', etiqueta: 'Abril' },
  { codigo: 'mayo', etiqueta: 'Mayo' },
  { codigo: 'junio', etiqueta: 'Junio' },
  { codigo: 'julio', etiqueta: 'Julio' },
  { codigo: 'agosto', etiqueta: 'Agosto' },
  { codigo: 'septiembre', etiqueta: 'Septiembre' },
  { codigo: 'octubre', etiqueta: 'Octubre' },
  { codigo: 'noviembre', etiqueta: 'Noviembre' },
  { codigo: 'diciembre', etiqueta: 'Diciembre' },
];

function setFont(doc, variant) {
  const requested = variant === 'bold' ? FONT_BOLD : FONT_REGULAR;
  const fallback = variant === 'bold' ? 'Helvetica-Bold' : 'Helvetica';
  try {
    if (fs.existsSync(requested)) {
      doc.font(requested);
      return;
    }
  } catch {
    // Si la fuente no está disponible se usa la de respaldo.
  }
  doc.font(fallback);
}

function formatDate(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (part) => String(part).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function textValue(value) {
  if (value === null || value === undefined || value === '') return 'No hay información';
  return String(value);
}

function monthsFromJson(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  return [];
}

function registroFromJson(value) {
  if (value && typeof value === 'object') return value;
  return {};
}

function basePdf(res, fileName, options = {}) {
  const doc = new PDFDocument({
    size: 'A4',
    layout: options.layout || 'portrait',
    margin: 30,
    bufferPages: true,
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
  doc.pipe(res);
  return doc;
}

function drawHeader(doc, title, code, approvalDate) {
  const left = doc.page.margins.left;
  const top = doc.page.margins.top;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const leftWidth = 90;
  const rightWidth = 180;
  const centerWidth = width - leftWidth - rightWidth;
  const palette = { border: '#4b5563', gray: '#d1d5db', text: '#111827', white: '#ffffff' };

  doc
    .save()
    .lineWidth(0.8)
    .strokeColor(palette.border)
    .rect(left, top, width, 56)
    .stroke()
    .restore();
  doc
    .save()
    .lineWidth(0.8)
    .strokeColor(palette.border)
    .moveTo(left + leftWidth, top)
    .lineTo(left + leftWidth, top + 56)
    .stroke()
    .restore();
  doc
    .save()
    .lineWidth(0.8)
    .strokeColor(palette.border)
    .moveTo(left + leftWidth + centerWidth, top)
    .lineTo(left + leftWidth + centerWidth, top + 56)
    .stroke()
    .restore();
  [18, 36].forEach((offset) => {
    doc
      .save()
      .lineWidth(0.8)
      .strokeColor(palette.border)
      .moveTo(left + leftWidth, top + offset)
      .lineTo(left + width, top + offset)
      .stroke()
      .restore();
  });

  if (fs.existsSync(ESCUDO_PATH)) {
    doc.image(ESCUDO_PATH, left + 6, top + 6, { fit: [leftWidth - 12, 44], align: 'center' });
  }

  setFont(doc, 'bold');
  doc
    .fontSize(9)
    .fillColor(palette.text)
    .text(title, left + leftWidth + 4, top + 6, {
      width: centerWidth - 8,
      align: 'center',
    });
  setFont(doc, 'regular');
  doc.fontSize(6.8).text('Macroproceso: Gestión de Recursos', left + leftWidth + 4, top + 23, {
    width: centerWidth - 8,
    align: 'center',
  });
  doc.text('Proceso: Gestión y Desarrollo del Talento Humano', left + leftWidth + 4, top + 40, {
    width: centerWidth - 8,
    align: 'center',
  });

  setFont(doc, 'regular');
  doc.fontSize(6.5).text(`Código: ${code}`, left + leftWidth + centerWidth + 6, top + 6, {
    width: rightWidth - 12,
  });
  doc.text('Versión: 01', left + leftWidth + centerWidth + 6, top + 24, { width: rightWidth - 12 });
  doc.text(`Fecha Aprobación: ${approvalDate}`, left + leftWidth + centerWidth + 6, top + 42, {
    width: rightWidth - 12,
  });
  doc.y = top + 66;
}

function drawFooter(doc) {
  const range = doc.bufferedPageRange();
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
    doc.switchToPage(pageIndex);
    setFont(doc, 'regular');
    doc
      .fontSize(8)
      .fillColor('#4b5563')
      .text(`Página ${pageIndex + 1} de ${range.count}`, left, doc.page.height - 20, {
        width,
        align: 'right',
      });
  }
}

function drawCell(doc, x, y, width, height, text, opts = {}) {
  const fill = opts.fill || '#ffffff';
  doc
    .save()
    .lineWidth(0.7)
    .fillColor(fill)
    .strokeColor('#4b5563')
    .rect(x, y, width, height)
    .fillAndStroke()
    .restore();
  setFont(doc, opts.bold ? 'bold' : 'regular');
  doc
    .fontSize(opts.fontSize || 7.2)
    .fillColor('#111827')
    .text(String(text || ''), x + 3, y + 3, {
      width: width - 6,
      align: opts.align || 'left',
    });
}

function commonMaintenanceContext(hojaVida, equipo, mantenimiento) {
  return {
    nombreEquipo: textValue(hojaVida.nombre_equipo || equipo.nombre),
    codigoInventario: textValue(hojaVida.codigo_inventario),
    area: textValue(hojaVida.dependencia || equipo.facultad || equipo.laboratorio),
    facultad: textValue(equipo.facultad || hojaVida.dependencia),
    responsableArea: textValue(hojaVida.responsable),
    supervisor: textValue(hojaVida.supervisor),
    cantidad: textValue(hojaVida.cantidad),
    fecha: formatDate(mantenimiento.fecha_realizacion),
    item: textValue(mantenimiento.item),
    responsable: textValue(mantenimiento.responsable),
    proveedor: textValue(
      mantenimiento.datos_empresa_contratada || hojaVida.proveedor || 'No hay información'
    ),
  };
}

function sendMantenimientoCorrectivoPdf(res, hojaVida, equipo, mantenimiento) {
  const doc = basePdf(
    res,
    `Mantenimiento_Correctivo_${mantenimiento.id || hojaVida.codigo_inventario || hojaVida.id}.pdf`,
    { layout: 'landscape' }
  );
  drawHeader(
    doc,
    'REGISTRO DE MANTENIMIENTO CORRECTIVO DE EQUIPOS O MÁQUINAS',
    'GDTH-PG-003-FR-026',
    '10/08/2022'
  );
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const ctx = commonMaintenanceContext(hojaVida, equipo, mantenimiento);
  const rowY = doc.y;
  const headWidths = [80, 80, 120, width - 280];
  drawCell(doc, left, rowY, headWidths[0], 18, 'Facultad', { bold: true, fill: '#d1d5db' });
  drawCell(doc, left + headWidths[0], rowY, headWidths[1], 18, 'Área', {
    bold: true,
    fill: '#d1d5db',
  });
  drawCell(doc, left + headWidths[0] + headWidths[1], rowY, headWidths[2], 18, 'Responsable', {
    bold: true,
    fill: '#d1d5db',
  });
  drawCell(
    doc,
    left + headWidths[0] + headWidths[1] + headWidths[2],
    rowY,
    headWidths[3],
    18,
    'Auxiliar o supervisor responsable',
    {
      bold: true,
      fill: '#d1d5db',
    }
  );
  drawCell(doc, left, rowY + 18, headWidths[0], 18, ctx.facultad);
  drawCell(doc, left + headWidths[0], rowY + 18, headWidths[1], 18, ctx.area);
  drawCell(
    doc,
    left + headWidths[0] + headWidths[1],
    rowY + 18,
    headWidths[2],
    18,
    ctx.responsableArea
  );
  drawCell(
    doc,
    left + headWidths[0] + headWidths[1] + headWidths[2],
    rowY + 18,
    headWidths[3],
    18,
    ctx.supervisor
  );

  const secondY = rowY + 36;
  drawCell(doc, left, secondY, 140, 18, 'Fecha', { bold: true, fill: '#d1d5db' });
  drawCell(doc, left + 140, secondY, 150, 18, ctx.fecha);
  drawCell(doc, left + 290, secondY, 140, 18, 'Cargo', { bold: true, fill: '#d1d5db' });
  drawCell(
    doc,
    left + 430,
    secondY,
    width - 430,
    18,
    textValue(mantenimiento.cargo_diligenciado_por)
  );

  doc.y = secondY + 28;
  const cols = [90, 78, 95, 120, 95, 60, 80, 60];
  const labels = [
    'Nombre del equipo',
    'Código de inventario',
    'Descripción de la falla',
    'Descripción de la reparación ejecutada',
    'Responsable de verificar',
    'Firma',
    'Proveedor',
    'Firma',
  ];
  let x = left;
  labels.forEach((label, index) => {
    drawCell(doc, x, doc.y, cols[index], 34, label, {
      bold: true,
      fill: '#d1d5db',
      align: 'center',
    });
    x += cols[index];
  });
  const values = [
    ctx.nombreEquipo,
    ctx.codigoInventario,
    textValue(mantenimiento.descripcion_falla),
    textValue(mantenimiento.especificaciones_mantenimiento),
    textValue(mantenimiento.responsable_verificar),
    textValue(mantenimiento.firma_responsable_verificar),
    ctx.proveedor,
    textValue(mantenimiento.firma_proveedor),
  ];
  x = left;
  const dataY = doc.y + 34;
  values.forEach((value, index) => {
    drawCell(doc, x, dataY, cols[index], 72, value);
    x += cols[index];
  });
  drawFooter(doc);
  doc.end();
}

function sendCronogramaMantenimientoPdf(res, hojaVida, equipo, mantenimiento) {
  const doc = basePdf(
    res,
    `Cronograma_Mantenimiento_${mantenimiento.id || hojaVida.codigo_inventario || hojaVida.id}.pdf`,
    { layout: 'landscape' }
  );
  drawHeader(doc, 'CRONOGRAMA DE MANTENIMIENTO', 'GDTH-PG-003-FR-028', '10/09/2022');
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const ctx = commonMaintenanceContext(hojaVida, equipo, mantenimiento);
  const mesesProgramados = monthsFromJson(mantenimiento.meses_programados);
  const topY = doc.y;
  const infoWidths = [100, 100, 120, width - 320];
  const infoLabels = [
    'Facultad',
    'Área',
    'Responsable del área',
    'Supervisor o auxiliar responsable',
  ];
  const infoValues = [ctx.facultad, ctx.area, ctx.responsableArea, ctx.supervisor];
  let x = left;
  infoLabels.forEach((label, index) => {
    drawCell(doc, x, topY, infoWidths[index], 18, label, {
      bold: true,
      fill: '#d1d5db',
      align: 'center',
    });
    x += infoWidths[index];
  });
  x = left;
  infoValues.forEach((value, index) => {
    drawCell(doc, x, topY + 18, infoWidths[index], 18, value);
    x += infoWidths[index];
  });
  drawCell(doc, left, topY + 36, 110, 18, 'Fecha', { bold: true, fill: '#d1d5db' });
  drawCell(doc, left + 110, topY + 36, 160, 18, ctx.fecha);
  drawCell(doc, left + 270, topY + 36, 160, 18, 'Encargado de su elaboración', {
    bold: true,
    fill: '#d1d5db',
  });
  drawCell(
    doc,
    left + 430,
    topY + 36,
    width - 430,
    18,
    textValue(mantenimiento.encargado_elaboracion)
  );

  const tableY = topY + 64;
  const baseCols = [100, 80, 150];
  const monthWidth = 15;
  const tailCols = [65, 55, 45, width - (100 + 80 + 150 + monthWidth * 12 + 65 + 55 + 45)];
  x = left;
  ['Nombre de la máquina/equipo', 'Código de inventario', 'Descripción de la actividad'].forEach(
    (label, index) => {
      drawCell(doc, x, tableY, baseCols[index], 34, label, {
        bold: true,
        fill: '#d1d5db',
        align: 'center',
      });
      x += baseCols[index];
    }
  );
  MESES.forEach((mes) => {
    drawCell(doc, x, tableY, monthWidth, 34, mes.etiqueta.slice(0, 3), {
      bold: true,
      fill: '#d1d5db',
      align: 'center',
      fontSize: 6.2,
    });
    x += monthWidth;
  });
  ['Responsable', 'Verificado por', 'Firma', 'Observaciones'].forEach((label, index) => {
    drawCell(doc, x, tableY, tailCols[index], 34, label, {
      bold: true,
      fill: '#d1d5db',
      align: 'center',
    });
    x += tailCols[index];
  });

  const dataY = tableY + 34;
  x = left;
  [ctx.nombreEquipo, ctx.codigoInventario, textValue(mantenimiento.descripcion_actividad)].forEach(
    (value, index) => {
      drawCell(doc, x, dataY, baseCols[index], 56, value);
      x += baseCols[index];
    }
  );
  MESES.forEach((mes) => {
    drawCell(doc, x, dataY, monthWidth, 56, mesesProgramados.includes(mes.codigo) ? 'X' : '', {
      align: 'center',
    });
    x += monthWidth;
  });
  [
    ctx.responsable,
    textValue(mantenimiento.verificado_por),
    textValue(mantenimiento.firma_verificacion),
    textValue(mantenimiento.observaciones_generales),
  ].forEach((value, index) => {
    drawCell(doc, x, dataY, tailCols[index], 56, value);
    x += tailCols[index];
  });
  drawFooter(doc);
  doc.end();
}

function sendMantenimientoPreventivoPdf(res, hojaVida, equipo, mantenimiento) {
  const doc = basePdf(
    res,
    `Mantenimiento_Preventivo_${mantenimiento.id || hojaVida.codigo_inventario || hojaVida.id}.pdf`,
    { layout: 'landscape' }
  );
  drawHeader(
    doc,
    'FORMATO: MANTENIMIENTO PREVENTIVO DE EQUIPOS O MÁQUINAS',
    'GDTH-PG-003-FR-029',
    '10/09/2022'
  );
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const ctx = commonMaintenanceContext(hojaVida, equipo, mantenimiento);
  const registro = registroFromJson(mantenimiento.registro_mantenimiento);
  const infoY = doc.y;
  drawCell(doc, left, infoY, 130, 18, 'Diligenciado por', { bold: true, fill: '#d1d5db' });
  drawCell(doc, left + 130, infoY, 130, 18, textValue(mantenimiento.diligenciado_por));
  drawCell(doc, left + 260, infoY, 110, 18, 'Cargo', { bold: true, fill: '#d1d5db' });
  drawCell(doc, left + 370, infoY, 120, 18, textValue(mantenimiento.cargo_diligenciado_por));
  drawCell(doc, left + 490, infoY, 120, 18, 'Responsable del área', {
    bold: true,
    fill: '#d1d5db',
  });
  drawCell(doc, left + 610, infoY, width - 610, 18, ctx.responsableArea);

  drawCell(doc, left, infoY + 18, 130, 18, 'Fecha', { bold: true, fill: '#d1d5db' });
  drawCell(doc, left + 130, infoY + 18, 130, 18, ctx.fecha);
  drawCell(doc, left + 260, infoY + 18, 110, 18, 'Sede', { bold: true, fill: '#d1d5db' });
  drawCell(doc, left + 370, infoY + 18, 120, 18, textValue(mantenimiento.sede));
  drawCell(doc, left + 490, infoY + 18, 120, 18, 'Área específica', {
    bold: true,
    fill: '#d1d5db',
  });
  drawCell(doc, left + 610, infoY + 18, width - 610, 18, textValue(mantenimiento.area_especifica));

  const tableY = infoY + 48;
  const cols = [72, 54, 28, 84];
  const monthMini = 5;
  const tailCols = [
    54,
    36,
    90,
    50,
    width - (72 + 54 + 28 + 84 + monthMini * 4 * 12 + 54 + 36 + 90 + 50),
  ];
  let x = left;
  ['Equipo / Máquina', 'Código inv.', 'Cant.', 'Descripción de la acción de verificación'].forEach(
    (label, index) => {
      drawCell(doc, x, tableY, cols[index], 34, label, {
        bold: true,
        fill: '#d1d5db',
        align: 'center',
        fontSize: 6.4,
      });
      x += cols[index];
    }
  );
  MESES.forEach((mes) => {
    const startX = x;
    drawCell(doc, startX, tableY, monthMini * 4, 18, mes.etiqueta.slice(0, 3), {
      bold: true,
      fill: '#d1d5db',
      align: 'center',
      fontSize: 6.1,
    });
    [1, 2, 3, 4].forEach((slot, slotIndex) => {
      drawCell(doc, startX + slotIndex * monthMini, tableY + 18, monthMini, 16, String(slot), {
        bold: true,
        fill: '#d1d5db',
        align: 'center',
        fontSize: 6,
      });
    });
    x += monthMini * 4;
  });
  ['Responsable', 'Cumple', 'Justificación ausencia', 'Auxiliar', 'Firma'].forEach(
    (label, index) => {
      drawCell(doc, x, tableY, tailCols[index], 34, label, {
        bold: true,
        fill: '#d1d5db',
        align: 'center',
        fontSize: 6.2,
      });
      x += tailCols[index];
    }
  );

  const rowY = tableY + 34;
  x = left;
  [
    ctx.nombreEquipo,
    ctx.codigoInventario,
    ctx.cantidad,
    textValue(mantenimiento.descripcion_accion_verificacion),
  ].forEach((value, index) => {
    drawCell(doc, x, rowY, cols[index], 60, value, { fontSize: 6.7 });
    x += cols[index];
  });
  MESES.forEach((mes) => {
    const startX = x;
    [0, 1, 2, 3].forEach((slotIndex) => {
      const marcado = Boolean(registro[mes.codigo] && registro[mes.codigo][slotIndex]);
      drawCell(doc, startX + slotIndex * monthMini, rowY, monthMini, 60, marcado ? 'X' : '', {
        align: 'center',
        fontSize: 7,
      });
    });
    x += monthMini * 4;
  });
  [
    ctx.responsable,
    mantenimiento.cumple_mantenimiento === null || mantenimiento.cumple_mantenimiento === undefined
      ? '—'
      : mantenimiento.cumple_mantenimiento
        ? 'Sí'
        : 'No',
    textValue(mantenimiento.justificacion_ausencia_mantenimiento),
    ctx.supervisor,
    textValue(mantenimiento.firma_responsable),
  ].forEach((value, index) => {
    drawCell(doc, x, rowY, tailCols[index], 60, value, { fontSize: 6.6 });
    x += tailCols[index];
  });
  drawFooter(doc);
  doc.end();
}

module.exports = {
  sendMantenimientoCorrectivoPdf,
  sendCronogramaMantenimientoPdf,
  sendMantenimientoPreventivoPdf,
};
