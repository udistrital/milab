const express = require('express');
const XLSX = require('xlsx');
const pool = require('../../libs/db');
const { ArkaIntegrationError } = require('../../libs/arka-reconciliation-client');
const { createArkaReconciliationService } = require('../../libs/arka-reconciliation-service');
const { normalizeRoles } = require('../../libs/roles');
const { requireRoles } = require('../middlewares/auth');

const router = express.Router();
const service = createArkaReconciliationService();
const PAGE_URL = '/milab/inventarios/conciliaciones-arka';

const requireReconciliationAccess = requireRoles(
  ['admin', 'administrador', 'coordinador_general', 'coordinador'],
  {
    message: 'Acceso denegado',
    message2: 'No tienes permisos para consultar conciliaciones ARKA.',
    limit: 'loginOnly',
  }
);
const requireReconciliationAdmin = requireRoles(['admin', 'administrador'], {
  message: 'Acceso denegado',
  message2: 'Solo un administrador puede iniciar las corridas de conciliación ARKA.',
  limit: 'loginOnly',
});

function parsePositiveId(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function getUserRoles(req) {
  return normalizeRoles(req.session?.user?.roles || req.session?.user?.tipo);
}

function isGlobalViewer(req) {
  return getUserRoles(req).some((role) =>
    ['admin', 'administrador', 'coordinador_general', 'coordinador general'].includes(role)
  );
}

function getUserDocument(req) {
  return String(req.session?.user?.documento || '').trim();
}

async function getVisibleLaboratories(req) {
  const result = await pool.query(
    `
      SELECT DISTINCT
        u.ual_id,
        u.nombre AS laboratorio,
        df.dependencia_facultad_id AS dependencia_id,
        CASE
          WHEN df.padre_id IS NOT NULL THEN df.dependencia_facultad_id
          ELSE NULL
        END AS dependencia_filtro_id,
        faculty.dependencia_facultad_id AS facultad_id,
        faculty.nombre AS facultad,
        CASE WHEN df.padre_id IS NOT NULL THEN df.nombre END AS dependencia,
        encargado.coordinador_documento,
        COALESCE(NULLIF(TRIM(c.nombre), ''), encargado.coordinador_documento) AS coordinador_nombre
      FROM coordinador_ual_encargado encargado
      JOIN coordinador c
        ON c.documento = encargado.coordinador_documento
       AND c.activo = TRUE
      JOIN ual u
        ON u.ual_id = encargado.ual_id
       AND u.activo = TRUE
      JOIN dependencia_facultad df
        ON df.dependencia_facultad_id = u.facultad_id
      JOIN dependencia_facultad faculty
        ON faculty.dependencia_facultad_id = COALESCE(df.padre_id, df.dependencia_facultad_id)
      JOIN inventario_estado_laboratorio estado
        ON estado.ual_id = u.ual_id
       AND estado.tipo_inventario = 'equipo_arka'
       AND estado.estado = 'aprobado'
      WHERE EXISTS (
          SELECT 1
          FROM inventario i
          WHERE i.laboratorio_ual_id = u.ual_id
            AND i.tipo_inventario = 'equipo_arka'
            AND i.estado_aprobacion = 'aprobado'
            AND i.activo = TRUE
        )
        AND (
          $1::boolean
          OR encargado.coordinador_documento = $2
        )
      ORDER BY facultad, dependencia, laboratorio
    `,
    [isGlobalViewer(req), getUserDocument(req)]
  );
  return result.rows;
}

function buildFilterOptions(laboratories) {
  const faculties = new Map();
  const dependencies = new Map();
  laboratories.forEach((laboratory) => {
    faculties.set(laboratory.facultad_id, laboratory.facultad);
    if (laboratory.dependencia_id !== laboratory.facultad_id) {
      dependencies.set(laboratory.dependencia_filtro_id, {
        id: laboratory.dependencia_filtro_id,
        facultyId: laboratory.facultad_id,
        name: laboratory.dependencia,
      });
    }
  });

  return {
    faculties: Array.from(faculties, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name, 'es')
    ),
    dependencies: Array.from(dependencies.values()).sort((a, b) =>
      a.name.localeCompare(b.name, 'es')
    ),
  };
}

