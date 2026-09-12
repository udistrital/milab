const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const pool = require('../../libs/db');
const { publicApiLimiter } = require('../middlewares/public-rate-limit');
const router = express.Router();

const MULTA_LOOKUP_WINDOW_MS = 5 * 60 * 1000;
const MULTA_LOOKUP_BURST_THRESHOLD = 10;
const MULTA_LOOKUP_TRACKING_LIMIT = 500;

const ipLookupWindow = new Map();

const getEstadoMultaLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Demasiadas solicitudes. Intentalo nuevamente en un momento.',
    });
  },
});

let multaLookupColumnsPromise = null;

async function resolveMultaLookupColumns() {
  if (!multaLookupColumnsPromise) {
    multaLookupColumnsPromise = pool
      .query(
        `
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'multa'
            AND column_name IN ('cod_multado')
        `
      )
      .then((result) => {
        const columnSet = new Set(result.rows.map((row) => String(row.column_name || '').trim()));
        return {
          hasLegacyCodMultado: columnSet.has('cod_multado'),
        };
      })
      .catch((error) => {
        multaLookupColumnsPromise = null;
        throw error;
      });
  }

  return multaLookupColumnsPromise;
}

function buildDirectMultaLookupQuery(options = {}) {
  const conditions = [
    `COALESCE(pe.documento, u.documento) = $1`,
    `COALESCE(pe.codigo::text, u.codigo::text) = $1`,
  ];

  if (options.hasLegacyCodMultado) {
    conditions.push(`m.cod_multado::text = $1`);
  }

  return `
    SELECT 1
    FROM multa m
    LEFT JOIN usuario u
      ON u.id = m.usuario_sancionado_id
    LEFT JOIN perfil_estudiante pe
      ON pe.usuario_id = m.usuario_sancionado_id
    WHERE m.con_estado_multa = 'ACTIVA'
      AND (${conditions.join('\n        OR ')})
    LIMIT 1
  `;
}

function hashIdentifier(value) {
  return crypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex')
    .slice(0, 16);
}

function cleanupOldLookupRecords(nowMs) {
  for (const [ip, state] of ipLookupWindow.entries()) {
    if (!state || nowMs - state.firstSeenAt > MULTA_LOOKUP_WINDOW_MS) {
      ipLookupWindow.delete(ip);
    }
  }

  if (ipLookupWindow.size > MULTA_LOOKUP_TRACKING_LIMIT) {
    const entries = Array.from(ipLookupWindow.entries()).sort(
      (left, right) => left[1].firstSeenAt - right[1].firstSeenAt
    );
    const overflow = ipLookupWindow.size - MULTA_LOOKUP_TRACKING_LIMIT;
    for (let index = 0; index < overflow; index += 1) {
      ipLookupWindow.delete(entries[index][0]);
    }
  }
}

function trackLookupPattern(req, identificador) {
  const nowMs = Date.now();
  cleanupOldLookupRecords(nowMs);

  const ip = String(req.ip || req.headers['x-forwarded-for'] || 'unknown').trim();
  const current = ipLookupWindow.get(ip);

  const state =
    !current || nowMs - current.firstSeenAt > MULTA_LOOKUP_WINDOW_MS
      ? {
          firstSeenAt: nowMs,
          identifiers: new Set(),
          alerted: false,
        }
      : current;

  state.identifiers.add(hashIdentifier(identificador));
  ipLookupWindow.set(ip, state);

  if (state.identifiers.size >= MULTA_LOOKUP_BURST_THRESHOLD && !state.alerted) {
    state.alerted = true;
    const log = req.log;
    if (log && typeof log.warn === 'function') {
      log.warn(
        {
          event: 'public_multa_lookup_suspected_enumeration',
          endpoint: '/api/get-estado-multa/:identificador',
          ip,
          distinctIdentifiersInWindow: state.identifiers.size,
          windowMs: MULTA_LOOKUP_WINDOW_MS,
        },
        'Potential enumeration pattern detected on public multa lookup'
      );
    }
  }
}

router.get('/:identificador', publicApiLimiter, getEstadoMultaLimiter, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');

  const identificador = String(req.params.identificador || '').trim();

  if (!/^\d{1,20}$/.test(identificador)) {
    return res.status(400).json({ error: 'Documento inválido' });
  }

  trackLookupPattern(req, identificador);

  try {
    const lookupColumns = await resolveMultaLookupColumns();
    const result = await pool.query(buildDirectMultaLookupQuery(lookupColumns), [identificador]);

    if (result.rows.length > 0) {
      return res.json({
        documento: identificador,
        multado: true,
        estado: 'MULTADO',
        mensaje: 'El estudiante esta multado.',
      });
    }

    return res.json({
      documento: identificador,
      multado: false,
      estado: 'PAZ_Y_SALVO',
      mensaje: 'El estudiante esta a paz y salvo.',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al consultar el estado de multa' });
  }
});

module.exports = router;
