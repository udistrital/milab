const fs = require('node:fs');
const path = require('node:path');
const PDFDocument = require('pdfkit');
const { formatearTipoUso } = require('./hojas-vida-campos');
const { etiquetaTipoMantenimiento } = require('./hojas-vida-mantenimientos');

// Plantilla institucional de la Hoja de Vida (formato GL-PR-002-FR-007).
const HV_PDF_FONT_REGULAR = path.join(__dirname, '..', 'public', 'fonts', 'NotoSansJP-Regular.otf');
const HV_PDF_FONT_BOLD = path.join(__dirname, '..', 'public', 'fonts', 'NotoSansJP-Bold.otf');
const HV_PDF_ESCUDO_PATH = path.join(
  __dirname,
  '..',
  'public',
  'img',
  'Logo_Escudo_Acreditacion_Horizontal.png'
);
const HV_PDF_SIGUD_PATH = path.join(__dirname, '..', 'public', 'img', 'logo_sigud.jpg');

function formatHvDate(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (part) => String(part).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function setHvPdfFont(doc, variant) {
  const requested = variant === 'bold' ? HV_PDF_FONT_BOLD : HV_PDF_FONT_REGULAR;
  const fallback = variant === 'bold' ? 'Helvetica-Bold' : 'Helvetica';
  try {
    if (fs.existsSync(requested)) {
      doc.font(requested);
      return;
    }
  } catch {
    // Si la fuente no se puede cargar se usa la fuente segura del sistema.
  }
  doc.font(fallback);
}

function formatHvPdfValue(field, value) {
  if (field?.nombre === 'tipo_uso') {
    return formatearTipoUso(value) || 'No hay informacion';
  }
  if (field?.tipo === 'date') {
    return formatHvDate(value) === '—' ? 'No hay informacion' : formatHvDate(value);
  }
  if (value === null || value === undefined || value === '') return 'No hay informacion';
  return String(value);
}

function sendHojaVidaPdf(res, hojaVida, equipo, foto, mantenimientos) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 36,
    bufferPages: true,
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="Hoja_Vida_${hojaVida.codigo_inventario || hojaVida.id}.pdf"`
  );
  doc.pipe(res);

  const palette = {
    border: '#4b5563',
    softBorder: '#9ca3af',
    text: '#111827',
    muted: '#4b5563',
    gray: '#d1d5db',
    darkGray: '#b9c0c8',
    white: '#ffffff',
  };
  const contentLeft = doc.page.margins.left;
  const contentTop = () => doc.page.margins.top + 92;
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bottomLimit = () => doc.page.height - doc.page.margins.bottom - 26;

  const data = {
    dependencia: formatHvPdfValue(null, hojaVida.dependencia || equipo.facultad),
    ubicacion: formatHvPdfValue(null, hojaVida.ubicacion || equipo.ubicacion || equipo.laboratorio),
    nombre_equipo: formatHvPdfValue(null, hojaVida.nombre_equipo || equipo.nombre),
    marca: formatHvPdfValue(null, hojaVida.marca),
    proveedor: formatHvPdfValue(null, hojaVida.proveedor),
    numero_serie: formatHvPdfValue(null, hojaVida.numero_serie),
    numero_remision_compra: formatHvPdfValue(null, hojaVida.numero_remision_compra),
    codigo_inventario: formatHvPdfValue(null, hojaVida.codigo_inventario),
    valor_compra: formatHvPdfValue(null, hojaVida.valor_compra),
    fecha_adquisicion: formatHvPdfValue({ tipo: 'date' }, hojaVida.fecha_adquisicion),
    pais_origen: formatHvPdfValue(null, hojaVida.pais_origen),
    frecuencia_mantenimiento: formatHvPdfValue(null, hojaVida.frecuencia_mantenimiento),
    referencia_modelo: formatHvPdfValue(null, hojaVida.referencia_modelo),
    tipo_uso: formatearTipoUso(hojaVida.tipo_uso) || 'No hay informacion',
    potencia_electrica: formatHvPdfValue(null, hojaVida.potencia_electrica),
    funcion: formatHvPdfValue(null, hojaVida.funcion),
    descripcion_fisica: formatHvPdfValue(null, hojaVida.descripcion_fisica),
    especificaciones_tecnicas: formatHvPdfValue(null, hojaVida.especificaciones_tecnicas),
    instrucciones_uso: formatHvPdfValue(null, hojaVida.instrucciones_uso),
    condiciones_seguridad: formatHvPdfValue(null, hojaVida.condiciones_seguridad),
    protocolo_limpieza: formatHvPdfValue(null, hojaVida.protocolo_limpieza),
    cuenta_manual: formatHvPdfValue(null, hojaVida.cuenta_manual),
    accesorios: formatHvPdfValue(null, hojaVida.accesorios),
    foto_descripcion: formatHvPdfValue(null, hojaVida.foto_descripcion),
  };
  const photoBuffer =
    foto && foto.archivo
      ? Buffer.isBuffer(foto.archivo)
        ? foto.archivo
        : Buffer.from(foto.archivo)
      : null;

  function ensureSpace(height) {
    if (doc.y + height <= bottomLimit()) return;
    doc.addPage();
    drawHeader();
    doc.x = contentLeft;
    doc.y = contentTop();
  }

  function fillStrokeRect(x, y, width, height, fillColor) {
    doc.save().lineWidth(0.8).fillColor(fillColor).strokeColor(palette.border);
    doc.rect(x, y, width, height).fillAndStroke();
    doc.restore();
  }

  function strokeRect(x, y, width, height) {
    doc.save().lineWidth(0.8).strokeColor(palette.border).rect(x, y, width, height).stroke();
    doc.restore();
  }

  function measureText(text, width) {
    return doc.heightOfString(String(text || ''), { width: width, align: 'left' });
  }

  function drawHeader() {
    const topY = doc.page.margins.top;
    const headerHeight = 68;
    const leftWidth = 92;
    const rightWidth = 120;
    const centerWidth = contentWidth - leftWidth - rightWidth;

    strokeRect(contentLeft, topY, contentWidth, headerHeight);
    strokeRect(contentLeft + leftWidth, topY, centerWidth, headerHeight);
    strokeRect(contentLeft + leftWidth + centerWidth, topY, rightWidth, headerHeight);

    if (fs.existsSync(HV_PDF_ESCUDO_PATH)) {
      doc.image(HV_PDF_ESCUDO_PATH, contentLeft + 6, topY + 8, {
        fit: [leftWidth - 12, headerHeight - 16],
        align: 'center',
        valign: 'center',
      });
    }
    if (fs.existsSync(HV_PDF_SIGUD_PATH)) {
      doc.image(HV_PDF_SIGUD_PATH, contentLeft + leftWidth + centerWidth + 12, topY + 14, {
        fit: [rightWidth - 24, 22],
        align: 'center',
      });
    }

    const centerX = contentLeft + leftWidth;
    const rowHeights = [20, 16, 16, 16];
    let currentY = topY;
    rowHeights.slice(0, 3).forEach((height) => {
      doc
        .save()
        .lineWidth(0.8)
        .strokeColor(palette.border)
        .moveTo(centerX, currentY + height)
        .lineTo(centerX + centerWidth, currentY + height)
        .stroke()
        .restore();
      currentY += height;
    });
    doc
      .save()
      .lineWidth(0.8)
      .strokeColor(palette.border)
      .moveTo(contentLeft + leftWidth + centerWidth + 60, topY)
      .lineTo(contentLeft + leftWidth + centerWidth + 60, topY + headerHeight)
      .stroke()
      .restore();
    [20, 40].forEach((offset) => {
      doc
        .save()
        .lineWidth(0.8)
        .strokeColor(palette.border)
        .moveTo(contentLeft + leftWidth + centerWidth, topY + offset)
        .lineTo(contentLeft + leftWidth + centerWidth + 60, topY + offset)
        .stroke()
        .restore();
    });

    setHvPdfFont(doc, 'bold');
    doc
      .fontSize(11)
      .fillColor(palette.text)
      .text('HOJA DE VIDA DE EQUIPOS', centerX, topY + 6, {
        width: centerWidth,
        align: 'center',
      });
    setHvPdfFont(doc, 'regular');
    doc.fontSize(8).text('Macro proceso: Apoyo a lo Misional', centerX, topY + 24, {
      width: centerWidth,
      align: 'center',
    });
    doc.text('Proceso: Gestion de Laboratorios', centerX, topY + 40, {
      width: centerWidth,
      align: 'center',
    });

    const metaX = contentLeft + leftWidth + centerWidth + 4;
    setHvPdfFont(doc, 'bold');
    doc.fontSize(7.5).text('Código:', metaX, topY + 6, { lineBreak: false });
    setHvPdfFont(doc, 'regular');
    doc.text('GL-PR-002-FR-007', metaX + 34, topY + 6);
    setHvPdfFont(doc, 'bold');
    doc.text('Versión:', metaX, topY + 26, { lineBreak: false });
    setHvPdfFont(doc, 'regular');
    doc.text('01', metaX + 34, topY + 26);
    setHvPdfFont(doc, 'bold');
    doc.text('Fecha de aprobación:', metaX, topY + 46, { lineBreak: false });
    setHvPdfFont(doc, 'regular');
    doc.text('30/10/2017', metaX + 54, topY + 46);
  }

  function drawFooter(pageNumber) {
    setHvPdfFont(doc, 'regular');
    doc
      .fontSize(8)
      .fillColor(palette.muted)
      .text(`Página ${pageNumber} de ${range.count}`, contentLeft, doc.page.height - 24, {
        width: contentWidth,
        align: 'right',
      });
  }

  function drawSectionHeader(title) {
    ensureSpace(18);
    const startY = doc.y;
    fillStrokeRect(contentLeft, startY, contentWidth, 18, palette.darkGray);
    setHvPdfFont(doc, 'bold');
    doc
      .fontSize(9)
      .fillColor(palette.text)
      .text(title, contentLeft, startY + 5, {
        width: contentWidth,
        align: 'center',
      });
    doc.y = startY + 18;
  }

  function drawSimplePairRow(labelA, valueA, labelB, valueB) {
    const widths = labelB ? [110, 190, 110, contentWidth - 410] : [110, contentWidth - 110];
    const values = labelB ? [labelA, valueA, labelB, valueB] : [labelA, valueA];
    const rowHeight = Math.max(
      18,
      ...values.map((value, index) => measureText(value, widths[index] - 6) + 6)
    );
    ensureSpace(rowHeight);
    const rowY = doc.y;
    let x = contentLeft;
    widths.forEach((width, index) => {
      fillStrokeRect(x, rowY, width, rowHeight, index % 2 === 0 ? palette.gray : palette.white);
      setHvPdfFont(doc, index % 2 === 0 ? 'bold' : 'regular');
      doc
        .fontSize(8)
        .fillColor(palette.text)
        .text(String(values[index] || ''), x + 3, rowY + 4, {
          width: width - 6,
        });
      x += width;
    });
    doc.y = rowY + rowHeight;
  }

  function drawInfoEquipoSection() {
    drawSectionHeader('1. INFORMACION DEL EQUIPO');
    const photoWidth = 120;
    const leftWidth = contentWidth - photoWidth;
    const leftLabelWidth = 88;
    const leftValueWidth = 120;
    const rightLabelWidth = 95;
    const rightValueWidth = leftWidth - leftLabelWidth - leftValueWidth - rightLabelWidth;
    const rows = [
      { left: ['DEPENDENCIA', data.dependencia] },
      { left: ['UBICACION', data.ubicacion] },
      { left: ['NOMBRE DEL EQUIPO', data.nombre_equipo] },
      { left: ['MARCA', data.marca], right: ['PROVEEDOR', data.proveedor] },
      {
        left: ['# DE SERIE', data.numero_serie],
        right: ['# DE REMISION DE COMPRA', data.numero_remision_compra],
      },
      {
        left: ['CODIGO DE INVENTARIO', data.codigo_inventario],
        right: ['VALOR DE COMPRA', data.valor_compra],
      },
      {
        left: ['FECHA DE ADQUISICION', data.fecha_adquisicion],
        right: ['PAIS DE ORIGEN', data.pais_origen],
      },
      {
        left: ['FRECUENCIA MTO', data.frecuencia_mantenimiento],
        right: ['REFERENCIA/MODELO', data.referencia_modelo],
      },
    ];
    const rowHeights = rows.map((row) => {
      const segments = row.right
        ? [
            { width: leftLabelWidth, text: row.left[0] },
            { width: leftValueWidth, text: row.left[1] },
            { width: rightLabelWidth, text: row.right[0] },
            { width: rightValueWidth, text: row.right[1] },
          ]
        : [
            { width: leftLabelWidth, text: row.left[0] },
            { width: leftWidth - leftLabelWidth, text: row.left[1] },
          ];
      return Math.max(
        18,
        ...segments.map((segment) => measureText(segment.text, segment.width - 6) + 6)
      );
    });
    const typeUsoHeight = 24;
    const photoHeight = rowHeights.reduce((sum, height) => sum + height, 0) + typeUsoHeight;
    ensureSpace(photoHeight);

    const sectionY = doc.y;
    let y = sectionY;
    rows.forEach((row, index) => {
      let x = contentLeft;
      const segments = row.right
        ? [
            { width: leftLabelWidth, text: row.left[0], bold: true },
            { width: leftValueWidth, text: row.left[1], bold: false },
            { width: rightLabelWidth, text: row.right[0], bold: true },
            { width: rightValueWidth, text: row.right[1], bold: false },
          ]
        : [
            { width: leftLabelWidth, text: row.left[0], bold: true },
            { width: leftWidth - leftLabelWidth, text: row.left[1], bold: false },
          ];
      segments.forEach((segment, segmentIndex) => {
        fillStrokeRect(
          x,
          y,
          segment.width,
          rowHeights[index],
          segmentIndex % 2 === 0 ? palette.gray : palette.white
        );
        setHvPdfFont(doc, segment.bold ? 'bold' : 'regular');
        doc
          .fontSize(8)
          .fillColor(palette.text)
          .text(segment.text, x + 3, y + 4, { width: segment.width - 6 });
        x += segment.width;
      });
      y += rowHeights[index];
    });

    fillStrokeRect(contentLeft, y, leftLabelWidth, typeUsoHeight, palette.gray);
    fillStrokeRect(contentLeft + leftLabelWidth, y, leftWidth - leftLabelWidth, typeUsoHeight, palette.white);
    setHvPdfFont(doc, 'bold');
    doc
      .fontSize(8)
      .fillColor(palette.text)
      .text('TIPO DE USO', contentLeft + 3, y + 8, { width: leftLabelWidth - 6 });
    const checks = [
      { label: 'Académico', checked: /ACADEMICO/i.test(data.tipo_uso) },
      { label: 'Investigación', checked: /INVESTIGACION/i.test(data.tipo_uso) },
      { label: 'Extensión', checked: /EXTENSION/i.test(data.tipo_uso) },
      { label: 'Servicios', checked: /SERVICIOS/i.test(data.tipo_uso) },
      { label: 'Otros', checked: /OTROS/i.test(data.tipo_uso) },
    ];
    let cursorX = contentLeft + leftLabelWidth + 6;
    checks.forEach((item) => {
      strokeRect(cursorX, y + 7, 8, 8);
      if (item.checked) {
        setHvPdfFont(doc, 'bold');
        doc.fontSize(7).text('X', cursorX + 1.5, y + 5.5, { width: 8, align: 'center' });
      }
      setHvPdfFont(doc, 'regular');
      doc.fontSize(7.5).text(item.label, cursorX + 11, y + 6, { width: 54 });
      cursorX += 58;
    });
    y += typeUsoHeight;

    fillStrokeRect(contentLeft + leftWidth, sectionY, photoWidth, photoHeight, palette.white);
    if (photoBuffer) {
      try {
        doc.image(photoBuffer, contentLeft + leftWidth + 8, sectionY + 8, {
          fit: [photoWidth - 16, photoHeight - 16],
          align: 'center',
          valign: 'center',
        });
      } catch {
        setHvPdfFont(doc, 'regular');
        doc
          .fontSize(8)
          .fillColor(palette.muted)
          .text('Sin imagen', contentLeft + leftWidth + 8, sectionY + 8, {
            width: photoWidth - 16,
            align: 'center',
          });
      }
    }
    doc.y = sectionY + photoHeight;
  }

  function drawFullWidthRow(label, value) {
    const labelWidth = 156;
    const rowHeight =
      Math.max(
        18,
        measureText(label, labelWidth - 6),
        measureText(value, contentWidth - labelWidth - 6)
      ) + 6;
    ensureSpace(rowHeight);
    const rowY = doc.y;
    fillStrokeRect(contentLeft, rowY, labelWidth, rowHeight, palette.gray);
    fillStrokeRect(
      contentLeft + labelWidth,
      rowY,
      contentWidth - labelWidth,
      rowHeight,
      palette.white
    );
    setHvPdfFont(doc, 'bold');
    doc
      .fontSize(8)
      .fillColor(palette.text)
      .text(label, contentLeft + 3, rowY + 4, { width: labelWidth - 6 });
    setHvPdfFont(doc, 'regular');
    doc.text(value, contentLeft + labelWidth + 3, rowY + 4, {
      width: contentWidth - labelWidth - 6,
    });
    doc.y = rowY + rowHeight;
  }

  function drawEspecificacionesSection() {
    drawSectionHeader('2. ESPECIFICACIONES TECNICAS');
    drawFullWidthRow('FUNCION', data.funcion);
    drawFullWidthRow('DESCRIPCION FISICA', data.descripcion_fisica);
    drawFullWidthRow('ESPECIFICACIONES TECNICAS', data.especificaciones_tecnicas);
    drawFullWidthRow('INSTRUCCIONES DE USO', data.instrucciones_uso);
    drawFullWidthRow('CONDICIONES DE SEGURIDAD', data.condiciones_seguridad);
    drawFullWidthRow('PROTOCOLO DE LIMPIEZA', data.protocolo_limpieza);
    drawSimplePairRow('¿Cuenta con manual?', data.cuenta_manual, 'Accesorios', data.accesorios);
    drawFullWidthRow('DESCRIPCION DE LA FOTOGRAFIA', data.foto_descripcion);
  }

  function drawMantenimientoTableHeader() {
    const widths = [24, 66, 56, 72, 52, 95, 60, 98];
    const labels = [
      'ITEM',
      'TIPO DE MANTENIMIENTO',
      'FECHA DE REALIZACION',
      'DATOS EMPRESA CONTRATADA',
      'TIEMPO DE GARANTIA',
      'ESPECIFICACIONES DEL MANTENIMIENTO REALIZADO',
      'RESPONSABLE',
      'OBSERVACIONES / REPUESTOS',
    ];
    ensureSpace(34);
    const headerY = doc.y;
    let x = contentLeft;
    labels.forEach((label, index) => {
      fillStrokeRect(x, headerY, widths[index], 34, palette.gray);
      setHvPdfFont(doc, 'bold');
      doc
        .fontSize(7.2)
        .fillColor(palette.text)
        .text(label, x + 2, headerY + 6, {
          width: widths[index] - 4,
          align: 'center',
        });
      x += widths[index];
    });
    doc.y = headerY + 34;
    return widths;
  }

  function drawMantenimientosSection() {
    drawSectionHeader('3. HISTORIAL DE MANTENIMIENTO');
    drawSectionHeader('CONVENCION DE MANTENIMIENTO');
    setHvPdfFont(doc, 'regular');
    doc.fontSize(8).fillColor(palette.text);
    [
      'MANTENIMIENTO INTERNO CORRECTIVO (MIC) ----- MANTENIMIENTO EXTERNO CORRECTIVO (MEC)',
      'MANTENIMIENTO INTERNO PREDICTIVO (MIP) ----- MANTENIMIENTO EXTERNO PREDICTIVO (MEP)',
      'MANTENIMIENTO INTERNO PREVENTIVO (MIVP) ----- MANTENIMIENTO EXTERNO PREVENTIVO (MEVP)',
    ].forEach((line) => {
      ensureSpace(11);
      const lineY = doc.y;
      doc.text(line, contentLeft, lineY + 2, { width: contentWidth, align: 'center' });
      doc.y = lineY + 11;
    });

    let widths = drawMantenimientoTableHeader();
    const rows = Array.isArray(mantenimientos) && mantenimientos.length ? mantenimientos : [null];

    rows.forEach((mantenimiento, index) => {
      const values = mantenimiento
        ? [
            String(mantenimiento.item || index + 1),
            etiquetaTipoMantenimiento(mantenimiento.tipo_mantenimiento || 'OTRO'),
            formatHvDate(mantenimiento.fecha_realizacion),
            mantenimiento.datos_empresa_contratada || '—',
            mantenimiento.tiempo_garantia || '—',
            mantenimiento.especificaciones_mantenimiento || '—',
            mantenimiento.responsable || '—',
            mantenimiento.observaciones_repuestos || '—',
          ]
        : ['1', '—', '—', '—', '—', 'Sin mantenimientos registrados', '—', '—'];
      const rowHeight = Math.max(
        18,
        ...values.map((value, idx) => measureText(value, widths[idx] - 4) + 6)
      );
      if (doc.y + rowHeight > bottomLimit()) {
        doc.addPage();
        drawHeader();
        doc.y = contentTop();
        drawSectionHeader('3. HISTORIAL DE MANTENIMIENTO (CONTINUACION)');
        widths = drawMantenimientoTableHeader();
      }
      const rowY = doc.y;
      let x = contentLeft;
      values.forEach((value, valueIndex) => {
        fillStrokeRect(x, rowY, widths[valueIndex], rowHeight, palette.white);
        setHvPdfFont(doc, 'regular');
        doc
          .fontSize(7.3)
          .fillColor(palette.text)
          .text(value, x + 2, rowY + 4, {
            width: widths[valueIndex] - 4,
            align: valueIndex === 0 ? 'center' : 'left',
          });
        x += widths[valueIndex];
      });
      doc.y = rowY + rowHeight;
    });
  }

  drawHeader();
  doc.y = contentTop();
  doc.x = contentLeft;
  drawSimplePairRow(
    'Fecha de generación',
    formatHvDate(new Date()),
    'Fecha de actualización',
    formatHvDate(hojaVida.fecha_modificacion || new Date())
  );
  drawInfoEquipoSection();
  drawEspecificacionesSection();
  drawMantenimientosSection();

  const range = doc.bufferedPageRange();
  for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
    doc.switchToPage(pageIndex);
    drawFooter(pageIndex + 1);
  }

  doc.end();
}

module.exports = {
  sendHojaVidaPdf,
};
