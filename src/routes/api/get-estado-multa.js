const express = require('express');

const pool = require('../../libs/db');
const { publicApiLimiter } = require('../middlewares/public-rate-limit');
const router = express.Router();

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

router.get('/:identificador', publicApiLimiter, async (req, res) => {
  const identificador = String(req.params.identificador || '').trim();

  if (!/^\d{1,20}$/.test(identificador)) {
    return res.status(400).json({ error: 'Documento inválido' });
  }

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
