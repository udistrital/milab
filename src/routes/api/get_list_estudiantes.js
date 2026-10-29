const express = require('express');
const router = express.Router();
const { requireRoles } = require('../middlewares/auth');
const { resolveSgaLaboratoryConceptName, sgaDebtService } = require('../../libs/oati-debts');
const { getAcademicServicePath, requestOati } = require('../../libs/oati-client');
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

const MAX_BULK_QUERY_CODES = 50;
const BULK_QUERY_CONCURRENCY = 4;

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
  const conceptName = resolveSgaLaboratoryConceptName(conceptCode);
  if (!conceptName) return null;
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

function isProgramCode(value) {
  return /^\d+$/.test(String(value ?? '').trim());
}

function getCareerName(response) {
  const career = response?.carrerasCollection?.carrera;
  const record = Array.isArray(career) ? career[0] : career;
  return String(record?.nombre ?? '').trim() || null;
}

async function resolveProgramName(localProgram, studentRecord, programCache) {
  const localValue = String(localProgram ?? '').trim();
  if (localValue && !isProgramCode(localValue)) return { name: localValue, error: null };

  const recordPrograms = [studentRecord?.carrera, studentRecord?.programa]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
  const recordName = recordPrograms.find((value) => !isProgramCode(value));
  if (recordName) return { name: recordName, error: null };

  const programCode =
    (localValue && isProgramCode(localValue) ? localValue : '') ||
    recordPrograms.find(isProgramCode);
  if (!programCode) {
    return { name: null, error: 'OATI no reportó el programa del estudiante.' };
  }

  if (!programCache.has(programCode)) {
    const lookup = Promise.resolve()
      .then(() => requestOati(getAcademicServicePath(`carrera/${encodeURIComponent(programCode)}`)))
      .then(getCareerName);
    programCache.set(programCode, lookup);
  }

  try {
    const name = await programCache.get(programCode);
    return name
      ? { name, error: null }
      : { name: null, error: 'OATI no reportó el nombre del programa.' };
  } catch {
    return { name: null, error: 'No fue posible consultar el nombre del programa en OATI.' };
  }
}

async function forEachWithConcurrency(items, concurrency, callback) {
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        await callback(items[index], index);
      }
    })
  );
}

function writeProgressEvent(res, event) {
  if (res.destroyed || res.writableEnded) return;
  res.write(`${JSON.stringify(event)}\n`);
  if (typeof res.flush === 'function') res.flush();
}

function sendProgressError(res, status, message) {
  if (res.headersSent) {
    writeProgressEvent(res, { type: 'error', message });
    res.end();
    return;
  }

  res
    .status(status)
    .set('Content-Type', 'application/x-ndjson; charset=utf-8')
    .set('Cache-Control', 'no-store, no-transform')
    .send(`${JSON.stringify({ type: 'error', message })}\n`);
}

function isProgressStreamRequest(req) {
  return String(req.get('accept') || '')
    .split(',')
    .some((value) => value.trim().startsWith('application/x-ndjson'));
}

