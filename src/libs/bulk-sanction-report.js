const path = require('node:path');

const COLORS = Object.freeze({
  accent: '#df1b1b',
  accentDeep: '#a80f12',
  highlight: '#ffbf00',
  text: '#171717',
  muted: '#62584d',
  border: '#d8d2c6',
  surface: '#fffaf2',
  alternate: '#faf6ed',
  white: '#ffffff',
  success: '#527c5b',
  warning: '#b17a00',
});

const MARGIN = 40;
const FOOTER_HEIGHT = 34;
const LOGO_MILAB_PATH = path.join(__dirname, '../public/img/milab_logo.png');
const LOGO_UNIVERSITY_PATH = path.join(
  __dirname,
  '../public/img/Logo_Escudo_Acreditacion_Horizontal.png'
);

function asText(value, fallback = '-') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

function getSanctions(student) {
  return (Array.isArray(student?.multas) ? student.multas : []).filter(
    (fine) => fine && typeof fine === 'object'
  );
}

function getSgaStatusLabel(status) {
  const labels = {
    found: 'Multas de laboratorio',
    clear: 'Completa: sin multas de laboratorio',
    partial: 'Parcial',
    error: 'Error de consulta',
    unresolved: 'Identidad no verificada',
    not_configured: 'SGA no configurado',
  };
  return labels[status] || 'Sin verificar';
}

function summarizeBulkSanctions(students) {
  const rows = Array.isArray(students) ? students : [];
  const sanctions = rows.flatMap(getSanctions);

  return {
    students: rows.length,
    studentsWithSanctions: rows.filter((student) => getSanctions(student).length > 0).length,
    localSanctions: sanctions.filter((fine) => fine.origen === 'MILab').length,
    sgaLaboratoryFines: sanctions.filter((fine) => fine.origen === 'SGA').length,
    verified: rows.filter((student) => ['found', 'clear'].includes(student.sgaStatus)).length,
    nonConclusive: rows.filter((student) =>
      ['partial', 'error', 'unresolved'].includes(student.sgaStatus)
    ).length,
    notConfigured: rows.filter((student) => student.sgaStatus === 'not_configured').length,
    sgaWithFines: rows.filter((student) => student.sgaStatus === 'found').length,
    sgaClear: rows.filter((student) => student.sgaStatus === 'clear').length,
  };
}

function identification(student) {
  const document = student.documento || '-';
  const code = student.codigo || student.identificador || '-';
  return `Documento: ${document}\nCódigo: ${code}`;
}

function sanctionCountLabel(student) {
  const sanctions = getSanctions(student);
  const local = sanctions.filter((fine) => fine.origen === 'MILab').length;
  const sga = sanctions.filter((fine) => fine.origen === 'SGA').length;
  return `${sanctions.length} total\nMILab: ${local} · SGA: ${sga}`;
}

function detailRow(student, fine) {
  const sga = fine.origen === 'SGA';
  const concept = sga
    ? fine.nombre_concepto || fine.CPTO_NOMBRE || fine.DEU_CPTO_NOMBRE || fine.ual
    : fine.ual;
  const conceptDetails = [
    concept,
    sga && (fine.codigo_concepto || fine.DEU_CPTO_COD)
      ? `Código: ${fine.codigo_concepto || fine.DEU_CPTO_COD}`
      : '',
    sga && (fine.tipo_concepto || fine.CPTO_TIPO || fine.DEU_CPTO_TIPO)
      ? `Tipo: ${fine.tipo_concepto || fine.CPTO_TIPO || fine.DEU_CPTO_TIPO}`
      : '',
  ].filter(Boolean);
  const period = [
    fine.anio_sga || fine.anio || fine.DEU_ANO,
    fine.periodo_sga || fine.periodo || fine.DEU_PER,
  ]
    .filter(Boolean)
    .join(' / ');
  const amount = fine.valor_sga ?? fine.valor ?? fine.DEU_MULTA;
  const paidDate = fine.fecha_pago_sga || fine.fecha_pago || fine.DEU_FECHA_PAGO;

  return [
    asText(sga ? fine.id_sga || fine.DEU_ID : fine.id),
    `${asText(student.nombre)}\n${identification(student)}`,
    asText(fine.origen || 'MILab'),
    asText(fine.cat_multa || fine.categoria || fine.DEU_MATERIAL),
    conceptDetails.join('\n') || '-',
    `${asText(fine.con_estado_multa || fine.estado || fine.DEU_ESTADO)}\nFecha: ${asText(fine.fecha_multa || fine.fecha || fine.DEU_FECHA)}`,
    `Periodo: ${period || '-'}\nValor: ${asText(amount)}\nPago: ${asText(paidDate, 'Pendiente')}`,
  ];
}

function measureRow(doc, cells, widths, fontSize, padding = 7) {
  doc.font('Helvetica').fontSize(fontSize);
  const heights = cells.map((cell, index) =>
    doc.heightOfString(asText(cell), {
      width: widths[index] - padding * 2,
      fontSize,
      lineGap: 1,
    })
  );
  return Math.max(22, ...heights.map((height) => height + padding * 2));
}

