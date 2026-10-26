const express = require('express');
const multer = require('multer');
const path = require('path');

const pool = require('../../libs/db');
const { requireJsonRoles } = require('../middlewares/auth');
const { parseSigudExcel } = require('../../libs/hojas-vida-excel');
const {
  CAMPOS_HOJA_VIDA,
  NOMBRES_CAMPOS_HOJA_VIDA,
  serializarTipoUso,
  normalizarTipoUso,
} = require('../../libs/hojas-vida-campos');
const { esTipoEventoManual } = require('../../libs/hojas-vida-eventos');
const {
  esTipoMantenimientoValido,
  esEstadoMantenimientoValido,
  esEstadoEditableMantenimiento,
  etiquetaTipoMantenimiento,
  etiquetaEstadoMantenimiento,
  situacionMantenimiento,
  diasRestantesMantenimiento,
  CODIGOS_ESTADO_MANTENIMIENTO,
  ESTADO_MANTENIMIENTO_DEFAULT,
  DIAS_ALERTA_VENCIMIENTO_DEFAULT,
} = require('../../libs/hojas-vida-mantenimientos');

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

const HV_FOTO_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const HV_FOTO_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const uploadFoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: HV_FOTO_MAX_BYTES, files: 1 },
  fileFilter: function (_req, file, cb) {
    if (HV_FOTO_MIMES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('La fotografía debe ser una imagen JPG, PNG o WEBP.'));
    }
  },
});

const CAMPOS_NUMERICOS_HOJA_VIDA = new Set(['cantidad', 'valor_compra']);
const CAMPOS_HOJA_VIDA_PERMITIDOS = new Set(NOMBRES_CAMPOS_HOJA_VIDA);

/**
 * Normaliza los campos de la hoja de vida recibidos en el body, dejando solo
 * los permitidos y convirtiendo vacios a null.
 */
function normalizarCamposHojaVida(body) {
  const datos = {};
  const fuente = body || {};
  Object.keys(fuente).forEach(function (nombre) {
    if (!CAMPOS_HOJA_VIDA_PERMITIDOS.has(nombre)) return;
    const valor = fuente[nombre];
    if (nombre === 'tipo_uso') {
      const claves = Array.isArray(valor) ? valor : String(valor == null ? '' : valor).split(',');
      const serializado = serializarTipoUso(claves, fuente.tipo_uso_otro);
      datos[nombre] = serializado === '' ? null : serializado;
      return;
    }
    if (valor == null) {
      datos[nombre] = null;
      return;
    }
    const texto = String(valor).trim();
    if (texto === '') {
      datos[nombre] = null;
      return;
    }
    if (CAMPOS_NUMERICOS_HOJA_VIDA.has(nombre)) {
      const num = Number(texto);
      datos[nombre] = Number.isFinite(num) ? num : null;
      return;
    }
    datos[nombre] = texto;
  });
  // Si el grupo de uso se envio pero sin casillas marcadas, se limpia el valor.
  if (
    fuente.tipo_uso_grupo !== undefined &&
    !Object.prototype.hasOwnProperty.call(fuente, 'tipo_uso')
  ) {
    datos.tipo_uso = null;
  }
  return datos;
}

function sanitizeLikeValue(value) {
  const str = String(value || '').trim();
  if (!str) return '';
  return str.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Devuelve el texto recortado o null si viene vacio/no definido.
 */
function normalizarTextoOpcional(valor) {
  if (valor == null) return null;
  const texto = String(valor).trim();
  return texto === '' ? null : texto;
}

/**
 * Convierte una fecha (YYYY-MM-DD o ISO) a ISO completo, o null si es invalida.
 */
function normalizarFechaOpcional(valor) {
  if (valor == null) return null;
  const texto = String(valor).trim();
  if (texto === '') return null;
  const fecha = new Date(texto);
  if (Number.isNaN(fecha.getTime())) return null;
  return fecha.toISOString();
}

/** Mapa nombre de campo -> definicion del catalogo. */
const CAMPOS_HOJA_VIDA_POR_NOMBRE = new Map(CAMPOS_HOJA_VIDA.map((campo) => [campo.nombre, campo]));

function pad2(valor) {
  return String(valor).padStart(2, '0');
}

/**
 * Devuelve una fecha en formato 'YYYY-MM-DD' apta para columnas DATE.
 *
 * Las columnas DATE son devueltas por pg como Date a medianoche local, por lo
 * que se usan los getters locales; para cadenas se toma el prefijo de fecha
 * (evitando el desfase de zona horaria de `new Date('YYYY-MM-DD')`).
 */
function normalizarFechaDiaOpcional(valor) {
  if (valor == null) return null;
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    return `${valor.getFullYear()}-${pad2(valor.getMonth() + 1)}-${pad2(valor.getDate())}`;
  }
  const texto = String(valor).trim();
  if (texto === '') return null;
  const soloFecha = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
  if (soloFecha) return `${soloFecha[1]}-${soloFecha[2]}-${soloFecha[3]}`;
  const fecha = new Date(texto);
  if (Number.isNaN(fecha.getTime())) return null;
  return `${fecha.getFullYear()}-${pad2(fecha.getMonth() + 1)}-${pad2(fecha.getDate())}`;
}

/**
 * Normaliza un valor para comparar el estado previo con el nuevo y detectar
 * cambios reales al editar la hoja de vida.
 */
function normalizarValorComparacion(valor, tipo) {
  if (valor === null || valor === undefined) return null;
  if (tipo === 'date') return normalizarFechaDiaOpcional(valor);
  if (tipo === 'number') {
    const num = Number(valor);
    return Number.isFinite(num) ? String(num) : null;
  }
  const texto = String(valor).trim();
  return texto === '' ? null : texto;
}

/**
 * Normaliza el costo de un mantenimiento. Devuelve null para vacio y NaN cuando
 * el valor recibido no es numerico o es negativo.
 */
function normalizarCostoOpcional(valor) {
  if (valor == null) return null;
  const texto = String(valor).trim();
  if (texto === '') return null;
  const num = Number(texto.replace(/\s/g, '').replace(/,/g, ''));
  return Number.isFinite(num) && num >= 0 ? num : NaN;
}

/**
 * Dias de anticipacion configurados por el administrador para las alertas de
 * vencimiento de mantenimiento.
 */
async function obtenerDiasAlertaVencimiento(cliente) {
  try {
    const result = await cliente.query(
      `
        SELECT dias_alerta_vencimiento
        FROM mantenimiento_config
        WHERE activo = TRUE
        ORDER BY id ASC
        LIMIT 1
      `
    );
    const dias = Number(result.rows[0]?.dias_alerta_vencimiento);
    return Number.isFinite(dias) ? dias : DIAS_ALERTA_VENCIMIENTO_DEFAULT;
  } catch {
    return DIAS_ALERTA_VENCIMIENTO_DEFAULT;
  }
}

/**
 * Mantiene sincronizado el estado del equipo con sus mantenimientos en
 * ejecucion: si existe al menos uno, el equipo queda 'mantenimiento'
 * (no disponible para prestamo); cuando no queda ninguno en ejecucion se
 * libera a 'disponible' siempre que el equipo no este prestado o fuera de
 * servicio.
 */