async function fetchBulkStudentRows(entries) {
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
    FROM UNNEST(STRING_TO_ARRAY($1, ',')) WITH ORDINALITY AS t(identificador, orden)
    LEFT JOIN perfil_estudiante pe
      ON pe.codigo::text = t.identificador
      OR pe.documento = t.identificador
    LEFT JOIN multa m ON m.usuario_sancionado_id = pe.usuario_id
    LEFT JOIN ual u ON u.ual_id = m.ual_id
    LEFT JOIN dependencia_facultad unidad ON unidad.dependencia_facultad_id = u.facultad_id
    LEFT JOIN dependencia_facultad facultad ON facultad.dependencia_facultad_id = unidad.padre_id
    LEFT JOIN laboratorista l ON l.documento = m.laboratorista_documento_id
    GROUP BY t.identificador, t.orden
    ORDER BY t.orden
  `;
  const result = await pool.query(query, [entries.join(',')]);
  return result.rows;
}

function buildBulkStudentRows(rows, sgaConfigured) {
  return rows.map((row) => ({
    identificador: row.identificador,
    nombre: row.nombre || null,
    documento: row.documento || null,
    codigo: row.codigo || null,
    programa: row.programa || null,
    programaError: null,
    sgaStatus: sgaConfigured ? 'pending' : 'not_configured',
    sgaMessage: sgaConfigured
      ? 'La consulta de SGA está pendiente.'
      : 'El servicio SGA no está configurado en este ambiente.',
    sgaCodes: [],
    sgaSummary: null,
    multas: (Array.isArray(row.multas) ? row.multas : [])
      .filter((multa) => multa !== null)
      .map((multa) => ({ ...multa, origen: 'MILab' })),
  }));
}

async function processBulkStudentRows(rows, { sgaConfigured, onProgress } = {}) {
  const programCache = new Map();
  let completed = 0;

  await forEachWithConcurrency(rows, BULK_QUERY_CONCURRENCY, async (row) => {
    const identifier = row.documento || row.identificador;
    const identifierType = row.documento ? 'Documento' : 'Código';
    const studentName = row.nombre || row.codigo || row.identificador;
    onProgress?.({
      stage: 'student',
      identifier,
      identifierType,
      studentName,
      message: `Consultando ${identifierType.toLowerCase()} ${identifier}`,
    });

    let sgaResult = null;
    if (sgaConfigured) {
      onProgress?.({
        stage: 'identity',
        identifier,
        identifierType,
        studentName,
        message: `Verificando identidad en SGA · ${identifierType.toLowerCase()} ${identifier}`,
      });
      sgaResult = await sgaDebtService.queryStudent({
        codigo: row.codigo,
        documento: row.documento,
        identificador: row.codigo || row.documento ? undefined : row.identificador,
        onProgress: (progress) => {
          if (progress.stage !== 'debts') return;
          const resolvedName =
            progress.studentRecord?.nombre ||
            progress.studentRecord?.nombre_completo ||
            studentName;
          onProgress?.({
            stage: 'sga',
            identifier,
            identifierType,
            studentName: resolvedName,
            message: `Verificando multas SGA · ${resolvedName}`,
          });
        },
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
    }

    const program = await resolveProgramName(row.programa, sgaResult?.studentRecord, programCache);
    row.programa = program.name;
    row.programaError = program.error;

    onProgress?.({
      stage: 'condensing',
      identifier,
      identifierType,
      studentName: row.nombre || studentName,
      message: `Condensando información · ${row.nombre || studentName}`,
    });

    if (sgaResult) {
      row.multas.push(
        ...sgaResult.debts.map((debt) => mapSgaDebtToMulta(debt, row)).filter(Boolean)
      );
      if (['partial', 'error', 'unresolved'].includes(sgaResult.status)) {
        row.multas.push('sga-error');
      }
    }

    if (!row.multas.length) row.multas = [null];
    completed += 1;
    onProgress?.({
      stage: 'complete',
      identifier,
      identifierType,
      studentName: row.nombre || studentName,
      completed,
      total: rows.length,
      message: `Estudiante procesado · ${row.nombre || studentName}`,
    });
  });

  return rows;
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
    maxBulkQueryCodes: MAX_BULK_QUERY_CODES,
  });
});

router.post('/consulta_masiva', requireBulkStudentQueryAccess, async function (req, res) {
  res.set('Cache-Control', 'no-store');
  const progressStream = isProgressStreamRequest(req);
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
    if (progressStream) return sendProgressError(res, 400, message);
    if (wantsJson(req)) {
      return res.status(400).json({ ok: false, message });
    }
    return res.render('home/consulta_masiva', {
      sampleData1: [],
      error: message,
      sgaConsultaOmitida: !sgaDebtService.isConfigured(),
      maxBulkQueryCodes: MAX_BULK_QUERY_CODES,
    });
  }

  if (progressStream) {
    res
      .status(200)
      .set('Content-Type', 'application/x-ndjson; charset=utf-8')
      .set('Cache-Control', 'no-store, no-transform')
      .set('X-Accel-Buffering', 'no');
    res.flushHeaders();
  }

  const sendProgress = (progress) => {
    if (!progressStream) return;
    const total = progress.total ?? entries.length;
    const completed = progress.completed ?? 0;
    writeProgressEvent(res, {
      type: 'progress',
      total,
      completed,
      percent: total ? Math.round((completed / total) * 100) : 0,
      ...progress,
    });
  };

  try {
    sendProgress({
      stage: 'data',
      message: 'Gestionando datos del lote',
      completed: 0,
      total: entries.length,
    });

    const rows = await fetchBulkStudentRows(entries);
    const sgaConfigured = sgaDebtService.isConfigured();
    const students = buildBulkStudentRows(rows, sgaConfigured);
    await processBulkStudentRows(students, {
      sgaConfigured,
      onProgress: sendProgress,
    });

    const locals = {
      sampleData1: students,
      error: null,
      sgaConsultaOmitida: !sgaConfigured,
      maxBulkQueryCodes: MAX_BULK_QUERY_CODES,
    };

    if (!progressStream) return res.render('home/consulta_masiva', locals);

    sendProgress({
      stage: 'done',
      message: 'Informe generado',
      completed: entries.length,
      total: entries.length,
    });
    return res.render('home/consulta_masiva', locals, (renderError, html) => {
      if (renderError) {
        console.error('Error renderizando el informe de consulta masiva:', renderError);
        return sendProgressError(
          res,
          500,
          'No fue posible preparar el informe masivo. Intenta nuevamente.'
        );
      }

      writeProgressEvent(res, { type: 'result', html });
      res.end();
    });
  } catch (error) {
    if (progressStream) {
      console.error('Error procesando la consulta masiva:', error);
      return sendProgressError(
        res,
        500,
        'No fue posible completar la consulta masiva. Intenta nuevamente.'
      );
    }
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