function drawPageHeader(doc) {
  const pageWidth = doc.page.width;
  const centerWidth = pageWidth - MARGIN * 2 - 210;

  doc.image(LOGO_MILAB_PATH, MARGIN, 20, { fit: [82, 48] });
  doc.image(LOGO_UNIVERSITY_PATH, pageWidth - MARGIN - 112, 24, { fit: [112, 42] });
  doc
    .font('Helvetica-Bold')
    .fontSize(14)
    .fillColor(COLORS.text)
    .text('INFORME DE CONSULTA MASIVA', MARGIN + 100, 29, {
      width: centerWidth,
      align: 'center',
    });
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text('Coordinación General de Laboratorios · Universidad Distrital', MARGIN + 100, 49, {
      width: centerWidth,
      align: 'center',
    });
  doc
    .moveTo(MARGIN, 78)
    .lineTo(pageWidth - MARGIN, 78)
    .lineWidth(3)
    .strokeColor(COLORS.accent)
    .stroke();
  doc.y = 94;
}

function addReportPage(doc) {
  doc.addPage();
  drawPageHeader(doc);
}

function ensureRoom(doc, height) {
  if (doc.y + height > doc.page.height - FOOTER_HEIGHT - 10) {
    addReportPage(doc);
  }
}

function drawSectionTitle(doc, title, subtitle = '') {
  ensureRoom(doc, subtitle ? 42 : 28);
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(COLORS.accentDeep)
    .text(title, MARGIN, doc.y, { width: doc.page.width - MARGIN * 2 });
  doc.moveDown(0.35);
  if (subtitle) {
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(COLORS.muted)
      .text(subtitle, MARGIN, doc.y, { width: doc.page.width - MARGIN * 2 });
    doc.moveDown(0.5);
  }
}

function drawMetricCards(doc, summary) {
  const gap = 8;
  const width = (doc.page.width - MARGIN * 2 - gap * 3) / 4;
  const metrics = [
    ['Estudiantes', summary.students, COLORS.accent],
    ['Con sanciones', summary.studentsWithSanctions, COLORS.accentDeep],
    ['Multas SGA de laboratorio', summary.sgaLaboratoryFines, COLORS.warning],
    ['Consultas no concluyentes', summary.nonConclusive, COLORS.muted],
  ];
  const height = 48;
  ensureRoom(doc, height + 8);
  const y = doc.y;

  metrics.forEach(([label, value, color], index) => {
    const x = MARGIN + index * (width + gap);
    doc.roundedRect(x, y, width, height, 5).fill(COLORS.surface);
    doc.roundedRect(x, y, 4, height, 2).fill(color);
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(COLORS.muted)
      .text(label, x + 10, y + 8, { width: width - 18, height: 18 });
    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor(COLORS.text)
      .text(String(value), x + 10, y + 23, { width: width - 18 });
  });
  doc.y = y + height + 13;
}

function drawStatusChart(doc, summary) {
  const rows = [
    ['Con multas de laboratorio', summary.sgaWithFines, COLORS.accent],
    ['Consulta completa sin multa', summary.sgaClear, COLORS.success],
    ['Resultado no concluyente', summary.nonConclusive, COLORS.warning],
    ['SGA no configurado', summary.notConfigured, COLORS.muted],
  ];
  const maxCount = Math.max(1, ...rows.map(([, count]) => count));
  const labelWidth = 160;
  const countWidth = 32;
  const barWidth = doc.page.width - MARGIN * 2 - labelWidth - countWidth;
  const rowHeight = 18;
  ensureRoom(doc, rows.length * rowHeight + 10);

  rows.forEach(([label, count, color]) => {
    const y = doc.y;
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(COLORS.text)
      .text(label, MARGIN, y + 2, {
        width: labelWidth - 8,
      });
    doc.roundedRect(MARGIN + labelWidth, y + 3, barWidth, 10, 4).fill(COLORS.alternate);
    if (count > 0) {
      doc
        .roundedRect(MARGIN + labelWidth, y + 3, Math.max(5, (barWidth * count) / maxCount), 10, 4)
        .fill(color);
    }
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(COLORS.text)
      .text(String(count), MARGIN + labelWidth + barWidth + 6, y + 2, {
        width: countWidth,
        align: 'right',
      });
    doc.y = y + rowHeight;
  });
  doc.y += 5;
}