async function sincronizarDisponibilidadEquipo(cliente, equipoId) {
  const ejecucionResult = await cliente.query(
    `
      SELECT COUNT(*)::int AS total
      FROM mantenimiento
      WHERE equipo_id = $1 AND activo = TRUE AND estado = 'EN_EJECUCION'
    `,
    [equipoId]
  );
  const enEjecucion = Number(ejecucionResult.rows[0]?.total || 0) > 0;

  const equipoResult = await cliente.query(
    `
      SELECT estado
      FROM equipo
      WHERE id = $1
      LIMIT 1
    `,
    [equipoId]
  );
  if (equipoResult.rows.length === 0) return null;

  const estadoActual = String(equipoResult.rows[0].estado || '');
  let estadoNuevo = estadoActual;

  if (enEjecucion) {
    if (estadoActual === 'disponible' || estadoActual === 'mantenimiento') {
      estadoNuevo = 'mantenimiento';
    }
  } else if (estadoActual === 'mantenimiento') {
    estadoNuevo = 'disponible';
  }

  if (estadoNuevo !== estadoActual) {
    await cliente.query(
      `
        UPDATE equipo
        SET estado = $2,
            fecha_modificacion = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [equipoId, estadoNuevo]
    );
  }

  return estadoNuevo;
}

/**
 * Registra un evento en el historial del ciclo de vida del activo. Por defecto
 * genera un evento MANTENIMIENTO; las opciones permiten indicar otro tipo y la
 * referencia al registro relacionado (mantenimiento o documento).
 */
async function registrarEventoHistorial(
  cliente,
  hojaVidaId,
  equipoId,
  descripcion,
  usuario,
  opciones = {}
) {
  const tipoEvento = opciones.tipoEvento || 'MANTENIMIENTO';
  await cliente.query(
    `
      INSERT INTO hoja_vida_historial (
        hoja_vida_id, equipo_id, tipo_evento, descripcion, usuario, usuario_creacion,
        referencia_tipo, referencia_id
      ) VALUES ($1, $2, $3, $4, $5, $5, $6, $7)
    `,
    [
      hojaVidaId,
      equipoId,
      tipoEvento,
      descripcion,
      usuario,
      opciones.referenciaTipo || null,
      opciones.referenciaId || null,
    ]
  );
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
        hv.estado AS hoja_vida_estado,
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

    const equipoIds = result.rows.map((row) => Number(row.equipo_id));
    const diasAlerta = await obtenerDiasAlertaVencimiento(pool);
    const resumenPorEquipo = await construirResumenEquipos(pool, equipoIds, diasAlerta);

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
      hoja_vida_estado: row.hoja_vida_estado || null,
      tiene_hoja_vida: Boolean(row.tiene_hoja_vida),
      tiene_mantenimientos: Boolean(row.tiene_mantenimientos),
      alerta: resumenPorEquipo[Number(row.equipo_id)]?.alerta || null,
      costo_mantenimiento_acumulado: resumenPorEquipo[Number(row.equipo_id)]?.costo_total || 0,
      prestamos_total: resumenPorEquipo[Number(row.equipo_id)]?.prestamos_total || 0,
    }));

    return res.json({
      ok: true,
      data,
      count: data.length,
      dias_alerta_vencimiento: diasAlerta,
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

// Estados de solicitud de prestamo que cuentan como prestamo efectivamente
// realizado sobre el activo.
const ESTADOS_PRESTAMO_COMPUTABLES = ['aprobado', 'activo', 'finalizado'];

// Orden de severidad de las situaciones de mantenimiento para priorizar la
// alerta mostrada por equipo.
const SEVERIDAD_SITUACION = {
  EN_EJECUCION: 4,
  VENCIDO: 3,
  PROXIMO_VENCER: 2,
  VIGENTE: 1,
  CUMPLIDO: 0,
  CANCELADO: 0,
};

/**
 * Construye, para una lista de equipos, el resumen de alertas de mantenimiento,
 * costo acumulado y cantidad de prestamos. Se usa en el listado de equipos.
 */
async function construirResumenEquipos(cliente, equipoIds, diasAlerta) {
  const resumen = {};
  if (!Array.isArray(equipoIds) || equipoIds.length === 0) return resumen;

  equipoIds.forEach(function (id) {
    resumen[id] = {
      alerta: null,
      costo_total: 0,
      prestamos_total: 0,
      mantenimientos_total: 0,
    };
  });

  const mantenimientosResult = await cliente.query(
    `
      SELECT equipo_id, estado, fecha_realizacion, costo
      FROM mantenimiento
      WHERE equipo_id = ANY($1::int[]) AND activo = TRUE
    `,
    [equipoIds]
  );

  mantenimientosResult.rows.forEach(function (fila) {
    const id = Number(fila.equipo_id);
    const item = resumen[id];
    if (!item) return;
    item.mantenimientos_total += 1;
    item.costo_total += Number(fila.costo || 0);

    const estado = String(fila.estado || '').toUpperCase();
    if (estado === 'CUMPLIDO' || estado === 'CANCELADO' || estado === 'VENCIDO') return;
    const situacion = situacionMantenimiento(
      { estado: estado, fecha_realizacion: fila.fecha_realizacion },
      diasAlerta
    );
    if (situacion.codigo === 'CUMPLIDO' || situacion.codigo === 'CANCELADO') return;
    const severidad = SEVERIDAD_SITUACION[situacion.codigo] || 0;
    if (!item.alerta || severidad > (SEVERIDAD_SITUACION[item.alerta.codigo] || 0)) {
      item.alerta = {
        codigo: situacion.codigo,
        etiqueta: situacion.etiqueta,
        clase: situacion.clase,
        dias_restantes: diasRestantesMantenimiento(
          { estado: estado, fecha_realizacion: fila.fecha_realizacion },
          new Date()
        ),
      };
    }
  });

  const prestamosResult = await cliente.query(
    `
      SELECT equipo_id, COUNT(*)::int AS total
      FROM solicitud_prestamo
      WHERE equipo_id = ANY($1::int[])
        AND activo = TRUE
        AND estado = ANY($2::text[])
      GROUP BY equipo_id
    `,
    [equipoIds, ESTADOS_PRESTAMO_COMPUTABLES]
  );

  prestamosResult.rows.forEach(function (fila) {
    const id = Number(fila.equipo_id);
    if (resumen[id]) resumen[id].prestamos_total = Number(fila.total || 0);
  });

  return resumen;
}

/**
 * GET /reportes/mantenimientos
 * CA11: reporte consolidado de mantenimientos con filtros y agregados.
 */
router.get('/reportes/mantenimientos', async function reporteMantenimientosHV(req, res) {
  try {
    const params = [];
    const conditions = [];

    const tipo = String(req.query.tipo_mantenimiento || '')
      .trim()
      .toUpperCase();
    if (tipo) {
      if (!esTipoMantenimientoValido(tipo)) {
        return res
          .status(400)
          .json({ ok: false, message: 'El tipo de mantenimiento no es valido.' });
      }
      params.push(tipo);
      conditions.push(`m.tipo_mantenimiento = $${params.length}`);
    }

    const estado = String(req.query.estado || '')
      .trim()
      .toUpperCase();
    if (estado) {
      if (!esEstadoMantenimientoValido(estado)) {
        return res
          .status(400)
          .json({ ok: false, message: 'El estado del mantenimiento no es valido.' });
      }
      params.push(estado);
      conditions.push(`m.estado = $${params.length}`);
    }

    const equipoId = Number(req.query.equipo_id);
    if (Number.isInteger(equipoId) && equipoId > 0) {
      params.push(equipoId);
      conditions.push(`m.equipo_id = $${params.length}`);
    }

    const fechaDesde = normalizarFechaDiaOpcional(req.query.fecha_desde);
    if (fechaDesde) {
      params.push(fechaDesde);
      conditions.push(`m.fecha_realizacion >= $${params.length}`);
    }

    const fechaHasta = normalizarFechaDiaOpcional(req.query.fecha_hasta);
    if (fechaHasta) {
      params.push(fechaHasta);
      conditions.push(`m.fecha_realizacion <= $${params.length}`);
    }

    const facultad = sanitizeLikeValue(req.query.facultad);
    if (facultad) {
      params.push(`%${facultad}%`);
      conditions.push(`COALESCE(u.facultad, e.facultad) ILIKE $${params.length} ESCAPE '\\'`);
    }

    const laboratorio = sanitizeLikeValue(req.query.laboratorio);
    if (laboratorio) {
      params.push(`%${laboratorio}%`);
      conditions.push(`COALESCE(u.nombre, e.laboratorio) ILIKE $${params.length} ESCAPE '\\'`);
    }

    const whereClause = conditions.length ? `AND ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `
        SELECT m.id, m.equipo_id, m.tipo_mantenimiento, m.estado, m.fecha_realizacion, m.costo,
               e.codigo AS equipo_codigo, e.nombre AS equipo_nombre,
               COALESCE(u.nombre, e.laboratorio) AS laboratorio,
               COALESCE(u.facultad, e.facultad) AS facultad
        FROM mantenimiento m
        JOIN equipo e ON e.id = m.equipo_id
        LEFT JOIN inventario inv ON inv.placa = e.codigo AND inv.activo = TRUE
        LEFT JOIN ual u ON u.ual_id = inv.laboratorio_ual_id
        WHERE m.activo = TRUE AND e.activo = TRUE ${whereClause}
        ORDER BY m.fecha_realizacion DESC NULLS LAST, m.id DESC
      `,
      params
    );

    const filas = result.rows;
    const porEstado = {};
    CODIGOS_ESTADO_MANTENIMIENTO.forEach(function (codigo) {
      porEstado[codigo] = 0;
    });
    let costoTotal = 0;
    const porEquipoMap = new Map();
    const porLaboratorioMap = new Map();
    const porPeriodoMap = new Map();
    const porTipoMap = new Map();

    filas.forEach(function (fila) {
      const estadoFila = String(fila.estado || '').toUpperCase();
      porEstado[estadoFila] = (porEstado[estadoFila] || 0) + 1;
      const costo = Number(fila.costo || 0);
      costoTotal += costo;

      const eqKey = Number(fila.equipo_id);
      if (!porEquipoMap.has(eqKey)) {
        porEquipoMap.set(eqKey, {
          equipo_id: eqKey,
          equipo_codigo: fila.equipo_codigo,
          equipo_nombre: fila.equipo_nombre,
          laboratorio: fila.laboratorio,
          facultad: fila.facultad,
          total: 0,
          costo: 0,
        });
      }
      const eq = porEquipoMap.get(eqKey);
      eq.total += 1;
      eq.costo += costo;

      const labKey = fila.laboratorio || 'Sin laboratorio';
      if (!porLaboratorioMap.has(labKey)) {
        porLaboratorioMap.set(labKey, {
          laboratorio: labKey,
          facultad: fila.facultad,
          total: 0,
          costo: 0,
        });
      }
      const lab = porLaboratorioMap.get(labKey);
      lab.total += 1;
      lab.costo += costo;

      const periodo = fila.fecha_realizacion
        ? String(fila.fecha_realizacion).slice(0, 7)
        : 'Sin fecha';
      if (!porPeriodoMap.has(periodo)) {
        porPeriodoMap.set(periodo, { periodo: periodo, total: 0, costo: 0 });
      }
      const periodoItem = porPeriodoMap.get(periodo);
      periodoItem.total += 1;
      periodoItem.costo += costo;

      const tipoFila = String(fila.tipo_mantenimiento || '').toUpperCase();
      if (!porTipoMap.has(tipoFila)) {
        porTipoMap.set(tipoFila, {
          tipo: tipoFila,
          etiqueta: etiquetaTipoMantenimiento(tipoFila),
          total: 0,
          costo: 0,
        });
      }
      const tipoItem = porTipoMap.get(tipoFila);
      tipoItem.total += 1;
      tipoItem.costo += costo;
    });

    return res.json({
      ok: true,
      data: {
        resumen: {
          total: filas.length,
          costo_total: costoTotal,
          costo_promedio: filas.length ? costoTotal / filas.length : 0,
          por_estado: porEstado,
        },
        por_equipo: Array.from(porEquipoMap.values()),
        por_laboratorio: Array.from(porLaboratorioMap.values()),
        por_periodo: Array.from(porPeriodoMap.values()),
        por_tipo: Array.from(porTipoMap.values()),
      },
    });
  } catch (error) {
    console.error('[hojas-vida] Error generando reporte de mantenimientos:', error);
    return res.status(500).json({
      ok: false,
      message: 'No fue posible generar el reporte de mantenimientos.',
      details: process.env.NODE_ENV === 'production' ? undefined : String(error && error.message),
    });
  }
});

