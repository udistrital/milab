const express = require('express');
const router = express.Router();
const { requireRoles } = require('../middlewares/auth');
const { sgaDebtService } = require('../../libs/oati-debts');
const { renderApplicationError, wantsJson } = require('../middlewares/error-handler');

const bp = require('body-parser');

const pool = require('../../libs/db');
router.use(bp.json());
router.use(bp.urlencoded({ extended: true }));

const path = require('path');

const requireAdminStudentsListAccess = requireRoles('admin', {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

const requireBulkStudentQueryAccess = requireRoles(['admin', 'laboratorista', 'coordinador'], {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

function mapSgaDebtToMulta(debt, student) {
  const details = [
    debt.DEU_MULTA ? `Valor SGA: ${debt.DEU_MULTA}` : '',
    debt.DEU_ANO || debt.DEU_PER ? `Periodo: ${debt.DEU_ANO || '-'} / ${debt.DEU_PER || '-'}` : '',
    debt.DEU_FECHA_PAGO ? `Fecha de pago: ${debt.DEU_FECHA_PAGO}` : '',
  ].filter(Boolean);

  return {
    origen: 'SGA',
    cat_multa: debt.DEU_MATERIAL || 'Multa reportada por SGA',
    con_estado_multa: `ACTIVA (estado SGA ${String(debt.DEU_ESTADO || '2').trim()})`,
    fecha_multa: debt.DEU_FECHA || null,
    obs_multa: details.join('; ') || 'Multa activa reportada por SGA.',
    nombre_laboratorista: '-',
    ual: 'SGA',
    documento: student.documento || null,
    codigo: debt.DEU_EST_COD || student.codigo || null,
  };
}

const PDF_MARKER_ROWS = {
  unknown: ['-', 'Datos inválidos. Verifica la información e inténtalo nuevamente.', '', '', ''],
  'sga-error': [
    'SGA',
    'No fue posible verificar el estado en SGA.',
    '',
    'Estado sin verificar',
    '',
  ],
};

function buildPdfTableRows(students) {
  const rows = [];

  (Array.isArray(students) ? students : []).forEach((item) => {
    const multas = Array.isArray(item?.multas) && item.multas.length ? item.multas : [null];

    multas.forEach((multa) => {
      if (multa === null || multa === undefined) {
        rows.push([
          item.identificador,
          '-',
          'El estudiante no tiene multas',
          '',
          'El estudiante está a paz y salvo',
          '',
        ]);
        return;
      }

      if (typeof multa === 'string') {
        const markerRow = PDF_MARKER_ROWS[multa] || ['-', multa, '', '', ''];
        rows.push([item.identificador, ...markerRow]);
        return;
      }

      rows.push([
        item.identificador,
        multa.origen || 'MILab',
        multa.cat_multa || '-',
        multa.fecha_multa || '',
        multa.obs_multa || '',
        multa.ual || '',
      ]);
    });
  });

  return rows;
}

router.get('/', requireAdminStudentsListAccess, async (req, res) => {
  res.set('Cache-Control', 'no-store');

  const requestedType = typeof req.query.tipo === 'string' ? req.query.tipo.trim() : 'todos';
  const selectedType = ['todos', 'estudiante', 'docente'].includes(requestedType)
    ? requestedType
    : 'todos';

  try {
    const filters = [];
    const values = [];

    if (selectedType !== 'todos') {
      values.push(selectedType);
      filters.push(`tipo_registro = $${values.length}`);
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    const query = `
      WITH certificados AS (
        SELECT
          'estudiante' AS tipo_registro,
          ce.id,
          pe.nombre,
          pe.documento AS documento,
          pe.codigo::TEXT AS codigo,
          pe.programa,
          pe.estado AS estado,
          ce.fecha_creacion,
          ce.fecha_vencimiento,
          ce.certificado_id,
          ce.correo,
          ce.motivo_exp,
          ce.multa::TEXT AS multa
        FROM certificado_estudiante ce
        LEFT JOIN perfil_estudiante pe ON pe.usuario_id = ce.usuario_id

        UNION ALL

        SELECT
          'docente' AS tipo_registro,
          cd.id,
          pd.nombre,
          pd.documento AS documento,
          NULL::TEXT AS codigo,
          NULL::TEXT AS programa,
          pd.estado AS estado,
          cd.fecha_creacion::TIMESTAMP AS fecha_creacion,
          NULL::TIMESTAMP AS fecha_vencimiento,
          cd.certificado_id,
          cd.correo,
          cd.motivo_exp,
          cd.multa::TEXT AS multa
        FROM certificado_docente cd
        LEFT JOIN perfil_docente pd ON pd.usuario_id = cd.usuario_id
      )
      SELECT *
      FROM certificados
      ${whereClause}
      ORDER BY fecha_creacion DESC NULLS LAST, id DESC
    `;

    const result = await pool.query(query, values);
    const rows = result.rows;
    res.render('home/get_list_estudiantes', {
      sampleData1: rows,
      selectedType,
    });
  } catch (error) {
    console.error(error);

    if (wantsJson(req)) {
      return res.status(500).json({
        ok: false,
        message: 'No fue posible cargar el listado de certificados.',
        message2: 'Intenta nuevamente en unos minutos.',
      });
    }

    return renderApplicationError(res, {
      status: 500,
      message: 'No fue posible cargar el listado de certificados.',
      message2: 'Intenta nuevamente en unos minutos.',
      limit: null,
    });
  }
});

router.get('/get_consulta', requireBulkStudentQueryAccess, async function (req, res) {
  res.set('Cache-Control', 'no-store');
  res.render('home/consulta_masiva', {
    sampleData1: 0,
    error: null,
    sgaConsultaOmitida: !sgaDebtService.isConfigured(),
  });
});

router.post('/consulta_masiva', requireBulkStudentQueryAccess, async function (req, res) {
  res.set('Cache-Control', 'no-store');
  const rawInput = String(req.body.consulta_masiva || '');
  const entries = rawInput
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (entries.length > 20) {
    res.render('home/consulta_masiva', {
      sampleData1: 0,
      error: 'Has excedido el límite de 20 estudiantes, inténtalo nuevamente.',
      sgaConsultaOmitida: !sgaDebtService.isConfigured(),
    });
  } else {
    const query = `
                  SELECT
                  t.identificador,
                  MAX(pe.documento) AS documento,
                  MAX(pe.codigo::text) AS codigo,
                    json_agg(
                        CASE 
                            WHEN m.id IS NOT NULL
                            THEN json_build_object(
                                'cat_multa', m.cat_multa,
                              'nombre_laboratorista', l.nombre,
                              'cc_laboratorista', l.documento,
                                'documento', pe.documento,
                                'codigo', pe.codigo::text,
                              'ual', u.nombre,
                                'fecha_multa', m.fecha_multa,
                                'con_estado_multa', m.con_estado_multa,
                                'obs_multa', m.obs_multa
                            )
                            ELSE NULL
                        END
                    ) AS multas
                  FROM
                    UNNEST(STRING_TO_ARRAY($1, ',')) AS t(identificador)
                  LEFT JOIN perfil_estudiante pe
                    ON pe.codigo::text = t.identificador
                    OR pe.documento = t.identificador
                  LEFT JOIN multa m ON m.usuario_sancionado_id = pe.usuario_id
                  LEFT JOIN ual u ON u.ual_id = m.ual_id
                  LEFT JOIN laboratorista l ON l.documento = m.laboratorista_documento_id
                  GROUP BY
                    t.identificador;
                `;
    const values = [entries.join(',')];
    const sampleData1 = await pool.query(query, values);

    const sgaConfigurado = sgaDebtService.isConfigured();
    const filteredData = sampleData1.rows.map((row) => ({
      identificador: row.identificador,
      documento: row.documento || null,
      codigo: row.codigo || null,
      multas: (Array.isArray(row.multas) ? row.multas : [])
        .filter((multa) => multa !== null)
        .map((multa) => ({ ...multa, origen: 'MILab' })),
    }));

    await Promise.all(
      filteredData.map(async (row) => {
        const tieneMultasMilab = row.multas.length > 0;
        let codigoEstudiante = String(row.codigo || '').trim();

        if (!codigoEstudiante && (!tieneMultasMilab || sgaConfigurado)) {
          codigoEstudiante =
            (await sgaDebtService.resolveStudentCode({
              documento: row.documento,
              identificador: row.identificador,
            })) || '';
          if (!codigoEstudiante && !tieneMultasMilab) {
            row.multas = ['unknown'];
            return;
          }

          row.codigo = codigoEstudiante || row.codigo;
        }

        if (sgaConfigurado) {
          if (!codigoEstudiante) {
            row.multas.push('sga-error');
            return;
          }

          try {
            const activeSgaDebts = await sgaDebtService.getActiveDebts({
              codigo: codigoEstudiante,
            });
            row.multas.push(...activeSgaDebts.map((debt) => mapSgaDebtToMulta(debt, row)));
          } catch (error) {
            console.error(`Error consultando multas SGA para ${codigoEstudiante}:`, error);
            row.multas.push('sga-error');
          }
        }

        if (!row.multas.length) {
          row.multas = [null];
        }
      })
    );
    res.render('home/consulta_masiva', {
      sampleData1: filteredData,
      error: null,
      sgaConsultaOmitida: !sgaConfigurado,
    });
  }
});

router.get('/generate_pdf', requireBulkStudentQueryAccess, async function (req, res) {
  res.set('Cache-Control', 'no-store');
  const PDFDocument = require('pdfkit');

  const sampleData1 = JSON.parse(req.query.data || '[]');

  if (sampleData1.length > 0) {
    const doc = new PDFDocument();
    const fileName = 'consulta_estudiantes.pdf';

    try {
      //  imagen izquierda
      const leftImagePath = path.join(__dirname, '../../public/img/Logo_Laboratorioss.png');
      doc.image(leftImagePath, 20, 20, { width: 100, height: 100 });

      //  imagen derecha
      const rightImagePath = path.join(__dirname, '../../public/img/Logo_Escudo_Verticall.jpg');
      doc.image(rightImagePath, doc.page.width - 120, 20, { width: 100, height: 100 });
    } catch (error) {
      console.error('Error al cargar la imagen:', error);

      if (wantsJson(req)) {
        return res.status(500).json({
          ok: false,
          message: 'No fue posible generar el PDF de consulta masiva.',
          message2: 'Intenta nuevamente en unos minutos.',
        });
      }

      return renderApplicationError(res, {
        status: 500,
        message: 'No fue posible generar el PDF de consulta masiva.',
        message2: 'Intenta nuevamente en unos minutos.',
        limit: null,
      });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
    doc.pipe(res);

    doc.fontSize(16).text('Universidad Distrital Francisco José de Caldas', { align: 'center' });

    doc.fontSize(14).text('COORDINACIÓN GENERAL DE LABORATORIOS', { align: 'center' }).moveDown(1);

    const textYPosition = 140;
    const tableWidth = doc.page.width - 40;
    doc
      .fontSize(12)
      .text(
        'Este es un informe masivo del estado de los estudiantes en las unidades académicas de laboratorios de la Universidad Distrital Francisco José de Caldas. A continuación, se listan los estudiantes consultados por código o documento (los estudiantes sin ningún problema aparecerán a paz y salvo).',
        20,
        textYPosition,
        { width: tableWidth, align: 'justify' }
      )
      .moveDown(1);

    //  fila de encabezado  columnas
    const numberOfColumns = 6;
    const cellWidth = (doc.page.width - 40) / numberOfColumns;
    const startX = 20; // Posición de inicio con margen
    let y = doc.y;

    //  encabezado tabla
    doc.fontSize(14).font('Helvetica-Bold');
    doc.rect(startX, y, cellWidth * numberOfColumns, 30).fillAndStroke('black', 'black');
    doc.fillColor('white');
    doc.text('Consulta de Estudiantes', startX, y + 5, {
      width: cellWidth * numberOfColumns,
      align: 'center',
    });
    y += 30;

    doc.fillColor('black');

    const tableHeaders = [
      'Código/Documento Estudiante',
      'Origen',
      'Motivo Multa',
      'Fecha de la Multa',
      'Observación',
      'UAL',
    ]; //'Estado Multa'
    const tableRows = buildPdfTableRows(sampleData1);

    //  encabezados tabla
    doc.fontSize(12).font('Helvetica');
    tableHeaders.forEach((header, idx) => {
      doc.rect(startX + idx * cellWidth, y, cellWidth, 30).fillAndStroke('gray', 'black');
      doc.fillColor('black');
      doc.text(header, startX + idx * cellWidth + 5, y + 5, {
        width: cellWidth - 10,
        align: 'center',
      });
    });
    y += 30;

    //  filas tabla   máximo de 3 filas
    doc.fontSize(12).font('Helvetica');
    let rowCount = 0;
    tableRows.forEach((row) => {
      let maxHeight = 30; // Altura mínima de una fila
      row.forEach((cell) => {
        const textHeight = doc.heightOfString(cell, { width: cellWidth - 10 });
        maxHeight = Math.max(maxHeight, textHeight + 10);
      });

      // Verificar  altura
      if (rowCount >= 3 || y + maxHeight > doc.page.height - 40) {
        // 40 para el margen inferior
        doc.addPage();
        y = 40;
        rowCount = 0;

        //  encabezados nueva página
        doc.fontSize(12).font('Helvetica');
        tableHeaders.forEach((header, i) => {
          doc.rect(startX + i * cellWidth, y, cellWidth, 30).fillAndStroke('gray', 'black');
          doc.fillColor('black');
          doc.text(header, startX + i * cellWidth + 5, y + 5, {
            width: cellWidth - 10,
            align: 'center',
          });
        });
        y += 30;
      }

      //  celdas de la fila en la tabla
      row.forEach((cell, i) => {
        doc.rect(startX + i * cellWidth, y, cellWidth, maxHeight).stroke();
        doc.text(cell, startX + i * cellWidth + 5, y + 5, {
          width: cellWidth - 10,
          align: 'center',
        });
      });
      y += maxHeight;
      rowCount++;
    });

    const currentDate = new Date().toLocaleDateString('es-ES', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    doc
      .fontSize(10)
      .text(
        `Se emite en Bogotá D.C. a través de MILab de la Coordinación General de Laboratorios de la Universidad Distrital Francisco José de Caldas el ${currentDate}`,
        startX,
        y + 10,
        { align: 'center' }
      );

    doc.end();
  } else {
    res.render('home/message_error', {
      message: '¡Algo ha salido mal!',
      message2: 'Inténtalo nuevamente',
      limit: null,
    });
  }
});

module.exports = router;
module.exports.buildPdfTableRows = buildPdfTableRows;