function drawTable(doc, headers, rows, widths, options = {}) {
  const fontSize = options.fontSize || 7;
  const headerHeight = options.headerHeight || 25;
  const padding = options.padding || 5;
  const drawHeader = () => {
    ensureRoom(doc, headerHeight + 22);
    let x = MARGIN;
    const y = doc.y;
    headers.forEach((header, index) => {
      doc.rect(x, y, widths[index], headerHeight).fill(COLORS.accentDeep);
      doc
        .font('Helvetica-Bold')
        .fontSize(7)
        .fillColor(COLORS.white)
        .text(header, x + padding, y + 6, {
          width: widths[index] - padding * 2,
          height: headerHeight - 8,
          align: 'left',
        });
      x += widths[index];
    });
    doc.y = y + headerHeight;
  };

  drawHeader();
  rows.forEach((cells, rowIndex) => {
    const height = measureRow(doc, cells, widths, fontSize, padding);
    if (doc.y + height > doc.page.height - FOOTER_HEIGHT - 10) {
      addReportPage(doc);
      drawHeader();
    }

    let x = MARGIN;
    const y = doc.y;
    cells.forEach((cell, index) => {
      doc
        .rect(x, y, widths[index], height)
        .fillAndStroke(rowIndex % 2 ? COLORS.alternate : COLORS.white, COLORS.border);
      doc
        .font('Helvetica')
        .fontSize(fontSize)
        .fillColor(COLORS.text)
        .text(asText(cell), x + padding, y + padding, {
          width: widths[index] - padding * 2,
          height: height - padding * 2,
          lineGap: 1,
        });
      x += widths[index];
    });
    doc.y = y + height;
  });
  doc.y += 10;
}

function addPageFooters(doc, generatedAt) {
  const pageRange = doc.bufferedPageRange();
  const generatedDate = generatedAt.toLocaleString('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Bogota',
  });

  for (
    let pageIndex = pageRange.start;
    pageIndex < pageRange.start + pageRange.count;
    pageIndex++
  ) {
    doc.switchToPage(pageIndex);
    const y = doc.page.height - 30;
    doc
      .moveTo(MARGIN, y - 8)
      .lineTo(doc.page.width - MARGIN, y - 8)
      .lineWidth(0.5)
      .strokeColor(COLORS.border)
      .stroke();
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(COLORS.muted)
      .text(`MiLab · Informe generado el ${generatedDate}`, MARGIN, y, {
        width: doc.page.width - MARGIN * 2 - 80,
      });
    doc
      .font('Helvetica-Bold')
      .fontSize(7)
      .fillColor(COLORS.accentDeep)
      .text(`Página ${pageIndex + 1} de ${pageRange.count}`, doc.page.width - MARGIN - 80, y, {
        width: 80,
        align: 'right',
      });
  }
}

function renderBulkSanctionReport(doc, students, { generatedAt = new Date() } = {}) {
  const rows = Array.isArray(students) ? students : [];
  const summary = summarizeBulkSanctions(rows);
  drawPageHeader(doc);

  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text(
      'Resumen de sanciones registradas en MILab y multas de laboratorio reportadas por SGA. Los estados parciales o no verificados se identifican para evitar interpretarlos como paz y salvo.',
      MARGIN,
      doc.y,
      { width: doc.page.width - MARGIN * 2 }
    );
  doc.moveDown(1);

  drawMetricCards(doc, summary);
  drawSectionTitle(doc, 'Estado de verificación en SGA');
  drawStatusChart(doc, summary);

  drawSectionTitle(
    doc,
    'Participantes consultados',
    'Incluye todos los estudiantes del lote, aunque no tengan sanciones o la consulta SGA haya quedado pendiente.'
  );
  drawTable(
    doc,
    ['Identificación', 'Estudiante', 'Programa', 'Estado de consulta SGA', 'Sanciones'],
    rows.map((student) => [
      identification(student),
      asText(student.nombre),
      asText(student.programa),
      [
        getSgaStatusLabel(student.sgaStatus),
        ['partial', 'error', 'unresolved'].includes(student.sgaStatus)
          ? asText(student.sgaMessage, '')
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
      sanctionCountLabel(student),
    ]),
    [105, 115, 70, 170, 72],
    { fontSize: 7 }
  );

  drawSectionTitle(
    doc,
    'Detalle de sanciones y multas de laboratorio',
    'Los datos SGA se presentan junto con su concepto, estado, periodo, valor y fecha de pago cuando esos campos están disponibles.'
  );
  const details = rows.flatMap((student) =>
    getSanctions(student).map((fine) => detailRow(student, fine))
  );
  if (details.length) {
    drawTable(
      doc,
      [
        'ID',
        'Estudiante',
        'Origen',
        'Detalle',
        'Concepto / UAL',
        'Estado / fecha',
        'Periodo / valor / pago',
      ],
      details,
      [42, 96, 45, 86, 96, 78, 89],
      { fontSize: 6.5, padding: 4, headerHeight: 30 }
    );
  } else {
    ensureRoom(doc, 30);
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(COLORS.muted)
      .text(
        'No se registraron sanciones de MILab ni multas de laboratorio en el lote.',
        MARGIN,
        doc.y
      );
    doc.moveDown(1);
  }

  addPageFooters(doc, generatedAt);
  return summary;
}

module.exports = {
  getSanctions,
  getSgaStatusLabel,
  renderBulkSanctionReport,
  summarizeBulkSanctions,
};