/**
 * GET /reportes/alertas
 * CA12: equipos que requieren, estan proximos o tienen mantenimiento vencido,
 * o se encuentran actualmente en mantenimiento.
 */
router.get('/reportes/alertas', async function reporteAlertasHV(req, res) {
  try {
    const diasAlerta = await obtenerDiasAlertaVencimiento(pool);

    const result = await pool.query(
      `
        SELECT m.id, m.equipo_id, m.tipo_mantenimiento, m.estado, m.fecha_realizacion,
               e.codigo AS equipo_codigo, e.nombre AS equipo_nombre,
               hv.codigo_inventario,
               COALESCE(u.nombre, e.laboratorio) AS laboratorio,
               COALESCE(u.facultad, e.facultad) AS facultad
        FROM mantenimiento m
        JOIN equipo e ON e.id = m.equipo_id
        JOIN hoja_vida hv ON hv.id = m.hoja_vida_id
        LEFT JOIN inventario inv ON inv.placa = e.codigo AND inv.activo = TRUE
        LEFT JOIN ual u ON u.ual_id = inv.laboratorio_ual_id
        WHERE m.activo = TRUE AND e.activo = TRUE
          AND m.estado NOT IN ('CUMPLIDO', 'CANCELADO')
        ORDER BY m.fecha_realizacion ASC NULLS LAST, m.id ASC
      `
    );

    const filas = [];
    result.rows.forEach(function (fila) {
      const situacion = situacionMantenimiento(
        { estado: fila.estado, fecha_realizacion: fila.fecha_realizacion },
        diasAlerta
      );
      if (situacion.codigo === 'VIGENTE') return;
      filas.push({
        mantenimiento_id: Number(fila.id),
        equipo_id: Number(fila.equipo_id),
        equipo_codigo: fila.equipo_codigo,
        equipo_nombre: fila.equipo_nombre,
        codigo_inventario: fila.codigo_inventario,
        laboratorio: fila.laboratorio,
        facultad: fila.facultad,
        tipo_mantenimiento: fila.tipo_mantenimiento,
        tipo_mantenimiento_etiqueta: etiquetaTipoMantenimiento(fila.tipo_mantenimiento),
        fecha_programada: fila.fecha_realizacion,
        estado: fila.estado,
        estado_etiqueta: etiquetaEstadoMantenimiento(fila.estado),
        situacion: situacion.codigo,
        situacion_etiqueta: situacion.etiqueta,
        situacion_clase: situacion.clase,
        dias_restantes: diasRestantesMantenimiento(
          { estado: fila.estado, fecha_realizacion: fila.fecha_realizacion },
          new Date()
        ),
      });
    });

    const conteoPorSituacion = {};
    filas.forEach(function (fila) {
      conteoPorSituacion[fila.situacion] = (conteoPorSituacion[fila.situacion] || 0) + 1;
    });

    return res.json({
      ok: true,
      data: {
        dias_alerta_vencimiento: diasAlerta,
        total: filas.length,
        por_situacion: conteoPorSituacion,
        alertas: filas,
      },
    });
  } catch (error) {
    console.error('[hojas-vida] Error generando reporte de alertas:', error);
    return res.status(500).json({
      ok: false,
      message: 'No fue posible generar el reporte de alertas.',
      details: process.env.NODE_ENV === 'production' ? undefined : String(error && error.message),
    });
  }
});

/**
 * GET /reportes/utilizacion
 * CA14: cantidad de prestamos por equipo y reporte de utilizacion.
 */
