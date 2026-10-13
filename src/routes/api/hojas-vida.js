const express = require('express');

const pool = require('../../libs/db');
const { requireJsonRoles } = require('../middlewares/auth');

const router = express.Router();

const HV_ALLOWED_ROLES = ['admin', 'coordinador', 'coordinador_general', 'laboratorista'];
const requireHojasVidaAccess = requireJsonRoles(HV_ALLOWED_ROLES, {
  message: 'No tienes permisos para acceder al modulo de Hojas de Vida y Mantenimientos.',
});

router.use(requireHojasVidaAccess);

function sanitizeLikeValue(value) {
  const str = String(value || '').trim();
  if (!str) return '';
  return str.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

router.get('/equipos', async function buscarEquiposHV(req, res) {
  try {
    const params = [];
    const conditions = [];

    const codigoInventario = sanitizeLikeValue(req.query.codigo_inventario);
    const codigoInterno = sanitizeLikeValue(req.query.codigo_interno);
    const numeroSerie = sanitizeLikeValue(req.query.numero_serie);
    const nombreEquipo = sanitizeLikeValue(req.query.nombre_equipo);
    const marca = sanitizeLikeValue(req.query.marca);
    const referenciaModelo = sanitizeLikeValue(req.query.referencia_modelo);
    const buscar = sanitizeLikeValue(req.query.buscar);

    if (codigoInventario) {
      params.push(`%${codigoInventario}%`);
      conditions.push(`inv.placa ILIKE $${params.length} ESCAPE '\\'`);
    }

    if (codigoInterno) {
      params.push(`%${codigoInterno}%`);
      conditions.push(`e.codigo ILIKE $${params.length} ESCAPE '\\'`);
    }

    if (numeroSerie) {
      params.push(`%${numeroSerie}%`);
      conditions.push(`inv.serie ILIKE $${params.length} ESCAPE '\\'`);
    }

    if (nombreEquipo) {
      params.push(`%${nombreEquipo}%`);
      conditions.push(
        `(e.nombre ILIKE $${params.length} ESCAPE '\\' OR inv.nombre_bien ILIKE $${params.length} ESCAPE '\\')`
      );
    }

    if (marca) {
      params.push(`%${marca}%`);
      conditions.push(`hv.marca ILIKE $${params.length} ESCAPE '\\'`);
    }

    if (referenciaModelo) {
      params.push(`%${referenciaModelo}%`);
      conditions.push(`hv.referencia_modelo ILIKE $${params.length} ESCAPE '\\'`);
    }

    if (buscar) {
      params.push(`%${buscar}%`);
      const idx = params.length;
      conditions.push(
        `(e.codigo ILIKE $${idx} ESCAPE '\\' OR e.nombre ILIKE $${idx} ESCAPE '\\' OR ` +
          `inv.placa ILIKE $${idx} ESCAPE '\\' OR inv.serie ILIKE $${idx} ESCAPE '\\' OR ` +
          `inv.nombre_bien ILIKE $${idx} ESCAPE '\\' OR hv.marca ILIKE $${idx} ESCAPE '\\' OR ` +
          `hv.referencia_modelo ILIKE $${idx} ESCAPE '\\')`
      );
    }

    const whereClause = conditions.length ? `AND ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        e.id AS equipo_id,
        e.codigo AS codigo_interno,
        e.nombre AS nombre_equipo,
        e.categoria,
        e.estado AS estado_equipo,
        e.ubicacion,
        e.facultad,
        e.laboratorio,
        inv.placa AS codigo_inventario,
        inv.serie AS numero_serie,
        inv.nombre_bien AS nombre_bien_inventario,
        hv.id AS hoja_vida_id,
        COALESCE(hv.marca, NULL) AS marca,
        COALESCE(hv.referencia_modelo, NULL) AS referencia_modelo,
        EXISTS (
          SELECT 1 FROM hoja_vida hv2
          WHERE hv2.equipo_id = e.id AND hv2.activo = TRUE
        ) AS tiene_hoja_vida,
        EXISTS (
          SELECT 1 FROM mantenimiento m
          JOIN hoja_vida hv3 ON hv3.id = m.hoja_vida_id
          WHERE hv3.equipo_id = e.id AND m.activo = TRUE
        ) AS tiene_mantenimientos
      FROM equipo e
      LEFT JOIN inventario inv ON inv.placa = e.codigo AND inv.activo = TRUE
      LEFT JOIN hoja_vida hv ON hv.equipo_id = e.id AND hv.activo = TRUE
      WHERE e.activo = TRUE ${whereClause}
      ORDER BY e.fecha_creacion DESC NULLS LAST, e.id DESC
    `;

    const result = await pool.query(sql, params);

    const data = result.rows.map((row) => ({
      equipo_id: Number(row.equipo_id),
      codigo_inventario: row.codigo_inventario || null,
      codigo_interno: row.codigo_interno || null,
      numero_serie: row.numero_serie || null,
      nombre_equipo: row.nombre_equipo || row.nombre_bien_inventario || null,
      marca: row.marca || null,
      referencia_modelo: row.referencia_modelo || null,
      categoria: row.categoria || null,
      estado_equipo: row.estado_equipo || null,
      ubicacion: row.ubicacion || null,
      facultad: row.facultad || null,
      laboratorio: row.laboratorio || null,
      hoja_vida_id: row.hoja_vida_id ? Number(row.hoja_vida_id) : null,
      tiene_hoja_vida: Boolean(row.tiene_hoja_vida),
      tiene_mantenimientos: Boolean(row.tiene_mantenimientos),
    }));

    return res.json({
      ok: true,
      data,
      count: data.length,
    });
  } catch (error) {
    console.error('[hojas-vida] Error buscando equipos:', error);
    return res.status(500).json({
      ok: false,
      message: 'No fue posible consultar los equipos.',
      details: process.env.NODE_ENV === 'production' ? undefined : String(error && error.message),
    });
  }
});

router.post('/', async function validarUnicidadHV(req, res) {
  try {
    const equipoId = Number(req.body?.equipo_id);

    if (!Number.isInteger(equipoId) || equipoId <= 0) {
      return res.status(400).json({
        ok: false,
        message: 'El identificador del equipo es invalido.',
      });
    }

    const existencia = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM hoja_vida
        WHERE equipo_id = $1 AND activo = TRUE
      `,
      [equipoId]
    );

    const total = Number(existencia.rows[0]?.total || 0);

    if (total > 0) {
      return res.status(409).json({
        ok: false,
        message: 'El equipo ya tiene una hoja de vida registrada.',
        details: { equipo_id: equipoId, hojas_vida_existentes: total },
      });
    }

    return res.status(200).json({
      ok: true,
      message: 'El equipo no tiene hoja de vida. Creacion real en proxima HU.',
      data: { equipo_id: equipoId, puede_crear: true },
    });
  } catch (error) {
    console.error('[hojas-vida] Error validando unicidad HV:', error);
    return res.status(500).json({
      ok: false,
      message: 'No fue posible validar la hoja de vida del equipo.',
      details: process.env.NODE_ENV === 'production' ? undefined : String(error && error.message),
    });
  }
});

module.exports = router;
