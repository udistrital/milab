const express = require('express');
const router = express.Router();
const { requireRoles } = require('../middlewares/auth');
const {
  getSgaConceptName,
  resolveSgaConceptName,
  sgaDebtService,
} = require('../../libs/oati-debts');
const { renderBulkSanctionReport } = require('../../libs/bulk-sanction-report');
const {
  renderApplicationError,
  respondOatiUnavailable,
  wantsJson,
} = require('../middlewares/error-handler');

const bp = require('body-parser');

const pool = require('../../libs/db');
router.use(bp.json({ limit: '512kb' }));
router.use(bp.urlencoded({ extended: true, limit: '512kb' }));

const MAX_BULK_QUERY_CODES = 20;

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
  const conceptCode = String(debt.codigo_concepto || debt.DEU_CPTO_COD || '').trim();
  const conceptName =
    debt.nombre_concepto ||
    getSgaConceptName(debt) ||
    resolveSgaConceptName(conceptCode) ||
    (conceptCode ? `Código SGA ${conceptCode}` : 'No reportado por SGA');
  const amount = debt.valor ?? debt.DEU_MULTA;
  const details = [
    amount !== null && amount !== undefined && amount !== '' ? `Valor SGA: ${amount}` : '',
    debt.anio || debt.DEU_ANO || debt.periodo || debt.DEU_PER
      ? `Periodo: ${debt.anio || debt.DEU_ANO || '-'} / ${debt.periodo || debt.DEU_PER || '-'}`
      : '',
    debt.fecha_pago || debt.DEU_FECHA_PAGO
      ? `Fecha de pago: ${debt.fecha_pago || debt.DEU_FECHA_PAGO}`
      : '',
  ].filter(Boolean);

  return {
    origen: 'SGA',
    id_sga: debt.id_sga || debt.DEU_ID || null,
    cat_multa: debt.categoria || debt.DEU_MATERIAL || 'Multa reportada por SGA',
    con_estado_multa: `ACTIVA (estado SGA ${String(debt.estado || debt.DEU_ESTADO || '2').trim()})`,
    fecha_multa: debt.fecha || debt.DEU_FECHA || null,
    obs_multa: details.join('; ') || 'Multa activa reportada por SGA.',
    nombre_laboratorista: '-',
    ual: conceptName,
    codigo_ubicacion_sga: conceptCode || null,
    documento: student.documento || null,
    codigo: debt.codigo_estudiante || debt.DEU_EST_COD || student.codigo || null,
    tipo_concepto: debt.tipo_concepto || debt.CPTO_TIPO || debt.DEU_CPTO_TIPO || null,
    valor_sga: amount ?? null,
    periodo_sga: debt.periodo || debt.DEU_PER || null,
    anio_sga: debt.anio || debt.DEU_ANO || null,
    fecha_pago_sga: debt.fecha_pago || debt.DEU_FECHA_PAGO || null,
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
        multa.codigo_ubicacion_sga
          ? `${multa.ual || '-'} (código SGA ${multa.codigo_ubicacion_sga})`
          : multa.ual || '',
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
    if (error?.code === 'OATI_UNAVAILABLE') {
      return respondOatiUnavailable(req, res);
    }
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
  const entries = [
    ...new Set(
      rawInput
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ];

  if (entries.length > MAX_BULK_QUERY_CODES) {
    const message = `Has excedido el límite de ${MAX_BULK_QUERY_CODES} estudiantes, inténtalo nuevamente.`;
    if (wantsJson(req)) {
      return res.status(400).json({ ok: false, message });
    }
    return res.render('home/consulta_masiva', {
      sampleData1: [],
      error: message,
      sgaConsultaOmitida: !sgaDebtService.isConfigured(),
    });
  } else {
    try {
      const query = `
                  SELECT
                  t.identificador,
                  MAX(pe.nombre) AS nombre,
                  MAX(pe.documento) AS documento,
                  MAX(pe.codigo::text) AS codigo,
                  MAX(pe.programa::text) AS programa,
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
                                'laboratorio_facultad', COALESCE(facultad.nombre, unidad.nombre),
                                'laboratorio_dependencia', CASE WHEN unidad.padre_id IS NULL THEN NULL ELSE unidad.nombre END,
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
                  LEFT JOIN dependencia_facultad unidad ON unidad.dependencia_facultad_id = u.facultad_id
                  LEFT JOIN dependencia_facultad facultad ON facultad.dependencia_facultad_id = unidad.padre_id
                  LEFT JOIN laboratorista l ON l.documento = m.laboratorista_documento_id
                  GROUP BY
                    t.identificador;
                `;
      const values = [entries.join(',')];
      const sampleData1 = await pool.query(query, values);

      const sgaConfigurado = sgaDebtService.isConfigured();
      const filteredData = sampleData1.rows.map((row) => ({
        identificador: row.identificador,
        nombre: row.nombre || null,
        documento: row.documento || null,
        codigo: row.codigo || null,
        programa: row.programa || null,
        sgaStatus: sgaConfigurado ? 'pending' : 'not_configured',
        sgaMessage: sgaConfigurado
          ? 'La consulta de SGA está pendiente.'
          : 'El servicio SGA no está configurado en este ambiente.',
        sgaCodes: [],
        sgaSummary: null,
        multas: (Array.isArray(row.multas) ? row.multas : [])
          .filter((multa) => multa !== null)
          .map((multa) => ({ ...multa, origen: 'MILab' })),
      }));

      await Promise.all(
        filteredData.map(async (row) => {
          if (sgaConfigurado) {
            const sgaResult = await sgaDebtService.queryStudent({
              codigo: row.codigo,
              documento: row.documento,
              identificador: row.codigo || row.documento ? undefined : row.identificador,
            });
            row.sgaStatus = sgaResult.status;
            row.sgaMessage = sgaResult.message;
            row.sgaCodes = sgaResult.codes;
            row.sgaSummary = {
              nonLaboratoryCount: sgaResult.nonLaboratoryCount,
              unclassifiedCount: sgaResult.unclassifiedCount,
            };
            if (sgaResult.document && !row.documento) row.documento = sgaResult.document;
            if (!row.codigo && sgaResult.studentRecord?.codigo) {
              row.codigo = String(sgaResult.studentRecord.codigo);
            } else if (!row.codigo && sgaResult.codes.length) {
              row.codigo = sgaResult.codes[0];
            }
            if (!row.nombre) {
              row.nombre =
                sgaResult.studentRecord?.nombre || sgaResult.studentRecord?.nombre_completo || null;
            }
            if (!row.programa) {
              row.programa =
                sgaResult.studentRecord?.carrera || sgaResult.studentRecord?.programa || null;
            }
            row.multas.push(...sgaResult.debts.map((debt) => mapSgaDebtToMulta(debt, row)));

            if (['partial', 'error', 'unresolved'].includes(sgaResult.status)) {
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
    } catch (error) {
      if (error?.code === 'OATI_UNAVAILABLE') {
        return respondOatiUnavailable(req, res);
      }
      console.error(error);
      if (wantsJson(req)) {
        return res.status(500).json({
          ok: false,
          message: 'No fue posible completar la consulta masiva.',
          message2: 'Intenta nuevamente en unos minutos.',
        });
      }
      return renderApplicationError(res, {
        status: 500,
        message: 'No fue posible completar la consulta masiva.',
        message2: 'Intenta nuevamente en unos minutos.',
        limit: null,
      });
    }
  }
});

async function generateBulkSanctionPdf(req, res) {
  res.set('Cache-Control', 'no-store');
  const PDFDocument = require('pdfkit');

  let sampleData1;
  try {
    const serializedData = req.method === 'GET' ? req.query.data : req.body?.data;
    sampleData1 = JSON.parse(serializedData || '[]');
  } catch {
    sampleData1 = null;
  }

  if (!Array.isArray(sampleData1) || sampleData1.length > MAX_BULK_QUERY_CODES) {
    const message = Array.isArray(sampleData1)
      ? `No se puede generar un informe con más de ${MAX_BULK_QUERY_CODES} estudiantes.`
      : 'Los datos del informe no son válidos.';
    if (wantsJson(req)) {
      return res.status(400).json({ ok: false, message });
    }
    return res.status(400).render('home/message_error', {
      message,
      message2: 'Verifica la consulta e inténtalo nuevamente.',
      limit: null,
    });
  }

  if (!sampleData1.length) {
    return res.status(400).render('home/message_error', {
      message: 'No hay estudiantes para incluir en el informe.',
      message2: 'Realiza una consulta masiva antes de generar el PDF.',
      limit: null,
    });
  }

  try {
    const doc = new PDFDocument({ size: 'LETTER', margin: 40, bufferPages: true });
    const chunks = [];
    const pdfBuffer = await new Promise((resolve, reject) => {
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      try {
        renderBulkSanctionReport(doc, sampleData1);
        doc.end();
      } catch (error) {
        reject(error);
      }
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=consulta_estudiantes.pdf');
    return res.send(pdfBuffer);
  } catch (error) {
    console.error('Error generando el informe PDF de consulta masiva:', error);
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
}

router.get('/generate_pdf', requireBulkStudentQueryAccess, generateBulkSanctionPdf);
router.post('/generate_pdf', requireBulkStudentQueryAccess, generateBulkSanctionPdf);

module.exports = router;
module.exports.buildPdfTableRows = buildPdfTableRows;