router.get('/reportes/utilizacion', async function reporteUtilizacionHV(req, res) {
  try {
    const params = [];
    const conditions = [];

    const equipoId = Number(req.query.equipo_id);
    if (Number.isInteger(equipoId) && equipoId > 0) {
      params.push(equipoId);
      conditions.push(`e.id = $${params.length}`);
    }

    const facultad = sanitizeLikeValue(req.query.facultad);
    if (facultad) {
      params.push(`%${facultad}%`);
      conditions.push(`COALESCE(u.facultad, e.facultad) ILIKE $${params.length} ESCAPE '\\'`);
    }

    const laboratorio = sanitizeLikeValue(req.query.laboratorio);
    if (laboratorio) {
      params.push(`%${laboratorio}%`);
      conditions.push(`COALESCE(u.nombre, e.laboratorio) ILIKE $${params.length} ESCAPE '\\'`);
    }

    const fechaDesde = normalizarFechaDiaOpcional(req.query.fecha_desde);
    const fechaHasta = normalizarFechaDiaOpcional(req.query.fecha_hasta);

    params.push(fechaDesde, fechaHasta);
    const idxDesde = params.length - 1;
    const idxHasta = params.length;
    params.push(ESTADOS_PRESTAMO_COMPUTABLES);
    const idxEstados = params.length;

    const whereClause = conditions.length ? `AND ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `
        SELECT e.id AS equipo_id, e.codigo, e.nombre,
               COALESCE(u.nombre, e.laboratorio) AS laboratorio,
               COALESCE(u.facultad, e.facultad) AS facultad,
               COUNT(sp.id)::int AS prestamos
        FROM equipo e
        LEFT JOIN inventario inv ON inv.placa = e.codigo AND inv.activo = TRUE
        LEFT JOIN ual u ON u.ual_id = inv.laboratorio_ual_id
        LEFT JOIN solicitud_prestamo sp
          ON sp.equipo_id = e.id
         AND sp.activo = TRUE
         AND sp.estado = ANY($${idxEstados}::text[])
         AND ($${idxDesde}::date IS NULL OR sp.fecha_inicio::date >= $${idxDesde}::date)
         AND ($${idxHasta}::date IS NULL OR sp.fecha_inicio::date <= $${idxHasta}::date)
        WHERE e.activo = TRUE ${whereClause}
        GROUP BY e.id, e.codigo, e.nombre, u.nombre, e.laboratorio, u.facultad, e.facultad
        ORDER BY prestamos DESC, e.nombre ASC
      `,
      params
    );

    const equipos = result.rows.map(function (fila) {
      return {
        equipo_id: Number(fila.equipo_id),
        codigo: fila.codigo,
        nombre: fila.nombre,
        laboratorio: fila.laboratorio,
        facultad: fila.facultad,
        prestamos: Number(fila.prestamos || 0),
      };
    });

    const totalPrestamos = equipos.reduce(function (acc, eq) {
      return acc + eq.prestamos;
    }, 0);

    return res.json({
      ok: true,
      data: {
        resumen: {
          equipos_total: equipos.length,
          prestamos_total: totalPrestamos,
          promedio_prestamos: equipos.length ? totalPrestamos / equipos.length : 0,
          equipos_sin_prestamos: equipos.filter((eq) => eq.prestamos === 0).length,
        },
        mas_utilizados: equipos.slice(0, 10),
        menos_utilizados: equipos.slice(-10).reverse(),
        por_equipo: equipos,
      },
    });
  } catch (error) {
    console.error('[hojas-vida] Error generando reporte de utilizacion:', error);
    return res.status(500).json({
      ok: false,
      message: 'No fue posible generar el reporte de utilización.',
      details: process.env.NODE_ENV === 'production' ? undefined : String(error && error.message),
    });
  }
});

/**
 * GET /:equipoId/resumen
 * CA10/CA13/CA15: costos acumulados de mantenimiento, cantidad de prestamos y
 * relacion entre utilizacion y mantenimiento para un equipo.
 */
router.get('/:equipoId/resumen', async function resumenEquipoHV(req, res) {
  try {
    const equipoId = Number(req.params?.equipoId);
    if (!Number.isInteger(equipoId) || equipoId <= 0) {
      return res.status(400).json({
        ok: false,
        message: 'El identificador del equipo es invalido.',
      });
    }

    const diasAlerta = await obtenerDiasAlertaVencimiento(pool);
    const fechaDesde = normalizarFechaDiaOpcional(req.query.fecha_desde);
    const fechaHasta = normalizarFechaDiaOpcional(req.query.fecha_hasta);

    const mantenimientosResult = await pool.query(
      `
        SELECT id, tipo_mantenimiento, estado, fecha_realizacion, costo
        FROM mantenimiento
        WHERE equipo_id = $1 AND activo = TRUE
        ORDER BY fecha_realizacion DESC NULLS LAST, id DESC
      `,
      [equipoId]
    );

    const porEstado = {};
    CODIGOS_ESTADO_MANTENIMIENTO.forEach(function (codigo) {
      porEstado[codigo] = 0;
    });
    let costoTotal = 0;
    const porTipoMap = new Map();
    const porPeriodoMap = new Map();
    let alerta = null;

    mantenimientosResult.rows.forEach(function (fila) {
      const estado = String(fila.estado || '').toUpperCase();
      porEstado[estado] = (porEstado[estado] || 0) + 1;
      const costo = Number(fila.costo || 0);
      costoTotal += costo;

      const tipo = String(fila.tipo_mantenimiento || '').toUpperCase();
      if (!porTipoMap.has(tipo)) {
        porTipoMap.set(tipo, {
          tipo: tipo,
          etiqueta: etiquetaTipoMantenimiento(tipo),
          total: 0,
          costo: 0,
        });
      }
      const tipoItem = porTipoMap.get(tipo);
      tipoItem.total += 1;
      tipoItem.costo += costo;

      const periodo = fila.fecha_realizacion
        ? String(fila.fecha_realizacion).slice(0, 7)
        : 'Sin fecha';
      if (!porPeriodoMap.has(periodo)) {
        porPeriodoMap.set(periodo, { periodo: periodo, total: 0, costo: 0 });
      }
      const periodoItem = porPeriodoMap.get(periodo);
      periodoItem.total += 1;
      periodoItem.costo += costo;

      if (estado === 'CUMPLIDO' || estado === 'CANCELADO') return;
      const situacion = situacionMantenimiento(
        { estado: estado, fecha_realizacion: fila.fecha_realizacion },
        diasAlerta
      );
      const severidad = SEVERIDAD_SITUACION[situacion.codigo] || 0;
      if (!alerta || severidad > (SEVERIDAD_SITUACION[alerta.codigo] || 0)) {
        alerta = {
          codigo: situacion.codigo,
          etiqueta: situacion.etiqueta,
          clase: situacion.clase,
          dias_restantes: diasRestantesMantenimiento(
            { estado: estado, fecha_realizacion: fila.fecha_realizacion },
            new Date()
          ),
        };
      }
    });

    const prestamosResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM solicitud_prestamo
        WHERE equipo_id = $1
          AND activo = TRUE
          AND estado = ANY($2::text[])
          AND ($3::date IS NULL OR fecha_inicio::date >= $3::date)
          AND ($4::date IS NULL OR fecha_inicio::date <= $4::date)
      `,
      [equipoId, ESTADOS_PRESTAMO_COMPUTABLES, fechaDesde, fechaHasta]
    );
    const prestamosTotal = Number(prestamosResult.rows[0]?.total || 0);

    return res.json({
      ok: true,
      data: {
        equipo_id: equipoId,
        dias_alerta_vencimiento: diasAlerta,
        alerta: alerta,
        mantenimientos: {
          total: mantenimientosResult.rows.length,
          por_estado: porEstado,
          costo_total: costoTotal,
          por_tipo: Array.from(porTipoMap.values()),
          por_periodo: Array.from(porPeriodoMap.values()),
        },
        prestamos: {
          total: prestamosTotal,
          fecha_desde: fechaDesde || null,
          fecha_hasta: fechaHasta || null,
        },
        relacion: {
          prestamos: prestamosTotal,
          mantenimientos: mantenimientosResult.rows.length,
          costo_mantenimiento: costoTotal,
        },
      },
    });
  } catch (error) {
    console.error('[hojas-vida] Error generando resumen del equipo:', error);
    return res.status(500).json({
      ok: false,
      message: 'No fue posible generar el resumen del equipo.',
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
            view_url: `/milab/prestamos/hojas-vida/${equipoId}`,
            edit_url: `/milab/prestamos/hojas-vida/${equipoId}/editar`,
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
            normalizarTipoUso(camposExtraidos.tipo_uso),
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

        const documentoResult = await cliente.query(
          `
            INSERT INTO hoja_vida_documento (
              hoja_vida_id, tipo_documento, nombre_archivo, tipo_mime, archivo,
              fecha_carga, usuario_carga
            ) VALUES ($1, $2, $3, $4, $5, NOW(), $6)
            RETURNING id
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

        await cliente.query(
          `
            INSERT INTO hoja_vida_historial (
              hoja_vida_id, equipo_id, tipo_evento, descripcion, usuario, usuario_creacion,
              referencia_tipo, referencia_id
            ) VALUES ($1, $2, 'CREACION', $3, $4, $4, 'DOCUMENTO', $5)
          `,
          [
            hojaVidaId,
            equipoId,
            `Hoja de vida creada a partir de la carga del archivo "${file.originalname}" (estado: Pendiente de confirmación).`,
            req.session?.user?.id || null,
            documentoResult.rows[0].id,
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

/**
 * POST /:hojaVidaId/confirmar
 * Confirma la hoja de vida: guarda los campos revisados, la fotografia
 * opcional, cambia el estado a ACTIVA y registra la auditoria (usuario,
 * fecha y evento en el historial).
 */
router.post(
  '/:hojaVidaId/confirmar',
  uploadFoto.single('foto'),
  async function confirmarHojaVida(req, res) {
    try {
      const hojaVidaId = Number(req.params?.hojaVidaId);
      if (!Number.isInteger(hojaVidaId) || hojaVidaId <= 0) {
        return res.status(400).json({
          ok: false,
          message: 'El identificador de la hoja de vida es invalido.',
        });
      }

      const hvResult = await pool.query(
        `
          SELECT *
          FROM hoja_vida
          WHERE id = $1 AND activo = TRUE
        `,
        [hojaVidaId]
      );

      if (hvResult.rows.length === 0) {
        return res.status(404).json({
          ok: false,
          message: 'La hoja de vida no existe.',
        });
      }

      const hvActual = hvResult.rows[0];

      if (hvActual.estado === 'ACTIVA') {
        return res.status(409).json({
          ok: false,
          message: 'La hoja de vida ya está confirmada.',
          details: { hoja_vida_id: hojaVidaId, estado: hvActual.estado },
        });
      }

      const datos = normalizarCamposHojaVida(req.body || {});

      // Validar campos obligatorios definidos en la parametrizacion
      const configResult = await pool.query(
        `
          SELECT nombre_campo
          FROM hoja_vida_config_campos
          WHERE activo = TRUE AND obligatorio = TRUE
        `
      );

      const faltantes = [];
      configResult.rows.forEach(function (row) {
        const campo = row.nombre_campo;
        const valor = Object.prototype.hasOwnProperty.call(datos, campo)
          ? datos[campo]
          : hvActual[campo];
        if (valor == null || String(valor).trim() === '') {
          faltantes.push(campo);
        }
      });

      if (faltantes.length > 0) {
        return res.status(400).json({
          ok: false,
          message: 'Faltan campos obligatorios para confirmar la hoja de vida.',
          details: { campos_faltantes: faltantes },
        });
      }

      const usuario = req.session?.user?.id || null;
      const equipoId = Number(hvActual.equipo_id);

      const cliente = await pool.connect();
      try {
        await cliente.query('BEGIN');

        const setParts = [];
        const values = [];
        let idx = 1;
        Object.keys(datos).forEach(function (campo) {
          setParts.push(`${campo} = $${idx++}`);
          values.push(datos[campo]);
        });
        setParts.push("estado = 'ACTIVA'");
        setParts.push('fecha_modificacion = CURRENT_TIMESTAMP');
        setParts.push(`usuario_modificacion = $${idx++}`);
        values.push(usuario);
        values.push(hojaVidaId);

        const updateResult = await cliente.query(
          `
            UPDATE hoja_vida
            SET ${setParts.join(', ')}
            WHERE id = $${idx}
            RETURNING id, estado
          `,
          values
        );

        if (req.file) {
          const fotoInsert = await cliente.query(
            `
              INSERT INTO hoja_vida_documento (
                hoja_vida_id, tipo_documento, nombre_archivo, tipo_mime, archivo,
                fecha_carga, usuario_carga
              ) VALUES ($1, 'FOTOGRAFIA_EQUIPO', $2, $3, $4, NOW(), $5)
              RETURNING id
            `,
            [hojaVidaId, req.file.originalname, req.file.mimetype, req.file.buffer, usuario]
          );

          await cliente.query(
            `
              INSERT INTO hoja_vida_historial (
                hoja_vida_id, equipo_id, tipo_evento, campo_modificado,
                valor_anterior, valor_nuevo, descripcion, usuario, usuario_creacion,
                referencia_tipo, referencia_id
              ) VALUES ($1, $2, 'FOTOGRAFIA', 'fotografia', $3, $4, $5, $6, $6, 'DOCUMENTO', $7)
            `,
            [
              hojaVidaId,
              equipoId,
              'Sin fotografia',
              req.file.originalname,
              'Carga de la fotografía del equipo durante la confirmación de la hoja de vida.',
              usuario,
              fotoInsert.rows[0].id,
            ]
          );
        }

        await cliente.query(
          `
            INSERT INTO hoja_vida_historial (
              hoja_vida_id, equipo_id, tipo_evento, campo_modificado,
              valor_anterior, valor_nuevo, descripcion, usuario
            ) VALUES ($1, $2, 'CONFIRMACION', 'estado', $3, 'ACTIVA', $4, $5)
          `,
          [
            hojaVidaId,
            equipoId,
            hvActual.estado,
            'Confirmación de la hoja de vida (creación oficial).',
            usuario,
          ]
        );

        await cliente.query('COMMIT');

        return res.status(200).json({
          ok: true,
          message: 'Hoja de vida confirmada correctamente.',
          data: {
            hoja_vida_id: Number(updateResult.rows[0].id),
            estado: updateResult.rows[0].estado,
            tiene_fotografia: Boolean(req.file),
            view_url: `/milab/prestamos/hojas-vida/${equipoId}`,
          },
        });
      } catch (txError) {
        await cliente.query('ROLLBACK');
        throw txError;
      } finally {
        cliente.release();
      }
    } catch (error) {
      if (error && error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          ok: false,
          message: `La fotografía excede el tamaño máximo permitido (${Math.round(
            HV_FOTO_MAX_BYTES / (1024 * 1024)
          )} MB).`,
        });
      }
      if (error && error.message && error.message.includes('La fotografía debe ser')) {
        return res.status(400).json({
          ok: false,
          message: error.message,
        });
      }
      console.error('[hojas-vida] Error confirmando hoja de vida:', error);
      return res.status(500).json({
        ok: false,
        message: 'No fue posible confirmar la hoja de vida.',
        details: process.env.NODE_ENV === 'production' ? undefined : String(error && error.message),
      });
    }
  }
);

/**
 * POST /:hojaVidaId/editar
 * Actualiza los campos de una hoja de vida ACTIVA, reemplaza la fotografia si
 * se envia una nueva y registra un evento EDICION por cada campo modificado
 * (campo, valor anterior y valor nuevo) para mantener la trazabilidad.
 */
router.post(
  '/:hojaVidaId/editar',
  uploadFoto.single('foto'),
  async function editarHojaVida(req, res) {
    try {
      const hojaVidaId = Number(req.params?.hojaVidaId);
      if (!Number.isInteger(hojaVidaId) || hojaVidaId <= 0) {
        return res.status(400).json({
          ok: false,
          message: 'El identificador de la hoja de vida es invalido.',
        });
      }

      const hvResult = await pool.query(
        `
          SELECT *
          FROM hoja_vida
          WHERE id = $1 AND activo = TRUE
        `,
        [hojaVidaId]
      );

      if (hvResult.rows.length === 0) {
        return res.status(404).json({
          ok: false,
          message: 'La hoja de vida no existe.',
        });
      }

      const hvActual = hvResult.rows[0];

      if (hvActual.estado !== 'ACTIVA') {
        return res.status(409).json({
          ok: false,
          message: 'Solo se puede editar una hoja de vida confirmada (estado Activa).',
          details: { hoja_vida_id: hojaVidaId, estado: hvActual.estado },
        });
      }

      const datos = normalizarCamposHojaVida(req.body || {});

      // Validar campos obligatorios definidos en la parametrizacion
      const configResult = await pool.query(
        `
          SELECT nombre_campo
          FROM hoja_vida_config_campos
          WHERE activo = TRUE AND obligatorio = TRUE
        `
      );

      const faltantes = [];
      configResult.rows.forEach(function (row) {
        const campo = row.nombre_campo;
        const valor = Object.prototype.hasOwnProperty.call(datos, campo)
          ? datos[campo]
          : hvActual[campo];
        if (valor == null || String(valor).trim() === '') {
          faltantes.push(campo);
        }
      });

      if (faltantes.length > 0) {
        return res.status(400).json({
          ok: false,
          message: 'Faltan campos obligatorios para guardar la hoja de vida.',
          details: { campos_faltantes: faltantes },
        });
      }

      // Fotografia vigente (para reemplazo o eliminacion)
      const fotoResult = await pool.query(
        `
          SELECT id, nombre_archivo
          FROM hoja_vida_documento
          WHERE hoja_vida_id = $1
            AND tipo_documento = 'FOTOGRAFIA_EQUIPO'
            AND activo = TRUE
          ORDER BY fecha_carga DESC NULLS LAST, id DESC
          LIMIT 1
        `,
        [hojaVidaId]
      );
      const fotoActiva = fotoResult.rows[0] || null;
      const valorEliminarFoto = String(req.body?.eliminar_foto || '')
        .trim()
        .toLowerCase();
      const eliminarFoto =
        (valorEliminarFoto === '1' || valorEliminarFoto === 'true') &&
        !req.file &&
        Boolean(fotoActiva);

      // Detectar cambios reales comparando valor anterior y nuevo
      const cambios = [];
      Object.keys(datos).forEach(function (campo) {
        const definicion = CAMPOS_HOJA_VIDA_POR_NOMBRE.get(campo) || {};
        const anterior = normalizarValorComparacion(hvActual[campo], definicion.tipo);
        const nuevo = normalizarValorComparacion(datos[campo], definicion.tipo);
        if (anterior !== nuevo) {
          cambios.push({ campo, anterior, nuevo });
        }
      });

      const usuario = req.session?.user?.id || null;
      const equipoId = Number(hvActual.equipo_id);
      const tieneCambios = cambios.length > 0 || Boolean(req.file) || eliminarFoto;

      if (!tieneCambios) {
        return res.status(200).json({
          ok: true,
          message: 'No se detectaron cambios en la hoja de vida.',
          data: { hoja_vida_id: hojaVidaId, sin_cambios: true, cambios: [] },
        });
      }

      const cliente = await pool.connect();
      try {
        await cliente.query('BEGIN');

        const setParts = [];
        const values = [];
        let idx = 1;
        Object.keys(datos).forEach(function (campo) {
          setParts.push(`${campo} = $${idx++}`);
          values.push(datos[campo]);
        });
        setParts.push('fecha_modificacion = CURRENT_TIMESTAMP');
        setParts.push(`usuario_modificacion = $${idx++}`);
        values.push(usuario);
        values.push(hojaVidaId);

        await cliente.query(
          `
            UPDATE hoja_vida
            SET ${setParts.join(', ')}
            WHERE id = $${idx}
          `,
          values
        );

        if (req.file || eliminarFoto) {
          await cliente.query(
            `
              UPDATE hoja_vida_documento
              SET activo = FALSE,
                  fecha_modificacion = CURRENT_TIMESTAMP,
                  usuario_modificacion = $2
              WHERE hoja_vida_id = $1
                AND tipo_documento = 'FOTOGRAFIA_EQUIPO'
                AND activo = TRUE
            `,
            [hojaVidaId, usuario]
          );
        }

        if (req.file) {
          const fotoInsert = await cliente.query(
            `
              INSERT INTO hoja_vida_documento (
                hoja_vida_id, tipo_documento, nombre_archivo, tipo_mime, archivo,
                fecha_carga, usuario_carga
              ) VALUES ($1, 'FOTOGRAFIA_EQUIPO', $2, $3, $4, NOW(), $5)
              RETURNING id
            `,
            [hojaVidaId, req.file.originalname, req.file.mimetype, req.file.buffer, usuario]
          );

          cambios.push({
            campo: 'fotografia',
            anterior: fotoActiva ? fotoActiva.nombre_archivo : 'Sin fotografia',
            nuevo: req.file.originalname,
            descripcion: 'Actualizacion de la fotografia del equipo.',
            tipoEvento: 'FOTOGRAFIA',
            referenciaTipo: 'DOCUMENTO',
            referenciaId: fotoInsert.rows[0].id,
          });
        } else if (eliminarFoto) {
          cambios.push({
            campo: 'fotografia',
            anterior: fotoActiva ? fotoActiva.nombre_archivo : 'Sin fotografia',
            nuevo: 'Sin fotografia',
            descripcion: 'Eliminacion de la fotografia del equipo.',
            tipoEvento: 'FOTOGRAFIA',
            referenciaTipo: 'DOCUMENTO',
            referenciaId: fotoActiva ? fotoActiva.id : null,
          });
        }

        for (const cambio of cambios) {
          const definicion = CAMPOS_HOJA_VIDA_POR_NOMBRE.get(cambio.campo) || {};
          const etiqueta = definicion.etiqueta || cambio.campo;
          const descripcion =
            cambio.descripcion || `Edición de la hoja de vida: campo "${etiqueta}" actualizado.`;
          await cliente.query(
            `
              INSERT INTO hoja_vida_historial (
                hoja_vida_id, equipo_id, tipo_evento, campo_modificado,
                valor_anterior, valor_nuevo, descripcion, usuario, usuario_creacion,
                referencia_tipo, referencia_id
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10)
            `,
            [
              hojaVidaId,
              equipoId,
              cambio.tipoEvento || 'EDICION',
              cambio.campo,
              cambio.anterior,
              cambio.nuevo,
              descripcion,
              usuario,
              cambio.referenciaTipo || null,
              cambio.referenciaId || null,
            ]
          );
        }

        await cliente.query('COMMIT');

        return res.status(200).json({
          ok: true,
          message: `Hoja de vida actualizada correctamente (${cambios.length} cambio(s)).`,
          data: {
            hoja_vida_id: hojaVidaId,
            cambios: cambios.map((cambio) => cambio.campo),
            total_cambios: cambios.length,
            tiene_fotografia: req.file ? true : eliminarFoto ? false : Boolean(fotoActiva),
            foto_eliminada: eliminarFoto,
            view_url: `/milab/prestamos/hojas-vida/${equipoId}`,
          },
        });
      } catch (txError) {
        await cliente.query('ROLLBACK');
        throw txError;
      } finally {
        cliente.release();
      }
    } catch (error) {
      if (error && error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          ok: false,
          message: `La fotografía excede el tamaño máximo permitido (${Math.round(
            HV_FOTO_MAX_BYTES / (1024 * 1024)
          )} MB).`,
        });
      }
      if (error && error.message && error.message.includes('La fotografía debe ser')) {
        return res.status(400).json({
          ok: false,
          message: error.message,
        });
      }
      console.error('[hojas-vida] Error editando hoja de vida:', error);
      return res.status(500).json({
        ok: false,
        message: 'No fue posible actualizar la hoja de vida.',
        details: process.env.NODE_ENV === 'production' ? undefined : String(error && error.message),
      });
    }
  }
);

/**
 * POST /:equipoId/mantenimientos
 * Registra un mantenimiento asociado a la hoja de vida del equipo y genera el
 * evento MANTENIMIENTO en el historial del ciclo de vida del activo.
 */
router.post('/:equipoId/mantenimientos', async function registrarMantenimientoHV(req, res) {
  try {
    const equipoId = Number(req.params?.equipoId);
    if (!Number.isInteger(equipoId) || equipoId <= 0) {
      return res.status(400).json({
        ok: false,
        message: 'El identificador del equipo es invalido.',
      });
    }

    const hvResult = await pool.query(
      `
        SELECT id, equipo_id, estado
        FROM hoja_vida
        WHERE equipo_id = $1 AND activo = TRUE
        ORDER BY id DESC
        LIMIT 1
      `,
      [equipoId]
    );

    if (hvResult.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        message: 'El equipo no tiene una hoja de vida registrada.',
      });
    }

    const hojaVida = hvResult.rows[0];
    const body = req.body || {};

    const item = normalizarTextoOpcional(body.item);
    if (!item) {
      return res.status(400).json({
        ok: false,
        message: 'El ítem o descripción del mantenimiento es obligatorio.',
        details: { campos_faltantes: ['item'] },
      });
    }

    const tipoMantenimiento = String(body.tipo_mantenimiento || '')
      .trim()
      .toUpperCase();
    if (!esTipoMantenimientoValido(tipoMantenimiento)) {
      return res.status(400).json({
        ok: false,
        message: 'El tipo de mantenimiento no es valido.',
        details: { campos_faltantes: ['tipo_mantenimiento'] },
      });
    }

    const estado = String(body.estado || ESTADO_MANTENIMIENTO_DEFAULT)
      .trim()
      .toUpperCase();
    if (!esEstadoMantenimientoValido(estado)) {
      return res.status(400).json({
        ok: false,
        message: 'El estado del mantenimiento no es valido.',
        details: { campos_faltantes: ['estado'] },
      });
    }

    const fechaRealizacion = normalizarFechaDiaOpcional(body.fecha_realizacion);
    if (normalizarTextoOpcional(body.fecha_realizacion) && !fechaRealizacion) {
      return res.status(400).json({
        ok: false,
        message: 'La fecha de realización no es válida.',
      });
    }

    const costo = normalizarCostoOpcional(body.costo);
    if (Number.isNaN(costo)) {
      return res.status(400).json({
        ok: false,
        message: 'El costo del mantenimiento debe ser un valor numérico mayor o igual a cero.',
        details: { campos_faltantes: ['costo'] },
      });
    }

    const usuario = req.session?.user?.id || null;
    const esCierreDirecto = estado === 'CUMPLIDO';

    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');

      const insertResult = await cliente.query(
        `
          INSERT INTO mantenimiento (
            hoja_vida_id, equipo_id, item, tipo_mantenimiento, fecha_realizacion,
            datos_empresa_contratada, tiempo_garantia, especificaciones_mantenimiento,
            responsable, observaciones_repuestos, costo, estado,
            fecha_cierre, usuario_cierre, usuario_creacion
          ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8,
            $9, $10, $11, $12,
            $13, $14, $15
          )
          RETURNING id, estado
        `,
        [
          hojaVida.id,
          equipoId,
          item,
          tipoMantenimiento,
          fechaRealizacion,
          normalizarTextoOpcional(body.datos_empresa_contratada),
          normalizarTextoOpcional(body.tiempo_garantia),
          normalizarTextoOpcional(body.especificaciones_mantenimiento),
          normalizarTextoOpcional(body.responsable),
          normalizarTextoOpcional(body.observaciones_repuestos),
          costo,
          estado,
          esCierreDirecto ? new Date() : null,
          esCierreDirecto ? usuario : null,
          usuario,
        ]
      );

      const mantenimientoId = Number(insertResult.rows[0].id);

      await registrarEventoHistorial(
        cliente,
        hojaVida.id,
        equipoId,
        `Mantenimiento ${etiquetaTipoMantenimiento(tipoMantenimiento)} registrado: "${item}".`,
        usuario,
        { referenciaTipo: 'MANTENIMIENTO', referenciaId: mantenimientoId }
      );

      // CA06: si el mantenimiento inicia en ejecucion, el equipo deja de estar
      // disponible para prestamo.
      await sincronizarDisponibilidadEquipo(cliente, equipoId);

      await cliente.query('COMMIT');

      return res.status(201).json({
        ok: true,
        message: 'Mantenimiento registrado correctamente.',
        data: {
          mantenimiento_id: mantenimientoId,
          hoja_vida_id: Number(hojaVida.id),
          estado: insertResult.rows[0].estado,
          costo: costo,
          listado_url: `/milab/prestamos/hojas-vida/${equipoId}/mantenimientos`,
        },
      });
    } catch (txError) {
      await cliente.query('ROLLBACK');
      throw txError;
    } finally {
      cliente.release();
    }
  } catch (error) {
    console.error('[hojas-vida] Error registrando mantenimiento:', error);
    return res.status(500).json({
      ok: false,
      message: 'No fue posible registrar el mantenimiento.',
      details: process.env.NODE_ENV === 'production' ? undefined : String(error && error.message),
    });
  }
});

/**
 * Carga un mantenimiento activo del equipo indicado. Devuelve null cuando no
 * existe o no pertenece al equipo.
 */
async function cargarMantenimientoDeEquipo(cliente, equipoId, mantenimientoId) {
  const result = await cliente.query(
    `
      SELECT m.*
      FROM mantenimiento m
      JOIN hoja_vida hv ON hv.id = m.hoja_vida_id
      WHERE m.id = $1 AND m.equipo_id = $2 AND hv.equipo_id = $2
        AND m.activo = TRUE AND hv.activo = TRUE
      LIMIT 1
    `,
    [mantenimientoId, equipoId]
  );
  return result.rows[0] || null;
}

/**
 * Valida y normaliza los campos editables de un mantenimiento. Devuelve
 * { error } cuando hay un problema de validacion o { datos } con el resultado.
 */
function normalizarDatosMantenimiento(body) {
  const item = normalizarTextoOpcional(body.item);
  if (!item) {
    return {
      error: {
        message: 'El ítem o descripción del mantenimiento es obligatorio.',
        campos: ['item'],
      },
    };
  }

  const tipoMantenimiento = String(body.tipo_mantenimiento || '')
    .trim()
    .toUpperCase();
  if (!esTipoMantenimientoValido(tipoMantenimiento)) {
    return {
      error: {
        message: 'El tipo de mantenimiento no es valido.',
        campos: ['tipo_mantenimiento'],
      },
    };
  }

  const estado = String(body.estado || ESTADO_MANTENIMIENTO_DEFAULT)
    .trim()
    .toUpperCase();
  if (!esEstadoMantenimientoValido(estado)) {
    return {
      error: {
        message: 'El estado del mantenimiento no es valido.',
        campos: ['estado'],
      },
    };
  }

  const fechaRealizacion = normalizarFechaDiaOpcional(body.fecha_realizacion);
  if (normalizarTextoOpcional(body.fecha_realizacion) && !fechaRealizacion) {
    return {
      error: { message: 'La fecha de realización no es válida.', campos: ['fecha_realizacion'] },
    };
  }

  const costo = normalizarCostoOpcional(body.costo);
  if (Number.isNaN(costo)) {
    return {
      error: {
        message: 'El costo del mantenimiento debe ser un valor numérico mayor o igual a cero.',
        campos: ['costo'],
      },
    };
  }

  return {
    datos: {
      item,
      tipo_mantenimiento: tipoMantenimiento,
      estado,
      fecha_realizacion: fechaRealizacion,
      costo,
      datos_empresa_contratada: normalizarTextoOpcional(body.datos_empresa_contratada),
      tiempo_garantia: normalizarTextoOpcional(body.tiempo_garantia),
      especificaciones_mantenimiento: normalizarTextoOpcional(body.especificaciones_mantenimiento),
      responsable: normalizarTextoOpcional(body.responsable),
      observaciones_repuestos: normalizarTextoOpcional(body.observaciones_repuestos),
    },
  };
}

/**
 * PUT /:equipoId/mantenimientos/:mantenimientoId
 * CA04: edicion ordinaria de un mantenimiento mientras este en estado
 * Programado (PENDIENTE) o En ejecucion.
 */
router.put(
  '/:equipoId/mantenimientos/:mantenimientoId',
  async function editarMantenimientoHV(req, res) {
    try {
      const equipoId = Number(req.params?.equipoId);
      const mantenimientoId = Number(req.params?.mantenimientoId);
      if (
        !Number.isInteger(equipoId) ||
        equipoId <= 0 ||
        !Number.isInteger(mantenimientoId) ||
        mantenimientoId <= 0
      ) {
        return res.status(400).json({
          ok: false,
          message: 'Los identificadores del equipo o del mantenimiento son invalidos.',
        });
      }

      const normalizado = normalizarDatosMantenimiento(req.body || {});
      if (normalizado.error) {
        return res.status(400).json({
          ok: false,
          message: normalizado.error.message,
          details: { campos_faltantes: normalizado.error.campos },
        });
      }
      const datos = normalizado.datos;

      const usuario = req.session?.user?.id || null;
      const cliente = await pool.connect();
      try {
        await cliente.query('BEGIN');

        const mantenimiento = await cargarMantenimientoDeEquipo(cliente, equipoId, mantenimientoId);
        if (!mantenimiento) {
          await cliente.query('ROLLBACK');
          return res.status(404).json({
            ok: false,
            message: 'El mantenimiento no existe para el equipo indicado.',
          });
        }

        if (!esEstadoEditableMantenimiento(String(mantenimiento.estado || '').toUpperCase())) {
          await cliente.query('ROLLBACK');
          return res.status(409).json({
            ok: false,
            message:
              'El mantenimiento no puede modificarse porque ya fue cerrado. Solo los mantenimientos Programados o En ejecución admiten edición.',
          });
        }

        const esCierre = datos.estado === 'CUMPLIDO';
        const updateResult = await cliente.query(
          `
            UPDATE mantenimiento
            SET item = $3,
                tipo_mantenimiento = $4,
                fecha_realizacion = $5,
                datos_empresa_contratada = $6,
                tiempo_garantia = $7,
                especificaciones_mantenimiento = $8,
                responsable = $9,
                observaciones_repuestos = $10,
                costo = $11,
                estado = $12,
                fecha_cierre = CASE WHEN $13 THEN COALESCE(fecha_cierre, CURRENT_TIMESTAMP) ELSE fecha_cierre END,
                usuario_cierre = CASE WHEN $13 THEN COALESCE(usuario_cierre, $14) ELSE usuario_cierre END,
                usuario_modificacion = $14,
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $1 AND equipo_id = $2 AND activo = TRUE
            RETURNING id, estado, fecha_cierre, usuario_cierre
          `,
          [
            mantenimientoId,
            equipoId,
            datos.item,
            datos.tipo_mantenimiento,
            datos.fecha_realizacion,
            datos.datos_empresa_contratada,
            datos.tiempo_garantia,
            datos.especificaciones_mantenimiento,
            datos.responsable,
            datos.observaciones_repuestos,
            datos.costo,
            datos.estado,
            esCierre,
            usuario,
          ]
        );

        await registrarEventoHistorial(
          cliente,
          mantenimiento.hoja_vida_id,
          equipoId,
          `Mantenimiento #${mantenimientoId} actualizado por ${usuario || 'usuario'}. Estado: ${etiquetaEstadoMantenimiento(datos.estado)}.`,
          usuario,
          { referenciaTipo: 'MANTENIMIENTO', referenciaId: mantenimientoId }
        );

        await sincronizarDisponibilidadEquipo(cliente, equipoId);

        await cliente.query('COMMIT');

        return res.json({
          ok: true,
          message: 'Mantenimiento actualizado correctamente.',
          data: {
            mantenimiento_id: Number(updateResult.rows[0].id),
            estado: updateResult.rows[0].estado,
            fecha_cierre: updateResult.rows[0].fecha_cierre,
            listado_url: `/milab/prestamos/hojas-vida/${equipoId}/mantenimientos`,
          },
        });
      } catch (txError) {
        await cliente.query('ROLLBACK');
        throw txError;
      } finally {
        cliente.release();
      }
    } catch (error) {
      console.error('[hojas-vida] Error editando mantenimiento:', error);
      return res.status(500).json({
        ok: false,
        message: 'No fue posible actualizar el mantenimiento.',
        details: process.env.NODE_ENV === 'production' ? undefined : String(error && error.message),
      });
    }
  }
);

