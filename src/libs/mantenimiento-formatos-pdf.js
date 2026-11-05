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

function splitDateParts(value) {
  const formatted = formatDate(value);
  if (!formatted || formatted === '—') return ['—', '—', '—'];
  const parts = formatted.split('/');
  if (parts.length !== 3) return [formatted, '—', '—'];
  return parts;
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

function drawInstructionRow(doc, x, y, width, text) {
  const labelWidth = 78;
  drawCell(doc, x, y, labelWidth, 26, 'Indicaciones', {
    bold: true,
    fill: '#d1d5db',
    align: 'center',
    fontSize: 6.8,
  });
  drawCell(doc, x + labelWidth, y, width - labelWidth, 26, text, {
    fontSize: 6.2,
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
  const [dia, mes, anio] = splitDateParts(mantenimiento.fecha_realizacion);
  const rowY = doc.y;
  const headWidths = [105, 90, 118, width - 313];
  drawCell(doc, left, rowY, headWidths[0], 18, 'Facultad', {
    bold: true,
    fill: '#d1d5db',
    align: 'center',
  });
  drawCell(doc, left + headWidths[0], rowY, headWidths[1], 18, 'Área', {
    bold: true,
    fill: '#d1d5db',
    align: 'center',
  });
  drawCell(doc, left + headWidths[0] + headWidths[1], rowY, headWidths[2], 18, 'Responsable', {
    bold: true,
    fill: '#d1d5db',
    align: 'center',
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
      align: 'center',
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
  const fechaCols = [70, 46, 46, 62, 84, width - 308];
  const fechaLabels = ['Fecha', 'Día', 'Mes', 'Año', 'Cargo', ''];
  let x = left;
  fechaLabels.forEach((label, index) => {
    drawCell(doc, x, secondY, fechaCols[index], 18, label, {
      bold: true,
      fill: '#d1d5db',
      align: 'center',
      fontSize: 6.8,
    });
    x += fechaCols[index];
  });
  x = left;
  ['', dia, mes, anio, '', textValue(mantenimiento.cargo_diligenciado_por)].forEach(
    (value, index) => {
      drawCell(doc, x, secondY + 18, fechaCols[index], 18, value, {
        align: index > 0 && index < 4 ? 'center' : 'left',
      });
      x += fechaCols[index];
    }
  );

  const instructionY = secondY + 42;
  drawInstructionRow(
    doc,
    left,
    instructionY,
    width,
    'Seleccione el nombre del equipo, especificando su código, y registre la descripción detallada de la falla junto con la reparación efectuada.'
  );

  doc.y = instructionY + 34;
  const cols = [110, 95, 150, 160, 92, 42, 86, 47];
  const labels = [
    'NOMBRE DEL EQUIPO',
    'CÓDIGO DE INVENTARIO',
    'DESCRIPCIÓN DE LA FALLA',
    'DESCRIPCIÓN DE LA REPARACIÓN EFECTUADA',
    'RESPONSABLE DE VERIFICAR',
    'FIRMA',
    'PROVEEDOR',
    'FIRMA',
  ];
  x = left;
  labels.forEach((label, index) => {
    drawCell(doc, x, doc.y, cols[index], 34, label, {
      bold: true,
      fill: '#d1d5db',
      align: 'center',
      fontSize: 6.4,
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
    drawCell(doc, x, dataY, cols[index], 86, value, {
      fontSize: 6.8,
      align: index >= 5 ? 'center' : 'left',
    });
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
  const [dia, mes, anio] = splitDateParts(mantenimiento.fecha_realizacion);
  const mesesProgramados = monthsFromJson(mantenimiento.meses_programados);
  const topY = doc.y;
  const infoWidths = [110, 98, 132, width - 340];
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
      fontSize: 6.8,
    });
    x += infoWidths[index];
  });
  x = left;
  infoValues.forEach((value, index) => {
    drawCell(doc, x, topY + 18, infoWidths[index], 18, value);
    x += infoWidths[index];
  });

  const fechaY = topY + 36;
  const fechaCols = [60, 38, 38, 52, 118, width - 306];
  const fechaLabels = ['Fecha', 'Día', 'Mes', 'Año', 'Encargado de su elaboración', ''];
  x = left;
  fechaLabels.forEach((label, index) => {
    drawCell(doc, x, fechaY, fechaCols[index], 18, label, {
      bold: true,
      fill: '#d1d5db',
      align: 'center',
      fontSize: 6.6,
    });
    x += fechaCols[index];
  });
  x = left;
  ['', dia, mes, anio, '', textValue(mantenimiento.encargado_elaboracion)].forEach(
    (value, index) => {
      drawCell(doc, x, fechaY + 18, fechaCols[index], 18, value, {
        align: index > 0 && index < 4 ? 'center' : 'left',
      });
      x += fechaCols[index];
    }
  );

  const instructionY = fechaY + 42;
  drawInstructionRow(
    doc,
    left,
    instructionY,
    width,
    'El cronograma de mantenimiento registra la programación anual de actividades como limpieza, mantenimiento correctivo, preventivo y otras acciones que garanticen el adecuado estado del equipo.'
  );

  const tableY = instructionY + 34;
  const baseCols = [112, 84, 156];
  const monthWidth = 18;
  const tailCols = [70, 58, 46, width - (112 + 84 + 156 + monthWidth * 12 + 70 + 58 + 46)];
  x = left;
  ['NOMBRE DE LA MÁQUINA/EQUIPO', 'CÓDIGO DE INVENTARIO', 'DESCRIPCIÓN DE LA ACTIVIDAD'].forEach(
    (label, index) => {
      drawCell(doc, x, tableY, baseCols[index], 34, label, {
        bold: true,
        fill: '#d1d5db',
        align: 'center',
        fontSize: 6.4,
      });
      x += baseCols[index];
    }
  );
  drawCell(doc, x, tableY, monthWidth * 12, 18, 'MES DE MANTENIMIENTO', {
    bold: true,
    fill: '#d1d5db',
    align: 'center',
    fontSize: 6.6,
  });
  MESES.forEach((mesItem, index) => {
    drawCell(doc, x + index * monthWidth, tableY + 18, monthWidth, 16, String(index + 1), {
      bold: true,
      fill: '#d1d5db',
      align: 'center',
      fontSize: 6.4,
    });
  });
  x += monthWidth * 12;
  ['RESPONSABLE', 'VERIFICADO POR', 'FIRMA', 'OBSERVACIONES'].forEach((label, index) => {
    drawCell(doc, x, tableY, tailCols[index], 34, label, {
      bold: true,
      fill: '#d1d5db',
      align: 'center',
      fontSize: 6.4,
    });
    x += tailCols[index];
  });

  const dataY = tableY + 34;
  x = left;
  [ctx.nombreEquipo, ctx.codigoInventario, textValue(mantenimiento.descripcion_actividad)].forEach(
    (value, index) => {
      drawCell(doc, x, dataY, baseCols[index], 62, value, { fontSize: 6.8 });
      x += baseCols[index];
    }
  );
  MESES.forEach((mesItem) => {
    drawCell(doc, x, dataY, monthWidth, 62, mesesProgramados.includes(mesItem.codigo) ? 'X' : '', {
      align: 'center',
      fontSize: 7,
    });
    x += monthWidth;
  });
  [
    ctx.responsable,
    textValue(mantenimiento.verificado_por),
    textValue(mantenimiento.firma_verificacion),
    textValue(mantenimiento.observaciones_generales),
  ].forEach((value, index) => {
    drawCell(doc, x, dataY, tailCols[index], 62, value, { fontSize: 6.6 });
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
  const [dia, mes, anio] = splitDateParts(mantenimiento.fecha_realizacion);
  const registro = registroFromJson(mantenimiento.registro_mantenimiento);
  const infoY = doc.y;
  const infoCols = [108, 122, 62, 94, 120, width - 506];
  let x = left;
  [
    'Diligenciado por',
    textValue(mantenimiento.diligenciado_por),
    'Cargo',
    textValue(mantenimiento.cargo_diligenciado_por),
    'Responsable del Área',
    ctx.responsableArea,
  ].forEach((value, index) => {
    const isLabel = index % 2 === 0;
    drawCell(doc, x, infoY, infoCols[index], 18, value, {
      bold: isLabel,
      fill: isLabel ? '#d1d5db' : '#ffffff',
      align: isLabel ? 'center' : 'left',
      fontSize: 6.6,
    });
    x += infoCols[index];
  });

  const secondInfoY = infoY + 18;
  const secondCols = [62, 36, 36, 48, 64, 96, 102, width - 444];
  x = left;
  [
    'Fecha',
    dia,
    mes,
    anio,
    'Sede',
    textValue(mantenimiento.sede),
    'Área específica',
    textValue(mantenimiento.area_especifica),
  ].forEach((value, index) => {
    const isLabel = index === 0 || index === 4 || index === 6;
    drawCell(doc, x, secondInfoY, secondCols[index], 18, value, {
      bold: isLabel,
      fill: isLabel ? '#d1d5db' : '#ffffff',
      align: index > 0 && index < 4 ? 'center' : isLabel ? 'center' : 'left',
      fontSize: 6.4,
    });
    x += secondCols[index];
  });

  const instructionY = secondInfoY + 24;
  drawInstructionRow(
    doc,
    left,
    instructionY,
    width,
    'Registre el equipo o máquina, su código de inventario, la cantidad, la acción de verificación y el control mensual del mantenimiento preventivo; si no se cumple, justifique la ausencia.'
  );

  const tableY = instructionY + 34;
  const cols = [86, 68, 38, 118];
  const monthMini = 5;
  const monthGroupWidth = monthMini * 4;
  const tailCols = [58, 42, 96, width - (86 + 68 + 38 + 118 + monthGroupWidth * 12 + 58 + 42 + 96)];
  x = left;
  [
    'EQUIPO / MÁQUINA',
    'CÓDIGO/N° DE INVENTARIO',
    'CANT.',
    'DESCRIPCIÓN DE LA ACCIÓN O VERIFICACIÓN',
  ].forEach((label, index) => {
    drawCell(doc, x, tableY, cols[index], 48, label, {
      bold: true,
      fill: '#d1d5db',
      align: 'center',
      fontSize: 6.1,
    });
    x += cols[index];
  });
  drawCell(doc, x, tableY, monthGroupWidth * 12, 16, 'REGISTRO DE MANTENIMIENTO', {
    bold: true,
    fill: '#d1d5db',
    align: 'center',
    fontSize: 6.2,
  });
  MESES.forEach((mesItem, index) => {
    const monthX = x + index * monthGroupWidth;
    drawCell(doc, monthX, tableY + 16, monthGroupWidth, 16, mesItem.etiqueta, {
      bold: true,
      fill: '#d1d5db',
      align: 'center',
      fontSize: 5.8,
    });
    [1, 2, 3, 4].forEach((slot, slotIndex) => {
      drawCell(doc, monthX + slotIndex * monthMini, tableY + 32, monthMini, 16, String(slot), {
        bold: true,
        fill: '#d1d5db',
        align: 'center',
        fontSize: 5.8,
      });
    });
  });
  x += monthGroupWidth * 12;
  ['RESPONSABLE', 'CUMPLE', 'JUSTIFICAR LA AUSENCIA DE MANTENIMIENTO', 'FIRMA'].forEach(
    (label, index) => {
      drawCell(doc, x, tableY, tailCols[index], 48, label, {
        bold: true,
        fill: '#d1d5db',
        align: 'center',
        fontSize: 6,
      });
      x += tailCols[index];
    }
  );

  const rowY = tableY + 48;
  x = left;
  [
    ctx.nombreEquipo,
    ctx.codigoInventario,
    ctx.cantidad,
    textValue(mantenimiento.descripcion_accion_verificacion),
  ].forEach((value, index) => {
    drawCell(doc, x, rowY, cols[index], 66, value, { fontSize: 6.4 });
    x += cols[index];
  });
  MESES.forEach((mesItem) => {
    const startX = x;
    [0, 1, 2, 3].forEach((slotIndex) => {
      const marcado = Boolean(registro[mesItem.codigo] && registro[mesItem.codigo][slotIndex]);
      drawCell(doc, startX + slotIndex * monthMini, rowY, monthMini, 66, marcado ? 'X' : '', {
        align: 'center',
        fontSize: 6.8,
      });
    });
    x += monthGroupWidth;
  });
  [
    ctx.responsable,
    mantenimiento.cumple_mantenimiento === null || mantenimiento.cumple_mantenimiento === undefined
      ? '—'
      : mantenimiento.cumple_mantenimiento
        ? 'Sí'
        : 'No',
    textValue(mantenimiento.justificacion_ausencia_mantenimiento),
    textValue(mantenimiento.firma_responsable),
  ].forEach((value, index) => {
    drawCell(doc, x, rowY, tailCols[index], 66, value, {
      fontSize: index === 1 ? 6.8 : 6.2,
      align: index === 1 ? 'center' : 'left',
    });
    x += tailCols[index];
  });
  drawCell(doc, left, rowY + 66, width, 18, 'Observaciones', {
    bold: true,
    fill: '#d1d5db',
    align: 'center',
    fontSize: 6.4,
  });
  drawCell(doc, left, rowY + 84, width, 24, textValue(mantenimiento.observaciones_generales), {
    fontSize: 6.3,
  });
  drawFooter(doc);
  doc.end();
}

module.exports = {
  sendMantenimientoCorrectivoPdf,
  sendCronogramaMantenimientoPdf,
  sendMantenimientoPreventivoPdf,
};
