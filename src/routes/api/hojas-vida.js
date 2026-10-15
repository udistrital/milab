const express = require('express');
const multer = require('multer');
const path = require('path');

const pool = require('../../libs/db');
const { requireJsonRoles } = require('../middlewares/auth');
const { parseSigudExcel } = require('../../libs/hojas-vida-excel');

const router = express.Router();

const HV_ALLOWED_ROLES = ['admin', 'coordinador', 'coordinador_general', 'laboratorista'];
const requireHojasVidaAccess = requireJsonRoles(HV_ALLOWED_ROLES, {
  message: 'No tienes permisos para acceder al modulo de Hojas de Vida y Mantenimientos.',
});

router.use(requireHojasVidaAccess);

const HV_CARGA_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const HV_CARGA_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  'application/pdf',
]);
const HV_CARGA_EXT = new Set(['.xlsx', '.xls', '.pdf']);

const uploadCarga = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: HV_CARGA_MAX_BYTES, files: 1 },
  fileFilter: function (_req, file, cb) {
    const ext = (path.extname(file.originalname || '') || '').toLowerCase();
    if (HV_CARGA_MIMES.has(file.mimetype) || HV_CARGA_EXT.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo inválido. Solo se aceptan .xlsx, .xls o .pdf.'));
    }
  },
});

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

/**
 * Determina el tipo de documento según la extensión del archivo.
 */
function determinarTipoDocumento(originalname) {
  const ext = (path.extname(originalname || '') || '').toLowerCase();
  if (ext === '.pdf') return 'PDF_ORIGEN';
  if (ext === '.xlsx' || ext === '.xls') return 'EXCEL_ORIGEN';
  return null;
}

/**
 * POST /:equipoId/cargar
 * Carga un archivo Excel/PDF y crea una hoja de vida en estado
 * PENDIENTE_CONFIRMACION con los campos extraídos del formato SIGUD.
 */
