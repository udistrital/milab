const express = require('express');
const { XMLParser } = require('fast-xml-parser');
const pool = require('../../../libs/db');
const { getAcademicServicePath, requestOati } = require('../../../libs/oati-client');
const { normalizeLogDocument } = require('../../../libs/account-email');
const {
  getUserRoles,
  normalizeRoleListForMatch,
  renderAuthError,
  requireRoles,
} = require('../../middlewares/auth');

const router = express.Router();
const PERIOD_SERVICE_PATH = 'periodo_academico/A';
const MAX_PERIOD_LENGTH = 100;

router.use(express.urlencoded({ extended: true }));
router.use(express.json());
router.use(
  requireRoles('admin', {
    message: 'Acceso denegado',
    message2: 'Solo los administradores pueden gestionar el período académico.',
    limit: 'loginOnly',
  }),
  (req, res, next) => {
    const roles = normalizeRoleListForMatch(getUserRoles(req.session?.user));
    if (roles.includes('admin')) return next();
    return renderAuthError(res, {
      message: 'Acceso denegado',
      message2: 'Solo los administradores pueden gestionar el período académico.',
      limit: 'loginOnly',
    });
  }
);

function normalizeText(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).trim();
}

function parseOatiPayload(payload) {
  if (typeof payload !== 'string') return payload;
  const text = payload.trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return new XMLParser({ ignoreAttributes: false }).parse(text);
  }
}

function extractAcademicPeriod(payload) {
  const parsed = parseOatiPayload(payload);
  const candidates = [];
  const visited = new Set();

  function visit(value, depth = 0, periodContext = false) {
    if (depth > 8 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1, periodContext));
      return;
    }
    if (typeof value !== 'object') return;
    if (visited.has(value)) return;
    visited.add(value);

    for (const [rawKey, child] of Object.entries(value)) {
      const key = rawKey
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
      const isPeriodField = /period|(^|_)per(_|$)|vigencia/.test(key);
      const scalar = normalizeText(child);
      if (scalar && (isPeriodField || periodContext)) {
        const isCodeField = /cod|codigo|id|actual|vigente|numero|ano|year/.test(key);
        candidates.push({ value: scalar, score: isCodeField ? 3 : isPeriodField ? 2 : 1 });
      } else {
        visit(child, depth + 1, periodContext || isPeriodField);
      }
    }
  }

  if (typeof parsed === 'string' || typeof parsed === 'number') {
    candidates.push({ value: normalizeText(parsed), score: 0 });
  } else {
    visit(parsed);
  }

  candidates.sort((left, right) => right.score - left.score);
  const period = candidates[0]?.value || '';
  if (!period || period.length > MAX_PERIOD_LENGTH) {
    throw new Error('La respuesta de OATI no contiene un período académico válido.');
  }
  return period;
}

async function loadPeriodData() {
  const [activeResult, historyResult] = await Promise.all([
    pool.query(
      `
        SELECT id, codigo_periodo, periodo_anterior,
               TO_CHAR(fecha_activacion AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24:MI') AS fecha_activacion
        FROM periodo_academico_historial
        WHERE activo = TRUE
        LIMIT 1
      `
    ),
    pool.query(
      `
        SELECT codigo_periodo, periodo_anterior, activo,
               TO_CHAR(fecha_activacion AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24:MI') AS fecha_activacion,
               TO_CHAR(fecha_desactivacion AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24:MI') AS fecha_desactivacion,
               consultado_por_documento
        FROM periodo_academico_historial
        ORDER BY fecha_activacion DESC, id DESC
      `
    ),
  ]);
  return { activePeriod: activeResult.rows[0] || null, periodHistory: historyResult.rows || [] };
}

async function renderPage(req, res, { success = null, error = null } = {}) {
  const { activePeriod, periodHistory } = await loadPeriodData();
  res.setHeader('Cache-Control', 'no-store');
  return res.render('home/admin_periodo', {
    activePeriod,
    periodHistory,
    success: success || String(req.query.success || '').trim() || null,
    error: error || String(req.query.error || '').trim() || null,
  });
}

router.get('/', async (req, res) => {
  try {
    return await renderPage(req, res);
  } catch (error) {
    console.error('Error cargando el período académico:', error);
    return res.status(500).render('home/message_error', {
      message: 'No fue posible cargar el período académico.',
      message2: 'Verifica que la estructura de Inventarios esté actualizada.',
      limit: null,
    });
  }
});

router.post('/sincronizar', async (req, res) => {
  let client;
  try {
    const oatiResponse = await requestOati(getAcademicServicePath(PERIOD_SERVICE_PATH));
    const currentPeriod = extractAcademicPeriod(oatiResponse);
    const user = req.session?.user || {};
    const document = normalizeLogDocument(user.documento_real || user.documento || '') || null;

    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('LOCK TABLE periodo_academico_historial IN EXCLUSIVE MODE');
    const activeResult = await client.query(
      `
        SELECT id, codigo_periodo
        FROM periodo_academico_historial
        WHERE activo = TRUE
        LIMIT 1
        FOR UPDATE
      `
    );
    const previousPeriod = activeResult.rows[0]?.codigo_periodo || null;

    if (previousPeriod === currentPeriod) {
      await client.query('COMMIT');
      return res.redirect(
        303,
        `/milab/api/admin/periodo?success=${encodeURIComponent(`El período ${currentPeriod} ya estaba activo; no hubo cambios.`)}`
      );
    }

    if (activeResult.rows[0]) {
      await client.query(
        `
          UPDATE periodo_academico_historial
          SET activo = FALSE,
              fecha_desactivacion = CURRENT_TIMESTAMP
          WHERE id = $1
        `,
        [activeResult.rows[0].id]
      );
    }

    await client.query(
      `
        INSERT INTO periodo_academico_historial (
          codigo_periodo, periodo_anterior, activo, consultado_por_documento
        )
        VALUES ($1, $2, TRUE, $3)
      `,
      [currentPeriod, previousPeriod, document]
    );
    await client.query('COMMIT');

    const message = previousPeriod
      ? `El período cambió de ${previousPeriod} a ${currentPeriod}. Se generó una alerta para los laboratoristas.`
      : `El período ${currentPeriod} quedó asignado como período activo.`;
    return res.redirect(303, `/milab/api/admin/periodo?success=${encodeURIComponent(message)}`);
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error revirtiendo la sincronización del período académico:', rollbackError);
      }
    }
    console.error('Error sincronizando el período académico desde OATI:', error);
    return res.redirect(
      303,
      `/milab/api/admin/periodo?error=${encodeURIComponent('No fue posible consultar o actualizar el período en OATI. Inténtalo nuevamente más tarde.')}`
    );
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