/**
 * POST /:equipoId/mantenimientos/:mantenimientoId/estado
 * CA05: cierre y cambios de estado del mantenimiento (En ejecucion, Cumplido,
 * Vencido, Cancelado). Al cerrar se registra fecha, hora y usuario responsable.
 */
router.post(
  '/:equipoId/mantenimientos/:mantenimientoId/estado',
  async function cambiarEstadoMantenimientoHV(req, res) {
    try {
      const equipoId = Number(req.params?.equipoId);
      const mantenimientoId = Number(req.params?.mantenimientoId);
      if (
        !Number.isInteger(equipoId) ||
        equipoId <= 0 ||
        !Number.isInteger(mantenimientoId) ||
        mantenimientoId <= 0
      ) {
        return res.status(400).json({
          ok: false,
          message: 'Los identificadores del equipo o del mantenimiento son invalidos.',
        });
      }

      const estadoNuevo = String(req.body?.estado || '')
        .trim()
        .toUpperCase();
      if (!esEstadoMantenimientoValido(estadoNuevo)) {
        return res.status(400).json({
          ok: false,
          message: 'El estado del mantenimiento no es valido.',
          details: { campos_faltantes: ['estado'] },
        });
      }

      const usuario = req.session?.user?.id || null;
      const cliente = await pool.connect();
      try {
        await cliente.query('BEGIN');

        const mantenimiento = await cargarMantenimientoDeEquipo(cliente, equipoId, mantenimientoId);
        if (!mantenimiento) {
          await cliente.query('ROLLBACK');
          return res.status(404).json({
            ok: false,
            message: 'El mantenimiento no existe para el equipo indicado.',
          });
        }

        const estadoActual = String(mantenimiento.estado || '').toUpperCase();
        if (estadoActual === estadoNuevo) {
          await cliente.query('ROLLBACK');
          return res.status(409).json({
            ok: false,
            message: `El mantenimiento ya se encuentra en estado ${etiquetaEstadoMantenimiento(estadoNuevo)}.`,
          });
        }
        if (estadoActual === 'CUMPLIDO' || estadoActual === 'CANCELADO') {
          await cliente.query('ROLLBACK');
          return res.status(409).json({
            ok: false,
            message: 'El mantenimiento ya fue cerrado y no admite cambios de estado.',
          });
        }

        const esCierre = estadoNuevo === 'CUMPLIDO';
        const updateResult = await cliente.query(
          `
            UPDATE mantenimiento
            SET estado = $3,
                fecha_cierre = CASE WHEN $4 THEN CURRENT_TIMESTAMP ELSE fecha_cierre END,
                usuario_cierre = CASE WHEN $4 THEN $5 ELSE usuario_cierre END,
                usuario_modificacion = $5,
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $1 AND equipo_id = $2 AND activo = TRUE
            RETURNING id, estado, fecha_cierre, usuario_cierre
          `,
          [mantenimientoId, equipoId, estadoNuevo, esCierre, usuario]
        );

        await registrarEventoHistorial(
          cliente,
          mantenimiento.hoja_vida_id,
          equipoId,
          `Mantenimiento #${mantenimientoId} ${esCierre ? 'cerrado' : 'cambiado'} a estado ${etiquetaEstadoMantenimiento(estadoNuevo)} por ${usuario || 'usuario'}.`,
          usuario,
          { referenciaTipo: 'MANTENIMIENTO', referenciaId: mantenimientoId }
        );

        await sincronizarDisponibilidadEquipo(cliente, equipoId);

        await cliente.query('COMMIT');

        return res.json({
          ok: true,
          message: esCierre
            ? 'Mantenimiento cerrado como Cumplido.'
            : 'Estado del mantenimiento actualizado correctamente.',
          data: {
            mantenimiento_id: Number(updateResult.rows[0].id),
            estado: updateResult.rows[0].estado,
            fecha_cierre: updateResult.rows[0].fecha_cierre,
            usuario_cierre: updateResult.rows[0].usuario_cierre,
            listado_url: `/milab/prestamos/hojas-vida/${equipoId}/mantenimientos`,
          },
        });
      } catch (txError) {
        await cliente.query('ROLLBACK');
        throw txError;
      } finally {
        cliente.release();
      }
    } catch (error) {
      console.error('[hojas-vida] Error cambiando estado del mantenimiento:', error);
      return res.status(500).json({
        ok: false,
        message: 'No fue posible actualizar el estado del mantenimiento.',
        details: process.env.NODE_ENV === 'production' ? undefined : String(error && error.message),
      });
    }
  }
);

