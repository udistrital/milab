const express = require('express');

const router = express.Router();
const pool = require('../../libs/db');
const { resolveCoordinatorScope } = require('../../libs/faculty-scope');
const { requireRoles } = require('../middlewares/auth');
const { resolveOatiName } = require('../../libs/oati-name');
const { renderApplicationError, wantsJson } = require('../middlewares/error-handler');
const ExcelJS = require('exceljs');

const bp = require('body-parser');
router.use(bp.json());
router.use(bp.urlencoded({ extended: true }));

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_FINE_STATES = new Set(['ACTIVA', 'Pendiente', 'POR SALDAR', 'SALDADA']);

const requireMultasAccess = requireRoles(['admin', 'laboratorista', 'coordinador'], {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

function getSessionDocument(req) {
  return req.session?.user?.documento_real || req.session?.user?.documento || null;
}

function normalizeDateFilter(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return null;
  return ISO_DATE_PATTERN.test(value) ? value : 'INVALID';
}

function normalizeFineStateFilter(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return null;
  return ALLOWED_FINE_STATES.has(value) ? value : 'INVALID';
}

async function resolveLaboratoristaDocument(client, userDocument) {
  const result = await client.query(
    'SELECT documento FROM laboratorista WHERE documento = $1 OR n_usuario = $1 LIMIT 1',
    [String(userDocument || '').trim()]
  );

  return result.rows[0]?.documento || null;
}

function renderFilterError(req, res, message, message2) {
  if (wantsJson(req)) {
    return res.status(400).json({
      ok: false,
      message,
      message2,
    });
  }

  return res.render('home/message_error', {
    message,
    message2,
    limit: null,
  });
}

async function buildMultasQueryContext(req, client) {
  const fechaDesde = normalizeDateFilter(req.query?.fecha_desde);
  const fechaHasta = normalizeDateFilter(req.query?.fecha_hasta);
  const estadoMulta = normalizeFineStateFilter(req.query?.estado_multa);

  if (estadoMulta === 'INVALID') {
    return {
      error: {
        message: 'Filtro de estado inválido.',
        message2: 'Selecciona un estado de sanción válido.',
      },
    };
  }

  if (fechaDesde === 'INVALID' || fechaHasta === 'INVALID') {
    return {
      error: {
        message: 'Filtro de fecha inválido.',
        message2: 'Usa el formato YYYY-MM-DD para fecha desde y fecha hasta.',
      },
    };
  }

  if (fechaDesde && fechaHasta && fechaDesde > fechaHasta) {
    return {
      error: {
        message: 'Rango de fechas inválido.',
        message2: 'La fecha inicial no puede ser mayor que la fecha final.',
      },
    };
  }

  const conditions = [];
  const params = [];
  const nextParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  const userType = String(req.session?.user?.tipo || '').toLowerCase();

  if (userType === 'coordinador') {
    const scope = await resolveCoordinatorScope(client, getSessionDocument(req));

    if (scope.facultyIds.length === 0) {
      return {
        error: {
          message: '¡Acceso denegado!',
          message2: 'El coordinador no tiene facultades asociadas.',
        },
      };
    }

    conditions.push(`u.facultad_id = ANY(${nextParam(scope.facultyIds)}::int[])`);
  } else if (userType === 'laboratorista') {
    const laboratoristaDocument = await resolveLaboratoristaDocument(client, getSessionDocument(req));

    if (!laboratoristaDocument) {
      return {
        error: {
          message: '¡Acceso denegado!',
          message2: 'No se encontró un laboratorista asociado a la sesión activa.',
        },
      };
    }

    conditions.push(
      `EXISTS (
        SELECT 1
        FROM laboratorista_ual lu
        WHERE lu.laboratorista_documento_id = ${nextParam(laboratoristaDocument)}
          AND lu.ual_id = m.ual_id
      )`
    );
  }

  if (fechaDesde) {
    conditions.push(`m.fecha_multa >= ${nextParam(fechaDesde)}::date`);
  }

  if (fechaHasta) {
    conditions.push(`m.fecha_multa <= ${nextParam(fechaHasta)}::date`);
  }

  if (estadoMulta) {
    conditions.push(`m.con_estado_multa = ${nextParam(estadoMulta)}`);
  }

  return {
    filters: {
      fecha_desde: fechaDesde || '',
      fecha_hasta: fechaHasta || '',
      estado_multa: estadoMulta || '',
    },
    conditions,
    params,
  };
}

async function queryMultasRows(client, conditions, params) {
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await client.query(
    `
      SELECT
        m.id,
        m.cat_multa,
        l.nombre AS nombre_laboratorista,
        l.documento AS cc_laboratorista,
        COALESCE(pe.documento, pd.documento, us.documento) AS documento_sancionado,
        COALESCE(pe.codigo::text, us.codigo::text, '') AS codigo_sancionado,
        CASE WHEN pd.usuario_id IS NOT NULL THEN 'docente' ELSE 'estudiante' END AS tipo_sancionado,
        u.nombre AS ual,
        TO_CHAR(m.fecha_multa, 'YYYY-MM-DD') AS fecha_multa_formateada,
        m.con_estado_multa,
        m.obs_multa,
        m.tipo_sancion
      FROM multa m
      INNER JOIN ual u ON u.ual_id = m.ual_id
      LEFT JOIN laboratorista l ON l.documento = m.laboratorista_documento_id
      LEFT JOIN usuario us ON us.id = m.usuario_sancionado_id
      LEFT JOIN perfil_estudiante pe ON pe.usuario_id = m.usuario_sancionado_id
      LEFT JOIN perfil_docente pd ON pd.usuario_id = m.usuario_sancionado_id
      ${whereClause}
      ORDER BY m.fecha_multa DESC NULLS LAST, m.id DESC
    `,
    params
  );

  return result.rows;
}

router.get('/resolve_name', requireMultasAccess, async (req, res) => {
  const documento = String(req.query.documento || '').trim();

  if (!documento) {
    return res.json({ ok: false, nombre: '' });
  }

  try {
    const nombre = await resolveOatiName(documento);
    return res.json({ ok: true, nombre: nombre || '' });
  } catch (error) {
    console.error('Error resolviendo nombre OATI:', error);
    return res.status(500).json({ ok: false, nombre: '' });
  }
});

router.get('/', requireMultasAccess, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  let client;

  try {
    client = await pool.connect();
    const queryContext = await buildMultasQueryContext(req, client);
    if (queryContext.error) {
      client.release();
      return renderFilterError(req, res, queryContext.error.message, queryContext.error.message2);
    }

    const rows = await queryMultasRows(client, queryContext.conditions, queryContext.params);

    client.release();
    const sancionesEstudiantes = rows.filter((row) => row.tipo_sancionado !== 'docente');
    const sancionesDocentes = rows.filter((row) => row.tipo_sancionado === 'docente');

    res.render('home/get_list_multas', {
      sampleData: rows,
      sancionesEstudiantes,
      sancionesDocentes,
      filtros: queryContext.filters,
    });
  } catch (error) {
    if (client) {
      client.release();
    }

    console.error(error);

    if (wantsJson(req)) {
      return res.status(500).json({
        ok: false,
        message: 'No fue posible cargar el listado de multas.',
        message2: 'Intenta nuevamente en unos minutos.',
      });
    }

    return renderApplicationError(res, {
      status: 500,
      message: 'No fue posible cargar el listado de multas.',
      message2: 'Intenta nuevamente en unos minutos.',
      limit: null,
    });
  }
});

router.get('/export/excel', requireMultasAccess, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  let client;

  try {
    client = await pool.connect();

    const queryContext = await buildMultasQueryContext(req, client);
    if (queryContext.error) {
      client.release();
      return renderFilterError(req, res, queryContext.error.message, queryContext.error.message2);
    }

    const rows = await queryMultasRows(client, queryContext.conditions, queryContext.params);
    client.release();

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Multas');

    worksheet.columns = [
      { header: 'ID', key: 'id', width: 10 },
      { header: 'Tipo Sancionado', key: 'tipo_sancionado', width: 18 },
      { header: 'Documento Sancionado', key: 'documento_sancionado', width: 22 },
      { header: 'Codigo Sancionado', key: 'codigo_sancionado', width: 20 },
      { header: 'Fecha Multa', key: 'fecha_multa_formateada', width: 14 },
      { header: 'Estado', key: 'con_estado_multa', width: 14 },
      { header: 'Categoria', key: 'cat_multa', width: 20 },
      { header: 'Tipo Sancion', key: 'tipo_sancion', width: 26 },
      { header: 'UAL', key: 'ual', width: 28 },
      { header: 'Laboratorista', key: 'nombre_laboratorista', width: 26 },
      { header: 'CC Laboratorista', key: 'cc_laboratorista', width: 20 },
      { header: 'Observaciones', key: 'obs_multa', width: 40 },
    ];

    rows.forEach((row) => {
      worksheet.addRow({
        ...row,
        tipo_sancion: row.tipo_sancion || '',
        nombre_laboratorista: row.nombre_laboratorista || '',
        cc_laboratorista: row.cc_laboratorista || '',
        obs_multa: row.obs_multa || '',
      });
    });

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };

    const today = new Date().toISOString().slice(0, 10);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="multas_${today}.xlsx"`);

    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    if (client) {
      client.release();
    }

    console.error(error);

    if (wantsJson(req)) {
      return res.status(500).json({
        ok: false,
        message: 'No fue posible exportar el listado de multas.',
        message2: 'Intenta nuevamente en unos minutos.',
      });
    }

    return renderApplicationError(res, {
      status: 500,
      message: 'No fue posible exportar el listado de multas.',
      message2: 'Intenta nuevamente en unos minutos.',
      limit: null,
    });
  }
});

module.exports = router;