async function getLatestReport(coordinatorDocument, ualId) {
  const runResult = await pool.query(
    `
      SELECT
        corrida.id AS corrida_id,
        corrida.fecha_fin,
        corrida.total_arka,
        resumen.total_milab,
        resumen.total_coincidencias,
        resumen.total_no_coincidentes
      FROM arka_conciliacion_ual resumen
      JOIN arka_conciliacion_corrida corrida
        ON corrida.id = resumen.corrida_id
       AND corrida.estado = 'completado'
      WHERE corrida.coordinador_documento = $1
        AND resumen.ual_id = $2
      ORDER BY corrida.fecha_fin DESC, corrida.id DESC
      LIMIT 1
    `,
    [coordinatorDocument, ualId]
  );
  const report = runResult.rows[0] || null;
  if (!report) return null;

  const detailResult = await pool.query(
    `
      SELECT
        detalle.id,
        detalle.estado,
        CASE
          WHEN detalle.estado = 'coincide'
            AND detalle.ual_id IS DISTINCT FROM $2
          THEN 'en_otra_ual'
          ELSE detalle.estado
        END AS estado_mostrado,
        detalle.arka_id,
        detalle.arka_elemento_acta_id,
        detalle.arka_placa,
        detalle.arka_serie,
        detalle.arka_nombre,
        detalle.arka_marca,
        detalle.inventario_placa,
        detalle.inventario_serie,
        detalle.inventario_nombre,
        detalle.tipo_coincidencia,
        CASE
          WHEN detalle.estado = 'coincide'
            AND detalle.ual_id IS DISTINCT FROM $2
          THEN laboratorio.nombre
          ELSE NULL
        END AS laboratorio_coincidencia
      FROM arka_conciliacion_detalle detalle
      LEFT JOIN ual laboratorio
        ON laboratorio.ual_id = detalle.ual_id
      WHERE detalle.corrida_id = $1
        AND (
          detalle.indice_arka IS NOT NULL
          OR (detalle.estado = 'solo_milab' AND detalle.ual_id = $2)
        )
      ORDER BY
        CASE detalle.estado
          WHEN 'solo_arka' THEN 1
          WHEN 'ambiguo' THEN 2
          WHEN 'solo_milab' THEN 3
          ELSE 4
        END,
        detalle.arka_placa NULLS LAST,
        detalle.inventario_placa NULLS LAST,
        detalle.id
    `,
    [report.corrida_id, ualId]
  );

  return { ...report, details: detailResult.rows };
}

async function loadPageData(req) {
  const laboratories = await getVisibleLaboratories(req);
  const requestedUalId = req.query.ual_id ? parsePositiveId(req.query.ual_id) : null;
  if (req.query.ual_id && !requestedUalId) {
    return { invalidUal: true, laboratories };
  }

  const selectedLaboratory =
    laboratories.find((laboratory) => laboratory.ual_id === requestedUalId) ||
    (!requestedUalId ? laboratories[0] : null);
  if (requestedUalId && !selectedLaboratory) {
    return { forbiddenUal: true, laboratories };
  }
  if (!selectedLaboratory) {
    return {
      laboratories,
      selectedLaboratory: null,
      report: null,
      activeRun: null,
      failedRun: null,
    };
  }

  const [report, activeRunResult, failedRunResult] = await Promise.all([
    getLatestReport(selectedLaboratory.coordinador_documento, selectedLaboratory.ual_id),
    pool.query(
      `
        SELECT estado, fecha_solicitud, fecha_inicio
        FROM arka_conciliacion_corrida
        WHERE coordinador_documento = $1
          AND estado IN ('en_cola', 'procesando')
        ORDER BY fecha_solicitud DESC, id DESC
        LIMIT 1
      `,
      [selectedLaboratory.coordinador_documento]
    ),
    pool.query(
      `
        SELECT fecha_fin, codigo_error, mensaje_error
        FROM arka_conciliacion_corrida
        WHERE coordinador_documento = $1
          AND estado = 'fallido'
        ORDER BY fecha_fin DESC, id DESC
        LIMIT 1
      `,
      [selectedLaboratory.coordinador_documento]
    ),
  ]);
  const lastFailure = failedRunResult.rows[0] || null;
  const failedRun =
    lastFailure && (!report || new Date(lastFailure.fecha_fin) > new Date(report.fecha_fin))
      ? lastFailure
      : null;

  return {
    laboratories,
    selectedLaboratory,
    report,
    activeRun: activeRunResult.rows[0] || null,
    failedRun,
  };
}