/**
 * POST /:hojaVidaId/eventos
 * Registra un evento manual en el historial del ciclo de vida del activo.
 */
router.post('/:hojaVidaId/eventos', async function registrarEventoHojaVida(req, res) {
  try {
    const hojaVidaId = Number(req.params?.hojaVidaId);
    if (!Number.isInteger(hojaVidaId) || hojaVidaId <= 0) {
      return res.status(400).json({
        ok: false,
        message: 'El identificador de la hoja de vida es invalido.',
      });
    }

    const hvResult = await pool.query(
      `
        SELECT id, equipo_id, estado
        FROM hoja_vida
        WHERE id = $1 AND activo = TRUE
      `,
      [hojaVidaId]
    );

    if (hvResult.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        message: 'La hoja de vida no existe.',
      });
    }

    const hojaVida = hvResult.rows[0];
    const body = req.body || {};

    const tipoEvento = String(body.tipo_evento || '')
      .trim()
      .toUpperCase();
    if (!esTipoEventoManual(tipoEvento)) {
      return res.status(400).json({
        ok: false,
        message: 'El tipo de evento no es valido.',
        details: { campos_faltantes: ['tipo_evento'] },
      });
    }

    const descripcion = normalizarTextoOpcional(body.descripcion);
    if (!descripcion) {
      return res.status(400).json({
        ok: false,
        message: 'La descripción del evento es obligatoria.',
        details: { campos_faltantes: ['descripcion'] },
      });
    }

    const fecha = normalizarFechaOpcional(body.fecha);
    if (normalizarTextoOpcional(body.fecha) && !fecha) {
      return res.status(400).json({
        ok: false,
        message: 'La fecha del evento no es válida.',
      });
    }

    const campoModificado = normalizarTextoOpcional(body.campo_modificado);
    const valorAnterior = normalizarTextoOpcional(body.valor_anterior);
    const valorNuevo = normalizarTextoOpcional(body.valor_nuevo);
    const usuario = normalizarTextoOpcional(body.usuario) || req.session?.user?.id || null;

    const insertResult = await pool.query(
      `
        INSERT INTO hoja_vida_historial (
          hoja_vida_id, equipo_id, tipo_evento, campo_modificado,
          valor_anterior, valor_nuevo, descripcion, usuario, fecha, usuario_creacion
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          COALESCE($9::timestamptz, CURRENT_TIMESTAMP), $10
        )
        RETURNING id, tipo_evento, fecha
      `,
      [
        hojaVidaId,
        hojaVida.equipo_id,
        tipoEvento,
        campoModificado,
        valorAnterior,
        valorNuevo,
        descripcion,
        usuario,
        fecha,
        req.session?.user?.id || null,
      ]
    );

    return res.status(201).json({
      ok: true,
      message: 'Evento registrado correctamente.',
      data: {
        evento_id: Number(insertResult.rows[0].id),
        tipo_evento: insertResult.rows[0].tipo_evento,
        fecha: insertResult.rows[0].fecha,
      },
    });
  } catch (error) {
    console.error('[hojas-vida] Error registrando evento:', error);
    return res.status(500).json({
      ok: false,
      message: 'No fue posible registrar el evento.',
      details: process.env.NODE_ENV === 'production' ? undefined : String(error && error.message),
    });
  }
});

module.exports = router;