router.post(
  '/:equipoId/cargar',
  uploadCarga.single('archivo'),
  async function cargarHojaVida(req, res) {
    try {
      const equipoId = Number(req.params?.equipoId);
      if (!Number.isInteger(equipoId) || equipoId <= 0) {
        return res.status(400).json({
          ok: false,
          message: 'El identificador del equipo es invalido.',
        });
      }

      if (!req.file) {
        return res.status(400).json({
          ok: false,
          message: 'No se recibió ningún archivo.',
        });
      }

      // 1. Verificar que el equipo existe
      const equipoResult = await pool.query(
        `
          SELECT e.id, e.codigo, e.nombre, e.estado, e.ubicacion, e.facultad, e.laboratorio,
                 inv.placa AS codigo_inventario, inv.serie AS numero_serie, inv.nombre_bien
          FROM equipo e
          LEFT JOIN inventario inv ON inv.placa = e.codigo AND inv.activo = TRUE
          WHERE e.id = $1 AND e.activo = TRUE
        `,
        [equipoId]
      );

      if (equipoResult.rows.length === 0) {
        return res.status(404).json({
          ok: false,
          message: 'El equipo no existe en Inventario.',
        });
      }

      const equipo = equipoResult.rows[0];

      // 2. Verificar que no tenga hoja de vida (incluso en borrador)
      const hvExistente = await pool.query(
        `
          SELECT id, estado
          FROM hoja_vida
          WHERE equipo_id = $1 AND activo = TRUE
          ORDER BY id DESC
          LIMIT 1
        `,
        [equipoId]
      );

      if (hvExistente.rows.length > 0) {
        const hv = hvExistente.rows[0];
        return res.status(409).json({
          ok: false,
          message:
            hv.estado === 'PENDIENTE_CONFIRMACION'
              ? 'El equipo ya tiene una hoja de vida pendiente de confirmación.'
              : 'El equipo ya tiene una hoja de vida registrada.',
          details: {
            hoja_vida_id: Number(hv.id),
            estado: hv.estado,
            view_url: `/milab/prestamos/hojas-vida/${hv.id}`,
            edit_url: `/milab/prestamos/hojas-vida/${hv.id}/editar`,
          },
        });
      }

      const file = req.file;
      const tipoDocumento = determinarTipoDocumento(file.originalname);

      if (!tipoDocumento) {
        return res.status(400).json({
          ok: false,
          message: 'Formato de archivo no soportado. Solo se aceptan .xlsx, .xls o .pdf.',
        });
      }

      // 3. Validar integridad del archivo
      if (file.size === 0) {
        return res.status(400).json({
          ok: false,
          message: 'El archivo está vacío.',
        });
      }

      if (file.size > HV_CARGA_MAX_BYTES) {
        return res.status(413).json({
          ok: false,
          message: `El archivo excede el tamaño máximo permitido (${Math.round(
            HV_CARGA_MAX_BYTES / (1024 * 1024)
          )} MB).`,
        });
      }

      let camposExtraidos = {};
      let camposReconocidos = [];
      let camposNoReconocidos = [];
      let advertenciaEstructura = null;

      // 4. Si es Excel, parsear con el parser SIGUD
      if (tipoDocumento === 'EXCEL_ORIGEN') {
        // Validar cabecera de archivo xlsx (PK\x03\x04) o xls (D0CF11E0)
        const buf = file.buffer;
        const esXlsx = buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b; // PK
        const esXls =
          buf.length >= 8 &&
          buf[0] === 0xd0 &&
          buf[1] === 0xcf &&
          buf[2] === 0x11 &&
          buf[3] === 0xe0;

        if (!esXlsx && !esXls) {
          return res.status(400).json({
            ok: false,
            message:
              'El archivo no tiene la estructura esperada de un Excel. Verifica que no esté corrupto.',
          });
        }

        // exceljs solo soporta .xlsx; .xls requiere otra librería
        if (esXls) {
          advertenciaEstructura =
            'El formato .xls no se puede parsear automáticamente. Se conservará el archivo como evidencia, pero deberás ingresar los campos manualmente.';
        } else {
          try {
            const resultado = await parseSigudExcel(file.buffer);
            camposExtraidos = resultado.campos_extraidos;
            camposReconocidos = resultado.campos_reconocidos;
            camposNoReconocidos = resultado.campos_no_reconocidos;
          } catch (err) {
            return res.status(400).json({
              ok: false,
              message: 'No se pudo leer el archivo Excel. Verifica que no esté corrupto.',
              details:
                process.env.NODE_ENV === 'production' ? undefined : String(err && err.message),
            });
          }
        }
      } else {
        // PDF: validar cabecera %PDF-
        const cabecera = file.buffer.slice(0, 5).toString('ascii');
        if (cabecera !== '%PDF-') {
          return res.status(400).json({
            ok: false,
            message: 'El archivo PDF está dañado o no es válido. Verifica que sea un PDF real.',
          });
        }
        advertenciaEstructura =
          'Los PDFs no se pueden parsear automáticamente. Se conservará el archivo como evidencia, pero deberás ingresar los campos manualmente.';
      }

      // 5. Transacción: crear HV en PENDIENTE_CONFIRMACION + guardar documento
      const cliente = await pool.connect();
      try {
        await cliente.query('BEGIN');

        const insertHV = await cliente.query(
          `
            INSERT INTO hoja_vida (
              equipo_id, dependencia, ubicacion, nombre_equipo, marca,
              numero_serie, codigo_inventario, codigo_interno,
              fecha_adquisicion, anio, cantidad, responsable, supervisor,
              funcion, tipo_uso, descripcion_fisica, especificaciones_tecnicas,
              instrucciones_uso, condiciones_seguridad, protocolo_limpieza,
              foto_descripcion, estado, usuario_creacion
            ) VALUES (
              $1, $2, $3, $4, $5,
              $6, $7, $8,
              $9, $10, $11, $12, $13,
              $14, $15, $16, $17,
              $18, $19, $20, $21,
              $22, $23
            )
            RETURNING id, estado
          `,
          [
            equipoId,
            camposExtraidos.dependencia || equipo.facultad || null,
            camposExtraidos.ubicacion || equipo.ubicacion || equipo.laboratorio || null,
            camposExtraidos.nombre_equipo || equipo.nombre || equipo.nombre_bien || null,
            camposExtraidos.marca || null,
            camposExtraidos.numero_serie || equipo.numero_serie || null,
            camposExtraidos.codigo_inventario || equipo.codigo_inventario || null,
            equipo.codigo || null,
            camposExtraidos.fecha_adquisicion || null,
            camposExtraidos.anio || null,
            camposExtraidos.cantidad || null,
            camposExtraidos.responsable || null,
            camposExtraidos.supervisor || null,
            camposExtraidos.funcion || null,
            camposExtraidos.tipo_uso || null,
            camposExtraidos.descripcion_fisica || null,
            camposExtraidos.especificaciones_tecnicas || null,
            camposExtraidos.instrucciones_uso || null,
            camposExtraidos.condiciones_seguridad || null,
            camposExtraidos.protocolo_limpieza || null,
            camposExtraidos.foto_descripcion || null,
            'PENDIENTE_CONFIRMACION',
            req.session?.user?.id || null,
          ]
        );

        const hojaVidaId = Number(insertHV.rows[0].id);

        await cliente.query(
          `
            INSERT INTO hoja_vida_documento (
              hoja_vida_id, tipo_documento, nombre_archivo, tipo_mime, archivo,
              fecha_carga, usuario_carga
            ) VALUES ($1, $2, $3, $4, $5, NOW(), $6)
          `,
          [
            hojaVidaId,
            tipoDocumento,
            file.originalname,
            file.mimetype,
            file.buffer,
            req.session?.user?.id || null,
          ]
        );

        await cliente.query('COMMIT');

        return res.status(201).json({
          ok: true,
          message: 'Archivo cargado. Hoja de vida creada en estado Pendiente de confirmación.',
          data: {
            hoja_vida_id: hojaVidaId,
            estado: insertHV.rows[0].estado,
            tipo_documento: tipoDocumento,
            campos_extraidos: camposExtraidos,
            campos_reconocidos: camposReconocidos,
            campos_no_reconocidos: camposNoReconocidos,
            advertencia_estructura: advertenciaEstructura,
            confirmar_url: `/milab/prestamos/hojas-vida/${hojaVidaId}/confirmar`,
          },
        });
      } catch (txError) {
        await cliente.query('ROLLBACK');
        throw txError;
      } finally {
        cliente.release();
      }
    } catch (error) {
      // Errores de multer (tamaño, tipo)
      if (error && error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          ok: false,
          message: `El archivo excede el tamaño máximo permitido (${Math.round(
            HV_CARGA_MAX_BYTES / (1024 * 1024)
          )} MB).`,
        });
      }
      if (error && error.message && error.message.includes('Tipo de archivo inválido')) {
        return res.status(400).json({
          ok: false,
          message: error.message,
        });
      }
      console.error('[hojas-vida] Error cargando hoja de vida:', error);
      return res.status(500).json({
        ok: false,
        message: 'No fue posible cargar la hoja de vida.',
        details: process.env.NODE_ENV === 'production' ? undefined : String(error && error.message),
      });
    }
  }
);

module.exports = router;