function createWorkbook(report, laboratory) {
  const summaryRows = [
    ['Conciliación ARKA'],
    ['Laboratorio', laboratory.laboratorio],
    ['Facultad', laboratory.facultad],
    ['Dependencia', laboratory.dependencia || '—'],
    ['Coordinador', laboratory.coordinador_nombre],
    ['Fecha de corte', report.fecha_fin],
    [],
    ['Elementos asignados en ARKA', report.total_arka],
    ['Elementos aprobados en MiLab', report.total_milab],
    ['Coinciden en esta UAL', report.total_coincidencias],
    ['No coincidentes', report.total_no_coincidentes],
  ];
  const detailRows = [
    [
      'Estado',
      'ID ARKA',
      'Placa ARKA',
      'Serie ARKA',
      'Descripción ARKA',
      'Marca ARKA',
      'Placa MiLab',
      'Serie MiLab',
      'Descripción MiLab',
      'UAL donde se encontró',
      'Criterio de coincidencia',
    ],
    ...report.details.map((detail) => [
      detail.estado_mostrado,
      detail.arka_id || detail.arka_elemento_acta_id || '',
      detail.arka_placa,
      detail.arka_serie,
      detail.arka_nombre,
      detail.arka_marca,
      detail.inventario_placa,
      detail.inventario_serie,
      detail.inventario_nombre,
      detail.laboratorio_coincidencia || '',
      detail.tipo_coincidencia || '',
    ]),
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summaryRows), 'Resumen');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(detailRows), 'Detalle');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
}

function renderPage(res, req, data, status = 200) {
  const filters = buildFilterOptions(data.laboratories);
  return res.status(status).render('home/inventarios/conciliaciones-arka', {
    ...data,
    ...filters,
    canRunAll: getUserRoles(req).some((role) => ['admin', 'administrador'].includes(role)),
    successMessage: String(req.query.success || ''),
    errorMessage: String(req.query.error || ''),
    pageUrl: PAGE_URL,
  });
}

router.get('/', requireReconciliationAccess, async (req, res, next) => {
  try {
    const data = await loadPageData(req);
    if (data.invalidUal) {
      return res.status(400).render('home/message_error', {
        message: 'Laboratorio no válido',
        message2: 'El identificador del laboratorio seleccionado no es válido.',
        limit: 'loginOnly',
      });
    }
    if (data.forbiddenUal) {
      return res.status(403).render('home/message_error', {
        message: 'Acceso denegado',
        message2: 'No tienes acceso al laboratorio seleccionado.',
        limit: 'loginOnly',
      });
    }
    return renderPage(res, req, data);
  } catch (error) {
    console.error('Error cargando conciliaciones ARKA:', error);
    return next(error);
  }
});

router.post('/corridas', requireReconciliationAdmin, async (req, res) => {
  try {
    const result = await service.enqueueAll({
      type: 'manual',
      requestedByDocument: getUserDocument(req) || null,
    });
    const message = result.enqueued
      ? `Se encolaron ${result.enqueued} conciliaciones para ${result.coordinators} coordinadores.`
      : result.coordinators
        ? 'Ya existen conciliaciones pendientes o en curso para todos los coordinadores.'
        : 'No hay coordinadores con UAL asignadas para consultar.';
    return res.redirect(`${PAGE_URL}?success=${encodeURIComponent(message)}`);
  } catch (error) {
    if (error instanceof ArkaIntegrationError) {
      return res.redirect(`${PAGE_URL}?error=${encodeURIComponent(error.message)}`);
    }
    console.error('Error encolando conciliaciones ARKA:', error);
    return res.redirect(
      `${PAGE_URL}?error=${encodeURIComponent('No fue posible encolar las conciliaciones ARKA.')}`
    );
  }
});

router.get('/exportar', requireReconciliationAccess, async (req, res, next) => {
  try {
    const data = await loadPageData(req);
    if (!data.selectedLaboratory || !data.report) {
      return res.status(404).render('home/message_error', {
        message: 'Reporte no disponible',
        message2: 'No hay una conciliación exitosa para el laboratorio seleccionado.',
        limit: 'loginOnly',
      });
    }

    const workbook = createWorkbook(data.report, data.selectedLaboratory);
    const fileName = `conciliacion-arka-${data.selectedLaboratory.ual_id}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.send(workbook);
  } catch (error) {
    console.error('Error exportando conciliación ARKA:', error);
    return next(error);
  }
});

module.exports = router;
