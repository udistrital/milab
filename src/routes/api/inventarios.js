const express = require('express');
const multer = require('multer');
const path = require('node:path');
const pool = require('../../libs/db');
const { normalizeRoles } = require('../../libs/roles');
const { requireRoles } = require('../middlewares/auth');
const { verifyCsrfToken: verifyUploadCsrfToken } = require('../middlewares/csrf');
const {
  INVENTORY_TYPES,
  InventoryImportError,
  getAdditionalIdentifierHeaders,
  normalizeIdentifier,
  parseWorkbook,
  validateInventoryRows,
} = require('../../libs/inventario-import');

const router = express.Router();
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_IMPORT_ROWS = 5000;
const INVENTORY_LABELS = Object.freeze({
  [INVENTORY_TYPES.ARKA_EQUIPMENT]: 'Inventario de Equipos',
  [INVENTORY_TYPES.COMPLEMENTARY]: 'Inventario complementario',
  [INVENTORY_TYPES.REAGENT]: 'Reactivos',
});
const INVENTORY_ALL_TYPES = Object.values(INVENTORY_TYPES);
const ADDITIONAL_IDENTIFIER_TYPE = 'nomenclatura_adicional';
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

const requireInventoryAccess = requireRoles(
  ['admin', 'coordinador_general', 'laboratorista', 'coordinador'],
  {
    message: 'Acceso denegado',
    message2: 'No tienes permisos para consultar el módulo de inventarios.',
    limit: 'loginOnly',
  }
);
const requireInventoryEditor = requireRoles(['admin', 'laboratorista'], {
  message: 'Acceso denegado',
  message2: 'Solo el laboratorista asignado puede cargar el inventario.',
  limit: 'loginOnly',
});
const requireInventoryApprover = requireRoles(['admin', 'coordinador_general', 'coordinador'], {
  message: 'Acceso denegado',
  message2: 'Solo un coordinador autorizado puede aprobar inventarios.',
  limit: 'loginOnly',
});

class InventoryWorkflowError extends Error {
  constructor(message, status = 400, code = '') {
    super(message);
    this.name = 'InventoryWorkflowError';
    this.status = status;
    this.code = code;
  }
}

function getUserRoles(req) {
  return normalizeRoles(req.session?.user?.roles || req.session?.user?.tipo);
}

function getUserDocument(req) {
  return String(req.session?.user?.documento || '').trim();
}

function getUserName(req) {
  return String(req.session?.user?.nombre || req.session?.user?.name || '').trim();
}

function isAdmin(req) {
  return getUserRoles(req).some((role) => role === 'admin' || role === 'administrador');
}

function isGlobalInventoryViewer(req) {
  return getUserRoles(req).some(
    (role) =>
      role === 'admin' ||
      role === 'administrador' ||
      role === 'coordinador_general' ||
      role === 'coordinador general'
  );
}

function isLaboratorista(req) {
  return getUserRoles(req).some((role) =>
    ['laboratorista', 'laboratorista_ud', 'laboratorista_ual'].includes(role)
  );
}

function isCoordinator(req) {
  return getUserRoles(req).some((role) =>
    ['coordinador', 'coordinador_facultad', 'coordinador de facultad'].includes(role)
  );
}

function parsePositiveId(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function safeFileName(value) {
  return path.basename(String(value || 'inventario.xlsx')).slice(0, 255);
}

function getRedirectUrl(pathname, params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  });
  const suffix = query.toString();
  return suffix ? `${pathname}?${suffix}` : pathname;
}

function addRowError(row, message) {
  if (!row.errores.includes(message)) row.errores.push(message);
  row.estado = 'fallida';
}

function getRowIdentifiers(row) {
  const values = [
    row.payload?.placa,
    ...(row.payload?.identificadores || []).map((identifier) => identifier.valor),
  ];
  return Array.from(new Set(values.map(normalizeIdentifier).filter(Boolean)));
}

async function withTransaction(work) {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error revirtiendo una operación de inventario:', rollbackError);
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

async function addInventoryAudit(client, req, entry) {
  await client.query(
    `
      INSERT INTO inventario_auditoria (
        carga_id,
        inventario_id,
        ual_id,
        actor_documento,
        actor_rol,
        accion,
        detalle
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    `,
    [
      entry.cargaId || null,
      entry.inventarioId || null,
      entry.ualId || null,
      getUserDocument(req) || null,
      getUserRoles(req)[0] || 'desconocido',
      entry.action,
      JSON.stringify(entry.detail || {}),
    ]
  );
}

async function addGeneralLog(client, req, action, person) {
  const document = getUserDocument(req);
  await client.query(
    `
      INSERT INTO log (nombre, documento, accion, persona)
      VALUES (
        $1,
        CASE
          WHEN $2 ~ '^[0-9]{1,16}$' THEN $2::numeric
          ELSE NULL
        END,
        $3,
        $4
      )
    `,
    [getUserRoles(req)[0] || 'desconocido', document, action.slice(0, 500), person || '-']
  );
}

async function hasLaboratoryAccess(client, req, ualId, { editorsOnly = false } = {}) {
  const globalViewer = isGlobalInventoryViewer(req);
  const laboratorista = isLaboratorista(req);
  const coordinator = isCoordinator(req) && !editorsOnly;
  const result = await client.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM ual u
        WHERE u.ual_id = $1
          AND u.activo = TRUE
          AND (
            $2::boolean
            OR (
              $3::boolean
              AND EXISTS (
                SELECT 1
                FROM laboratorista_ual lu
                WHERE lu.ual_id = u.ual_id
                  AND lu.laboratorista_documento_id = $4
                  AND lu.activo = TRUE
              )
            )
            OR (
              $5::boolean
              AND EXISTS (
                SELECT 1
                FROM coordinador_facultad_alcance ca
                JOIN coordinador c
                  ON c.documento = ca.coordinador_documento_id
                 AND c.activo = TRUE
                WHERE ca.facultad_id = u.facultad_id
                  AND ca.coordinador_documento_id = $4
                  AND ca.activo = TRUE
              )
            )
          )
      ) AS permitido
    `,
    [ualId, globalViewer, laboratorista, getUserDocument(req), coordinator]
  );
  return Boolean(result.rows[0]?.permitido);
}

async function getAccessibleLaboratories(client, req) {
  const result = await client.query(
    `
      SELECT DISTINCT
        u.ual_id,
        u.nombre,
        facultad.nombre AS facultad,
        CASE WHEN df.padre_id IS NOT NULL THEN df.nombre END AS dependencia
      FROM ual u
      JOIN dependencia_facultad df
        ON df.dependencia_facultad_id = u.facultad_id
      JOIN dependencia_facultad facultad
        ON facultad.dependencia_facultad_id = COALESCE(df.padre_id, df.dependencia_facultad_id)
      WHERE u.activo = TRUE
        AND (
          $1::boolean
          OR (
            $2::boolean
            AND EXISTS (
              SELECT 1
              FROM laboratorista_ual lu
              WHERE lu.ual_id = u.ual_id
                AND lu.laboratorista_documento_id = $3
                AND lu.activo = TRUE
            )
          )
          OR (
            $4::boolean
            AND EXISTS (
              SELECT 1
              FROM coordinador_facultad_alcance ca
              JOIN coordinador c
                ON c.documento = ca.coordinador_documento_id
               AND c.activo = TRUE
              WHERE ca.facultad_id = u.facultad_id
                AND ca.coordinador_documento_id = $3
                AND ca.activo = TRUE
            )
          )
        )
      ORDER BY u.nombre
    `,
    [isGlobalInventoryViewer(req), isLaboratorista(req), getUserDocument(req), isCoordinator(req)]
  );
  return result.rows;
}

async function getCoordinatorsForLaboratory(client, ualId) {
  const result = await client.query(
    `
      SELECT DISTINCT c.documento, c.nombre
      FROM ual u
      JOIN coordinador_facultad_alcance ca
        ON ca.facultad_id = u.facultad_id
       AND ca.activo = TRUE
      JOIN coordinador c
        ON c.documento = ca.coordinador_documento_id
       AND c.activo = TRUE
      WHERE u.ual_id = $1
        AND u.activo = TRUE
      ORDER BY c.nombre
    `,
    [ualId]
  );
  return result.rows;
}

async function flagExistingIdentifiers(client, rows, ualId) {
  const successfulRows = rows.filter((row) => row.estado === 'exitosa');
  const identifiers = Array.from(new Set(successfulRows.flatMap((row) => getRowIdentifiers(row))));
  if (!identifiers.length) return;

  const result = await client.query(
    `
      SELECT normalized
      FROM (
        SELECT UPPER(REGEXP_REPLACE(placa, '\\s', '', 'g')) AS normalized
        FROM inventario
        WHERE placa IS NOT NULL
          AND estado_aprobacion <> 'rechazado'
        UNION
        SELECT UPPER(REGEXP_REPLACE(serie, '\\s', '', 'g')) AS normalized
        FROM inventario
        WHERE serie IS NOT NULL
          AND estado_aprobacion <> 'rechazado'
        UNION
        SELECT valor_normalizado AS normalized
        FROM inventario_identificador
        WHERE ual_id = $2
          AND activo = TRUE
      ) existentes
      WHERE normalized = ANY($1::text[])
    `,
    [identifiers, ualId]
  );
  const existing = new Set(result.rows.map((row) => row.normalized));

  successfulRows.forEach((row) => {
    if (getRowIdentifiers(row).some((identifier) => existing.has(identifier))) {
      addRowError(row, 'Uno o más identificadores ya están registrados en el inventario.');
    }
  });
}

function addAdditionalIdentifierToRows(rows, columnHeader) {
  const successfulRows = rows.filter((row) => row.estado === 'exitosa');
  const modifiedRows = new Set();
  const fileIdentifiers = new Map();

  successfulRows.forEach((row) => {
    getRowIdentifiers(row).forEach((identifier) => {
      if (!fileIdentifiers.has(identifier)) {
        fileIdentifiers.set(identifier, row.id ?? row.numero_fila);
      }
    });
  });

  successfulRows.forEach((row) => {
    const value = String(row.datos_originales?.[columnHeader] ?? '').trim();
    if (!value) return;

    const valueLength = Array.from(value).length;
    if (valueLength > 255) {
      addRowError(
        row,
        `La nomenclatura adicional de "${columnHeader}" tiene ${valueLength} caracteres; el máximo permitido es 255.`
      );
      modifiedRows.add(row);
      return;
    }

    const normalizedValue = normalizeIdentifier(value);
    const normalizedLength = Array.from(normalizedValue).length;
    if (normalizedLength > 255) {
      addRowError(
        row,
        `La nomenclatura adicional de "${columnHeader}" tiene ${normalizedLength} caracteres al normalizarse; el máximo de inventario_identificador.valor_normalizado es 255.`
      );
      modifiedRows.add(row);
      return;
    }
    if (fileIdentifiers.has(normalizedValue)) {
      const error =
        fileIdentifiers.get(normalizedValue) === (row.id ?? row.numero_fila)
          ? `La nomenclatura adicional de "${columnHeader}" coincide con otro identificador de esta fila.`
          : `La nomenclatura adicional de "${columnHeader}" está repetida en otra fila del archivo.`;
      addRowError(row, error);
      modifiedRows.add(row);
      return;
    }
    fileIdentifiers.set(normalizedValue, row.id ?? row.numero_fila);
    row.payload.identificadores = [
      ...(row.payload.identificadores || []),
      {
        tipo: ADDITIONAL_IDENTIFIER_TYPE,
        etiqueta: columnHeader,
        valor: value,
      },
    ];
    modifiedRows.add(row);
  });

  return modifiedRows;
}

async function getInventoryTypeLock(client, ualId, inventoryType, excludeCargaId = null) {
  const result = await client.query(
    `
      SELECT
        EXISTS (
          SELECT 1
          FROM inventario_estado_laboratorio
          WHERE ual_id = $1
            AND tipo_inventario = $2
            AND estado = 'aprobado'
        ) AS inventario_aprobado,
        EXISTS (
          SELECT 1
          FROM inventario_carga
          WHERE ual_id = $1
            AND tipo_inventario = $2
            AND estado IN ('previsualizada', 'pendiente_aprobacion')
            AND ($3::bigint IS NULL OR id <> $3)
        ) AS carga_pendiente
    `,
    [ualId, inventoryType, excludeCargaId]
  );
  const lock = result.rows[0] || {};
  return {
    inventarioAprobado: Boolean(lock.inventario_aprobado),
    cargaPendiente: Boolean(lock.carga_pendiente),
    bloqueado: Boolean(lock.inventario_aprobado || lock.carga_pendiente),
  };
}

function getManualText(body, field, label, maxLength = 255) {
  const rawValue = body[field];
  if (rawValue === undefined || rawValue === null || rawValue === '') return '';
  if (typeof rawValue !== 'string') {
    throw new InventoryWorkflowError(
      `${label} no tiene un formato válido.`,
      400,
      'invalid_individual_entry'
    );
  }
  const value = rawValue.trim();
  if (value.length > maxLength) {
    throw new InventoryWorkflowError(
      `${label} no puede superar ${maxLength} caracteres.`,
      400,
      'invalid_individual_entry'
    );
  }
  return value;
}

function parseManualBalance(body, quantityField, unitField, grade, location, label) {
  const rawQuantity = getManualText(body, quantityField, `La cantidad de ${label}`, 32);
  const unit = getManualText(body, unitField, `La unidad de ${label}`, 50);
  if (!rawQuantity) {
    if (unit) {
      throw new InventoryWorkflowError(
        `Indica la cantidad de ${label} junto con su unidad.`,
        400,
        'invalid_individual_entry'
      );
    }
    return null;
  }
  if (!/^\d+(?:\.\d{1,3})?$/.test(rawQuantity) || Number(rawQuantity) > 99999999999.999) {
    throw new InventoryWorkflowError(
      `La cantidad de ${label} debe ser un número no negativo con máximo tres decimales.`,
      400,
      'invalid_individual_entry'
    );
  }
  if (!unit) {
    throw new InventoryWorkflowError(
      `Indica la unidad de medida de ${label}.`,
      400,
      'invalid_individual_entry'
    );
  }
  return { grado: grade, ubicacion: location, cantidad: Number(rawQuantity), unidad: unit };
}

function parseIndividualInventory(body, inventoryType) {
  const descripcion = getManualText(body, 'descripcion', 'La descripción', 1000);
  const placa = getManualText(body, 'placa', 'La placa ARKA', 50);
  const serie = getManualText(body, 'serie', 'El serial', 100);
  const marca = getManualText(body, 'marca', 'La marca');
  const modelo = getManualText(body, 'modelo', 'El modelo');
  const proveedor = getManualText(body, 'proveedor', 'El proveedor');
  const observaciones = getManualText(body, 'observaciones', 'Las observaciones', 2000);
  const referencia = getManualText(body, 'referencia', 'La referencia');
  const codigoInterno = getManualText(body, 'codigo_interno', 'El código interno');
  const espacioFisico = getManualText(body, 'espacio_fisico', 'La ubicación', 100);
  if (!descripcion) {
    throw new InventoryWorkflowError(
      'La descripción es obligatoria.',
      400,
      'invalid_individual_entry'
    );
  }
  if (inventoryType === INVENTORY_TYPES.ARKA_EQUIPMENT && !placa) {
    throw new InventoryWorkflowError(
      'La placa oficial de ARKA es obligatoria.',
      400,
      'invalid_individual_entry'
    );
  }
  if (inventoryType === INVENTORY_TYPES.REAGENT && !referencia) {
    throw new InventoryWorkflowError(
      'La referencia del reactivo es obligatoria.',
      400,
      'invalid_individual_entry'
    );
  }

  const identificadores = [];
  if (serie) identificadores.push({ tipo: 'serie', valor: serie });
  [
    ['codigo_interno', codigoInterno],
    ['identificador_id', getManualText(body, 'identificador_id', 'El identificador ID')],
    ['codigo_barras', getManualText(body, 'codigo_barras', 'El código de barras')],
    ['qr', getManualText(body, 'qr', 'El código QR')],
    ['placa_local', getManualText(body, 'placa_local', 'La placa local')],
    ['etiquetado', getManualText(body, 'etiquetado', 'El etiquetado')],
  ].forEach(([tipo, valor]) => {
    if (valor) identificadores.push({ tipo, valor });
  });

  const normalIdentifiers = [
    ...(placa && inventoryType === INVENTORY_TYPES.ARKA_EQUIPMENT ? [placa] : []),
    ...identificadores.map((identifier) => identifier.valor),
  ].map(normalizeIdentifier);
  if (new Set(normalIdentifiers).size !== normalIdentifiers.length) {
    throw new InventoryWorkflowError(
      'No repitas el mismo valor en los identificadores del registro.',
      400,
      'invalid_individual_entry'
    );
  }

  const existencias = [];
  if (inventoryType === INVENTORY_TYPES.COMPLEMENTARY) {
    const balance = parseManualBalance(
      body,
      'cantidad',
      'unidad',
      'NA',
      'EXISTENCIA',
      'inventario complementario'
    );
    if (balance) existencias.push(balance);
  } else if (inventoryType === INVENTORY_TYPES.REAGENT) {
    [
      ['stock_gt', 'unidad_stock_gt', 'GT', 'STOCK', 'stock G.T'],
      ['stock_ra', 'unidad_stock_ra', 'RA', 'STOCK', 'stock R.A'],
      ['circulacion_gt', 'unidad_circulacion_gt', 'GT', 'CIRCULACION', 'circulación G.T'],
      ['circulacion_ra', 'unidad_circulacion_ra', 'RA', 'CIRCULACION', 'circulación R.A'],
    ].forEach(([quantityField, unitField, grade, location, label]) => {
      const balance = parseManualBalance(body, quantityField, unitField, grade, location, label);
      if (balance) existencias.push(balance);
    });
  }

  return {
    descripcion,
    placa: inventoryType === INVENTORY_TYPES.ARKA_EQUIPMENT ? placa : '',
    serie,
    espacioFisico,
    marca,
    modelo,
    proveedor,
    observaciones,
    referencia,
    codigoInterno,
    identificadores,
    existencias,
    modoControl:
      inventoryType === INVENTORY_TYPES.ARKA_EQUIPMENT ||
      (inventoryType === INVENTORY_TYPES.COMPLEMENTARY && !existencias.length && codigoInterno)
        ? 'individual'
        : 'cantidad',
  };
}

async function getManagementContext(client, req, selectedUalId) {
  // TODO: Move historical inventory and unlinked equipment to Conciliaciones ARKA.
  const laboratories = await getAccessibleLaboratories(client, req);
  const selectedLaboratory =
    laboratories.find((laboratory) => laboratory.ual_id === selectedUalId) || null;
  let coordinators = [];
  let inventoryItems = [];
  let statuses = INVENTORY_ALL_TYPES.map((type) => ({
    tipo_inventario: type,
    etiqueta: INVENTORY_LABELS[type],
    estado: type === INVENTORY_TYPES.REAGENT ? 'opcional' : 'pendiente',
    sin_inventario: false,
    elementos_aprobados: 0,
    carga_previsualizada_id: null,
  }));
  let recentLoads = [];

  if (selectedLaboratory) {
    const panel = String(req.query.panel || '');
    const filterType = INVENTORY_ALL_TYPES.includes(panel) ? panel : null;
    coordinators = await getCoordinatorsForLaboratory(client, selectedLaboratory.ual_id);
    const [statusResult, pendingResult, countResult, itemResult, loadResult] = await Promise.all([
      client.query(
        `
          SELECT tipo_inventario, estado, sin_inventario
          FROM inventario_estado_laboratorio
          WHERE ual_id = $1
        `,
        [selectedLaboratory.ual_id]
      ),
      client.query(
        `
          SELECT DISTINCT ON (tipo_inventario, estado)
            id, tipo_inventario, estado, creada_por_documento
          FROM inventario_carga
          WHERE ual_id = $1
            AND estado IN ('previsualizada', 'pendiente_aprobacion')
          ORDER BY tipo_inventario, estado, fecha_creacion DESC, id DESC
        `,
        [selectedLaboratory.ual_id]
      ),
      client.query(
        `
          SELECT tipo_inventario, COUNT(*)::int AS elementos_aprobados
          FROM inventario
          WHERE laboratorio_ual_id = $1
            AND tipo_inventario <> 'legado'
            AND estado_aprobacion = 'aprobado'
          GROUP BY tipo_inventario
        `,
        [selectedLaboratory.ual_id]
      ),
      filterType
        ? client.query(
            `
          SELECT
            i.id,
            i.tipo_inventario,
            i.nombre_bien AS descripcion,
            i.placa,
            i.serie,
            i.estado_aprobacion,
            i.modo_control,
            i.atributos,
            COALESCE((
              SELECT json_agg(json_build_object(
                                'tipo', ii.tipo,
                                'etiqueta', ii.etiqueta,
                                'valor', ii.valor
                              )
                              ORDER BY ii.tipo, ii.valor)
              FROM inventario_identificador ii
              WHERE ii.inventario_id = i.id
                AND ii.activo = TRUE
                AND ii.tipo <> 'placa_arka'
            ), '[]'::json) AS identificadores,
            COALESCE((
              SELECT json_agg(json_build_object(
                'grado', ie.grado,
                'ubicacion', ie.ubicacion,
                'cantidad', ie.cantidad,
                'unidad', ie.unidad
              ) ORDER BY ie.grado, ie.ubicacion)
              FROM inventario_existencia ie
              WHERE ie.inventario_id = i.id
            ), '[]'::json) AS existencias
          FROM inventario i
          WHERE i.laboratorio_ual_id = $1
            AND i.tipo_inventario <> 'legado'
            AND ($2::text IS NULL OR i.tipo_inventario = $2)
          ORDER BY i.fecha_creacion DESC NULLS LAST, i.id DESC
          LIMIT 500
        `,
            [selectedLaboratory.ual_id, filterType]
          )
        : Promise.resolve({ rows: [] }),
      client.query(
        `
          SELECT
            c.id,
            c.tipo_inventario,
            c.estado,
            c.archivo_nombre,
            c.creada_por_documento,
            c.fecha_creacion,
            c.total_filas,
            c.filas_exitosas,
            c.filas_fallidas,
            c.declaracion_sin_inventario,
            (
              SELECT f.datos_originales
              FROM inventario_carga_fila f
              WHERE f.carga_id = c.id
              ORDER BY f.numero_fila
              LIMIT 1
            ) AS primera_fila_original
          FROM inventario_carga c
          WHERE c.ual_id = $1
          ORDER BY c.fecha_creacion DESC
          LIMIT 10
        `,
        [selectedLaboratory.ual_id]
      ),
    ]);
    const statusByType = new Map(
      statusResult.rows.map((status) => [status.tipo_inventario, status])
    );
    const activeLoadsByType = new Map();
    pendingResult.rows.forEach((load) => {
      const activeLoads = activeLoadsByType.get(load.tipo_inventario) || {
        cargasPendientes: 0,
        cargaPrevisualizada: null,
      };
      if (load.estado === 'pendiente_aprobacion') {
        activeLoads.cargasPendientes += 1;
      } else if (!activeLoads.cargaPrevisualizada) {
        activeLoads.cargaPrevisualizada = load;
      }
      activeLoadsByType.set(load.tipo_inventario, activeLoads);
    });
    const countByType = new Map(
      countResult.rows.map((status) => [status.tipo_inventario, status.elementos_aprobados])
    );
    statuses = statuses.map((status) => {
      const savedStatus = statusByType.get(status.tipo_inventario);
      const activeLoads = activeLoadsByType.get(status.tipo_inventario) || {};
      const hasPendingApproval =
        activeLoads.cargasPendientes > 0 || savedStatus?.estado === 'pendiente_aprobacion';
      const hasPendingPreview = Boolean(activeLoads.cargaPrevisualizada);
      return {
        ...status,
        estado: hasPendingApproval
          ? 'pendiente_aprobacion'
          : hasPendingPreview
            ? 'previsualizada'
            : savedStatus?.estado || status.estado,
        sin_inventario: savedStatus?.sin_inventario || false,
        elementos_aprobados: countByType.get(status.tipo_inventario) || 0,
        carga_previsualizada_id: activeLoads.cargaPrevisualizada?.id || null,
        bloqueado: hasPendingPreview || hasPendingApproval || savedStatus?.estado === 'aprobado',
      };
    });
    inventoryItems = itemResult.rows;
    recentLoads = loadResult.rows.map((load) => {
      const firstRowOriginal = load.primera_fila_original || {};
      return {
        ...load,
        puedeConfirmar:
          load.estado === 'previsualizada' &&
          !load.declaracion_sin_inventario &&
          (isAdmin(req) ||
            (isLaboratorista(req) && load.creada_por_documento === getUserDocument(req))),
        additionalIdentifierHeaders:
          load.tipo_inventario === INVENTORY_TYPES.ARKA_EQUIPMENT
            ? getAdditionalIdentifierHeaders(Object.keys(firstRowOriginal))
            : [],
      };
    });
  }

  return {
    laboratories,
    selectedLaboratory,
    coordinators,
    inventoryItems,
    statuses,
    recentLoads,
  };
}

function managementViewData(req, context, messages = {}) {
  const requestedPanel = String(req.query.panel || '');
  const panel =
    INVENTORY_ALL_TYPES.includes(requestedPanel) || requestedPanel === 'recent'
      ? requestedPanel
      : '';
  const selectedType = INVENTORY_ALL_TYPES.includes(panel) ? panel : '';
  return {
    ...context,
    panel,
    selectedType,
    successMessage: messages.success || String(req.query.success || ''),
    errorMessage: messages.error || String(req.query.error || ''),
    inventoryLabels: INVENTORY_LABELS,
    isEditor: isAdmin(req) || isLaboratorista(req),
    isInventoryMaintainer: isAdmin(req) || isCoordinator(req),
    isAdmin: isAdmin(req),
    isGlobalInventoryViewer: isGlobalInventoryViewer(req),
  };
}

function renderWorkflowError(res, error) {
  if (error instanceof InventoryWorkflowError || error instanceof InventoryImportError) {
    const status = error.status || 400;
    return res.status(status).render('home/message_error', {
      status,
      message: 'No fue posible completar la operación',
      message2: error.message,
      limit: 'loginOnly',
    });
  }
  return null;
}

async function fetchBatchForViewer(client, req, cargaId) {
  const result = await client.query(
    `
      SELECT c.*, u.nombre AS laboratorio_nombre
      FROM inventario_carga c
      JOIN ual u ON u.ual_id = c.ual_id
      WHERE c.id = $1
    `,
    [cargaId]
  );
  const batch = result.rows[0];
  if (!batch) throw new InventoryWorkflowError('La carga no existe.', 404);
  if (!(await hasLaboratoryAccess(client, req, batch.ual_id))) {
    throw new InventoryWorkflowError('El laboratorio no está asignado a tu usuario.', 403);
  }
  return batch;
}

async function fetchBatchRows(client, cargaId) {
  const result = await client.query(
    `
      SELECT numero_fila, estado, payload, datos_originales, errores
      FROM inventario_carga_fila
      WHERE carga_id = $1
      ORDER BY numero_fila
    `,
    [cargaId]
  );
  return result.rows;
}

async function renderPreviewPage(req, res, batch, rows, messages = {}) {
  const [coordinators, laboratoryResult] = await Promise.all([
    getCoordinatorsForLaboratory(pool, batch.ual_id),
    pool.query('SELECT nombre FROM ual WHERE ual_id = $1', [batch.ual_id]),
  ]);
  const originalHeaders = Object.keys(rows[0]?.datosOriginales || rows[0]?.datos_originales || {});
  const viewRows = rows.map((row) => ({
    numeroFila: row.numeroFila ?? row.numero_fila,
    estado: row.estado,
    payload: row.payload,
    errores: row.errores,
  }));
  return res.render('home/inventarios/gestion_inventario/preview', {
    batch: { ...batch, laboratorio_nombre: laboratoryResult.rows[0]?.nombre },
    rows: viewRows,
    additionalIdentifierHeaders:
      batch.tipo_inventario === INVENTORY_TYPES.ARKA_EQUIPMENT
        ? getAdditionalIdentifierHeaders(originalHeaders)
        : [],
    coordinators,
    successMessage: messages.success || '',
    errorMessage: messages.error || '',
    inventoryLabels: INVENTORY_LABELS,
    canConfirm:
      (isAdmin(req) || isLaboratorista(req)) &&
      (isAdmin(req) || batch.creada_por_documento === getUserDocument(req)),
  });
}

function handleSpreadsheetUpload(req, res, next) {
  upload.single('archivo')(req, res, (error) => {
    if (!error) return next();
    const message =
      error.code === 'LIMIT_FILE_SIZE'
        ? 'El archivo supera el límite de 10 MB.'
        : 'No fue posible recibir el archivo; selecciona un solo archivo Excel.';
    return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).render('home/message_error', {
      status: error.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
      message: 'Archivo no válido',
      message2: message,
      limit: 'loginOnly',
    });
  });
}

router.get('/', requireInventoryAccess, function (req, res) {
  return res.redirect('/milab/inventarios/gestion_inventario');
});

router.get('/gestion_inventario', requireInventoryAccess, async function (req, res, next) {
  try {
    const selectedUalId = parsePositiveId(req.query.ual_id);
    const context = await getManagementContext(pool, req, selectedUalId);
    if (selectedUalId && !context.selectedLaboratory) {
      return res.status(403).render('home/message_error', {
        message: 'Acceso denegado',
        message2: 'No tienes acceso al laboratorio seleccionado.',
        limit: 'loginOnly',
      });
    }
    return res.render(
      'home/inventarios/gestion_inventario/index',
      managementViewData(req, context)
    );
  } catch (error) {
    if (error.code === '42P01' || error.code === '42703') {
      return res.status(503).render('home/message_error', {
        message: 'Módulo de inventarios sin instalar',
        message2:
          'Ejecuta sql-scripts/db_structure_inventarios.sql y sql-scripts/db_seed_inventarios.sql para habilitar el módulo.',
        limit: 'loginOnly',
      });
    }
    console.error('Error cargando gestión de inventarios:', error);
    return next(error);
  }
});

router.post(
  '/cargas/previsualizar',
  requireInventoryEditor,
  handleSpreadsheetUpload,
  verifyUploadCsrfToken,
  async function (req, res, next) {
    const ualId = parsePositiveId(req.body.ual_id);
    const inventoryType = String(req.body.tipo_inventario || '');
    if (!ualId || !INVENTORY_ALL_TYPES.includes(inventoryType)) {
      return res.redirect(
        getRedirectUrl('/milab/inventarios/gestion_inventario', {
          error: 'Selecciona un laboratorio y un tipo de inventario válidos.',
        })
      );
    }
    if (!req.file) {
      return res.redirect(
        getRedirectUrl('/milab/inventarios/gestion_inventario', {
          ual_id: ualId,
          panel: inventoryType,
          error: 'Selecciona un archivo .xls o .xlsx.',
        })
      );
    }

    try {
      if (!getUserDocument(req)) {
        throw new InventoryWorkflowError(
          'Tu sesión no tiene un documento de usuario válido para registrar la carga.',
          400
        );
      }
      if (!(await hasLaboratoryAccess(pool, req, ualId, { editorsOnly: true }))) {
        throw new InventoryWorkflowError('El laboratorio no está asignado a tu usuario.', 403);
      }
      if ((await getInventoryTypeLock(pool, ualId, inventoryType)).bloqueado) {
        throw new InventoryWorkflowError(
          'Ya existe una carga pendiente para este inventario o el inventario está aprobado; no se permiten más cargas hasta que se resuelva.',
          409,
          'inventory_type_locked'
        );
      }
      const parsed = parseWorkbook(req.file.buffer, req.file.originalname);
      let rows = validateInventoryRows(parsed, inventoryType);
      if (!rows.length) {
        throw new InventoryImportError('El archivo no contiene filas para importar.', 'empty_rows');
      }
      if (rows.length > MAX_IMPORT_ROWS) {
        throw new InventoryImportError(
          `El archivo supera el límite de ${MAX_IMPORT_ROWS} filas.`,
          'too_many_rows'
        );
      }
      await flagExistingIdentifiers(pool, rows, ualId);
      const successfulCount = rows.filter((row) => row.estado === 'exitosa').length;
      const failedCount = rows.length - successfulCount;
      const batch = await withTransaction(async (client) => {
        await client.query('SELECT ual_id FROM ual WHERE ual_id = $1 FOR UPDATE', [ualId]);
        if ((await getInventoryTypeLock(client, ualId, inventoryType)).bloqueado) {
          throw new InventoryWorkflowError(
            'Ya existe una carga pendiente para este inventario o el inventario está aprobado; no se permiten más cargas hasta que se resuelva.',
            409,
            'inventory_type_locked'
          );
        }
        const insertedBatch = await client.query(
          `
            INSERT INTO inventario_carga (
              ual_id,
              tipo_inventario,
              archivo_nombre,
              creada_por_documento,
              total_filas,
              filas_exitosas,
              filas_fallidas
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
          `,
          [
            ualId,
            inventoryType,
            safeFileName(req.file.originalname),
            getUserDocument(req),
            rows.length,
            successfulCount,
            failedCount,
          ]
        );
        const savedBatch = insertedBatch.rows[0];
        for (const row of rows) {
          await client.query(
            `
              INSERT INTO inventario_carga_fila (
                carga_id, numero_fila, estado, payload, datos_originales, errores
              )
              VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb)
            `,
            [
              savedBatch.id,
              row.numeroFila,
              row.estado,
              JSON.stringify(row.payload),
              JSON.stringify(row.datosOriginales),
              JSON.stringify(row.errores),
            ]
          );
        }
        await addInventoryAudit(client, req, {
          cargaId: savedBatch.id,
          ualId,
          action: 'carga_previsualizada',
          detail: {
            tipoInventario: inventoryType,
            nombreArchivo: safeFileName(req.file.originalname),
            filasTotales: rows.length,
            filasExitosas: successfulCount,
            filasFallidas: failedCount,
          },
        });
        await addGeneralLog(
          client,
          req,
          `Previsualizó carga de ${INVENTORY_LABELS[inventoryType]} (${successfulCount} filas exitosas, ${failedCount} fallidas).`,
          `Laboratorio ${ualId}`
        );
        return savedBatch;
      });

      return renderPreviewPage(req, res, batch, rows);
    } catch (error) {
      if (error.code === 'inventory_type_locked') {
        return res.redirect(
          getRedirectUrl('/milab/inventarios/gestion_inventario', {
            ual_id: ualId,
            panel: inventoryType,
            error: error.message,
          })
        );
      }
      if (error instanceof InventoryImportError) {
        return res.redirect(
          getRedirectUrl('/milab/inventarios/gestion_inventario', {
            ual_id: ualId,
            panel: inventoryType,
            error: error.message,
          })
        );
      }
      const handled = renderWorkflowError(res, error);
      if (handled) return handled;
      if (error.code === '23505') {
        return res.status(409).render('home/message_error', {
          message: 'Identificador duplicado',
          message2:
            'Uno o más identificadores ya se registraron durante esta carga. Actualiza el archivo e inténtalo nuevamente.',
          limit: 'loginOnly',
        });
      }
      console.error('Error previsualizando una carga de inventario:', error);
      return next(error);
    }
  }
);

router.get('/individual/nuevo', requireInventoryApprover, async function (req, res, next) {
  const ualId = parsePositiveId(req.query.ual_id);
  const inventoryType = String(req.query.tipo_inventario || '');
  if (!isAdmin(req) && !isCoordinator(req)) {
    return res.status(403).render('home/message_error', {
      message: 'Acceso denegado',
      message2:
        'Solo un coordinador autorizado o administrador puede crear registros individuales.',
      limit: 'loginOnly',
    });
  }
  if (!ualId || !INVENTORY_ALL_TYPES.includes(inventoryType)) {
    return res.status(400).render('home/message_error', {
      message: 'Datos inválidos',
      message2: 'Selecciona un laboratorio y un tipo de inventario válidos.',
      limit: 'loginOnly',
    });
  }

  try {
    if (!(await hasLaboratoryAccess(pool, req, ualId))) {
      return res.status(403).render('home/message_error', {
        message: 'Acceso denegado',
        message2: 'No tienes acceso al laboratorio seleccionado.',
        limit: 'loginOnly',
      });
    }
    const [statusResult, laboratoryResult] = await Promise.all([
      pool.query(
        `
            SELECT estado, sin_inventario
            FROM inventario_estado_laboratorio
            WHERE ual_id = $1
              AND tipo_inventario = $2
          `,
        [ualId, inventoryType]
      ),
      pool.query('SELECT nombre FROM ual WHERE ual_id = $1', [ualId]),
    ]);
    const inventoryStatus = statusResult.rows[0];
    if (
      inventoryStatus?.estado !== 'aprobado' ||
      inventoryStatus.sin_inventario ||
      !laboratoryResult.rows[0]
    ) {
      return res.status(409).render('home/message_error', {
        message: 'Inventario no disponible para edición',
        message2:
          'La creación individual se habilita después de aprobar el inventario del laboratorio.',
        limit: 'loginOnly',
      });
    }
    return res.render('home/inventarios/gestion_inventario/individual', {
      ualId,
      laboratoryName: laboratoryResult.rows[0].nombre,
      inventoryType,
      inventoryLabel: INVENTORY_LABELS[inventoryType],
      errorMessage: String(req.query.error || ''),
    });
  } catch (error) {
    console.error('Error cargando el formulario de inventario individual:', error);
    return next(error);
  }
});

router.post('/individual', requireInventoryApprover, async function (req, res, next) {
  const ualId = parsePositiveId(req.body.ual_id);
  const inventoryType = String(req.body.tipo_inventario || '');
  const returnToCreate = (error) =>
    res.redirect(
      getRedirectUrl('/milab/inventarios/individual/nuevo', {
        ual_id: ualId,
        tipo_inventario: inventoryType,
        error,
      })
    );
  if (!isAdmin(req) && !isCoordinator(req)) {
    return res.status(403).render('home/message_error', {
      message: 'Acceso denegado',
      message2:
        'Solo un coordinador autorizado o administrador puede crear registros individuales.',
      limit: 'loginOnly',
    });
  }
  if (!ualId || !INVENTORY_ALL_TYPES.includes(inventoryType)) {
    return res.status(400).render('home/message_error', {
      message: 'Datos inválidos',
      message2: 'Selecciona un laboratorio y un tipo de inventario válidos.',
      limit: 'loginOnly',
    });
  }

  try {
    if (!getUserDocument(req)) {
      throw new InventoryWorkflowError(
        'Tu sesión no tiene un documento de usuario válido para registrar el inventario.',
        400
      );
    }
    const inventory = parseIndividualInventory(req.body, inventoryType);
    await withTransaction(async (client) => {
      await client.query('SELECT ual_id FROM ual WHERE ual_id = $1 FOR UPDATE', [ualId]);
      if (!(await hasLaboratoryAccess(client, req, ualId))) {
        throw new InventoryWorkflowError('No tienes acceso al laboratorio seleccionado.', 403);
      }
      const statusResult = await client.query(
        `
            SELECT estado, sin_inventario
            FROM inventario_estado_laboratorio
            WHERE ual_id = $1
              AND tipo_inventario = $2
            FOR UPDATE
          `,
        [ualId, inventoryType]
      );
      const status = statusResult.rows[0];
      if (status?.estado !== 'aprobado' || status.sin_inventario) {
        throw new InventoryWorkflowError(
          'La creación individual se habilita después de aprobar el inventario del laboratorio.',
          409,
          'inventory_not_approved'
        );
      }

      const validationRow = {
        estado: 'exitosa',
        payload: {
          placa: inventory.placa,
          identificadores: inventory.identificadores,
        },
        errores: [],
      };
      await flagExistingIdentifiers(client, [validationRow], ualId);
      if (validationRow.estado !== 'exitosa') {
        throw new InventoryWorkflowError(
          'Uno o más identificadores ya están registrados en el inventario.',
          409,
          'invalid_individual_entry'
        );
      }

      const laboratoryResult = await client.query(
        `
            SELECT u.nombre AS laboratorio, df.nombre AS dependencia, df.nombre AS facultad
            FROM ual u
            JOIN dependencia_facultad df
              ON df.dependencia_facultad_id = u.facultad_id
            WHERE u.ual_id = $1
          `,
        [ualId]
      );
      const laboratory = laboratoryResult.rows[0];
      if (!laboratory) {
        throw new InventoryWorkflowError('El laboratorio seleccionado ya no está disponible.', 404);
      }

      const inventoryResult = await client.query(
        `
            INSERT INTO inventario (
              serie,
              placa,
              nombre_bien,
              funcionario_doc,
              nombre_funcionario,
              sede,
              dependencia,
              espacio_fisico,
              disponible_prestamo,
              tipo_inventario,
              laboratorio_ual_id,
              estado_aprobacion,
              modo_control,
              atributos,
              carga_id
            )
            VALUES (
              NULLIF($1, ''),
              NULLIF($2, ''),
              $3,
              $4,
              $5,
              NULL,
              $6,
              NULLIF($7, ''),
              $8,
              $9,
              $10,
              'aprobado',
              $11,
              $12::jsonb,
              NULL
            )
            RETURNING id
          `,
        [
          inventory.serie,
          inventory.placa,
          inventory.descripcion,
          getUserDocument(req),
          getUserName(req) || null,
          laboratory.dependencia,
          inventory.espacioFisico,
          inventoryType === INVENTORY_TYPES.ARKA_EQUIPMENT,
          inventoryType,
          ualId,
          inventory.modoControl,
          JSON.stringify({
            marca: inventory.marca,
            modelo: inventory.modelo,
            proveedor: inventory.proveedor,
            observaciones: inventory.observaciones,
            referencia: inventory.referencia,
            codigoInterno: inventory.codigoInterno,
          }),
        ]
      );
      const newInventoryId = inventoryResult.rows[0]?.id;
      if (!newInventoryId) {
        throw new InventoryWorkflowError('No fue posible guardar el registro de inventario.', 409);
      }
      const identifiers = [
        ...(inventory.placa ? [{ tipo: 'placa_arka', valor: inventory.placa }] : []),
        ...inventory.identificadores,
      ];
      for (const identifier of identifiers) {
        const normalized = normalizeIdentifier(identifier.valor);
        await client.query(
          `
              INSERT INTO inventario_identificador (
                inventario_id, ual_id, tipo, valor, valor_normalizado
              )
              VALUES ($1, $2, $3, $4, $5)
            `,
          [newInventoryId, ualId, identifier.tipo, identifier.valor, normalized]
        );
      }
      for (const balance of inventory.existencias) {
        await client.query(
          `
              INSERT INTO inventario_existencia (
                inventario_id, grado, ubicacion, cantidad, unidad
              )
              VALUES ($1, $2, $3, $4, $5)
            `,
          [newInventoryId, balance.grado, balance.ubicacion, balance.cantidad, balance.unidad]
        );
      }
      if (inventoryType === INVENTORY_TYPES.ARKA_EQUIPMENT) {
        const equipmentResult = await client.query(
          `
              INSERT INTO equipo (inventario_id, estado)
              VALUES ($1, 'disponible')
              RETURNING id
            `,
          [newInventoryId]
        );
        if (!equipmentResult.rows[0]?.id) {
          throw new InventoryWorkflowError(
            'No fue posible crear la extensión técnica del equipo.',
            409
          );
        }
      }
      await client.query(
        `
            UPDATE inventario_estado_laboratorio
            SET sin_inventario = FALSE,
                aprobado_por_documento = $3,
                fecha_aprobacion = CURRENT_TIMESTAMP,
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE ual_id = $1
              AND tipo_inventario = $2
          `,
        [ualId, inventoryType, getUserDocument(req)]
      );
      await addInventoryAudit(client, req, {
        inventarioId: newInventoryId,
        ualId,
        action: 'registro_individual_creado_y_aprobado',
        detail: {
          tipoInventario: inventoryType,
          descripcion: inventory.descripcion,
          identificadores: identifiers,
          existencias: inventory.existencias,
        },
      });
      await addGeneralLog(
        client,
        req,
        `Creó un registro individual aprobado de ${INVENTORY_LABELS[inventoryType]}.`,
        `Laboratorio ${ualId}`
      );
      return newInventoryId;
    });
    return res.redirect(
      getRedirectUrl('/milab/inventarios/gestion_inventario', {
        ual_id: ualId,
        panel: inventoryType,
        success: 'El registro fue creado y aprobado correctamente.',
      })
    );
  } catch (error) {
    if (error.code === 'invalid_individual_entry') {
      return returnToCreate(error.message);
    }
    if (error.code === 'inventory_not_approved') {
      return res.redirect(
        getRedirectUrl('/milab/inventarios/gestion_inventario', {
          ual_id: ualId,
          panel: inventoryType,
          error: error.message,
        })
      );
    }
    if (error.code === '23505') {
      return returnToCreate('Uno o más identificadores ya están registrados en el inventario.');
    }
    const handled = renderWorkflowError(res, error);
    if (handled) return handled;
    console.error('Error creando un registro individual de inventario:', error);
    return next(error);
  }
});

router.get('/cargas/:id', requireInventoryAccess, async function (req, res, next) {
  const cargaId = parsePositiveId(req.params.id);
  if (!cargaId) {
    return res.status(404).render('home/message_error', {
      message: 'Carga no encontrada',
      message2: 'El identificador de la carga no es válido.',
      limit: 'loginOnly',
    });
  }
  try {
    const batch = await fetchBatchForViewer(pool, req, cargaId);
    const rows = await fetchBatchRows(pool, cargaId);
    return renderPreviewPage(req, res, batch, rows, {
      error: String(req.query.error || ''),
      success: String(req.query.success || ''),
    });
  } catch (error) {
    const handled = renderWorkflowError(res, error);
    if (handled) return handled;
    console.error('Error consultando una carga de inventario:', error);
    return next(error);
  }
});

router.post('/cargas/:id/cancelar', requireInventoryEditor, async function (req, res, next) {
  const cargaId = parsePositiveId(req.params.id);
  if (!cargaId) {
    return res.status(404).render('home/message_error', {
      message: 'Carga no encontrada',
      message2: 'El identificador de la carga no es válido.',
      limit: 'loginOnly',
    });
  }

  try {
    const batch = await withTransaction(async (client) => {
      const batchResult = await client.query(
        'SELECT * FROM inventario_carga WHERE id = $1 FOR UPDATE',
        [cargaId]
      );
      const currentBatch = batchResult.rows[0];
      if (!currentBatch) throw new InventoryWorkflowError('La carga no existe.', 404);
      if (!isAdmin(req) && currentBatch.creada_por_documento !== getUserDocument(req)) {
        throw new InventoryWorkflowError('No tienes acceso para cancelar esta carga.', 403);
      }
      if (!(await hasLaboratoryAccess(client, req, currentBatch.ual_id, { editorsOnly: true }))) {
        throw new InventoryWorkflowError('El laboratorio no está asignado a tu usuario.', 403);
      }
      if (currentBatch.estado !== 'previsualizada') {
        throw new InventoryWorkflowError(
          'Solo puedes cancelar una carga que aún no se ha enviado al coordinador.',
          409
        );
      }

      await client.query('SELECT ual_id FROM ual WHERE ual_id = $1 FOR UPDATE', [
        currentBatch.ual_id,
      ]);
      const updateResult = await client.query(
        `
          UPDATE inventario_carga
          SET estado = 'cancelada',
              fecha_resolucion = CURRENT_TIMESTAMP
          WHERE id = $1
            AND estado = 'previsualizada'
          RETURNING id
        `,
        [cargaId]
      );
      if (!updateResult.rows.length) {
        throw new InventoryWorkflowError('La carga ya no está disponible para cancelación.', 409);
      }

      await addInventoryAudit(client, req, {
        cargaId,
        ualId: currentBatch.ual_id,
        action: 'carga_cancelada',
        detail: { tipoInventario: currentBatch.tipo_inventario },
      });
      await addGeneralLog(
        client,
        req,
        `Canceló la previsualización de ${INVENTORY_LABELS[currentBatch.tipo_inventario]}.`,
        `Laboratorio ${currentBatch.ual_id}`
      );
      return currentBatch;
    });

    return res.redirect(
      getRedirectUrl('/milab/inventarios/gestion_inventario', {
        ual_id: batch.ual_id,
        panel: batch.tipo_inventario,
        success: 'La previsualización fue cancelada. Ya puedes cargar un archivo nuevo.',
      })
    );
  } catch (error) {
    const handled = renderWorkflowError(res, error);
    if (handled) return handled;
    console.error('Error cancelando una previsualización de inventario:', error);
    return next(error);
  }
});

router.post('/cargas/:id/confirmar', requireInventoryEditor, async function (req, res, next) {
  const cargaId = parsePositiveId(req.params.id);
  const coordinatorDocument = String(req.body.coordinador_documento || '').trim();
  const additionalIdentifierHeader = String(req.body.nomenclatura_adicional_columna || '').trim();
  if (!cargaId || !coordinatorDocument) {
    return res.status(400).render('home/message_error', {
      message: 'No fue posible confirmar la carga',
      message2: 'Selecciona un coordinador autorizado para continuar.',
      limit: 'loginOnly',
    });
  }
  if (req.body.confirmar_revision !== 'confirmo') {
    return res.redirect(
      getRedirectUrl(`/milab/inventarios/cargas/${cargaId}`, {
        error: 'Confirma que revisaste el reporte leído antes de enviarlo al coordinador.',
      })
    );
  }

  try {
    const result = await withTransaction(async (client) => {
      const batchResult = await client.query(
        'SELECT * FROM inventario_carga WHERE id = $1 FOR UPDATE',
        [cargaId]
      );
      const batch = batchResult.rows[0];
      if (!batch) throw new InventoryWorkflowError('La carga no existe.', 404);
      if (!isAdmin(req) && batch.creada_por_documento !== getUserDocument(req)) {
        throw new InventoryWorkflowError('No tienes acceso a esta carga.', 403);
      }
      if (!(await hasLaboratoryAccess(client, req, batch.ual_id, { editorsOnly: true }))) {
        throw new InventoryWorkflowError('El laboratorio no está asignado a tu usuario.', 403);
      }
      if (batch.estado !== 'previsualizada') {
        throw new InventoryWorkflowError('Esta carga ya fue confirmada o resuelta.', 409);
      }
      await client.query('SELECT ual_id FROM ual WHERE ual_id = $1 FOR UPDATE', [batch.ual_id]);
      if (
        (await getInventoryTypeLock(client, batch.ual_id, batch.tipo_inventario, batch.id))
          .bloqueado
      ) {
        throw new InventoryWorkflowError(
          'Este inventario ya fue enviado al coordinador o está aprobado. No se permiten más cargas de este tipo.',
          409,
          'inventory_type_locked'
        );
      }
      const coordinatorResult = await client.query(
        `
            SELECT 1
            FROM ual u
            JOIN coordinador_facultad_alcance ca
              ON ca.facultad_id = u.facultad_id
             AND ca.coordinador_documento_id = $2
             AND ca.activo = TRUE
            JOIN coordinador c
              ON c.documento = ca.coordinador_documento_id
             AND c.activo = TRUE
            WHERE u.ual_id = $1
              AND u.activo = TRUE
            LIMIT 1
          `,
        [batch.ual_id, coordinatorDocument]
      );
      if (!coordinatorResult.rows.length) {
        throw new InventoryWorkflowError(
          'El coordinador seleccionado no está autorizado para este laboratorio.',
          400
        );
      }

      let rowsResult;
      let totalRows = Number(batch.total_filas) || 0;
      if (additionalIdentifierHeader) {
        if (batch.tipo_inventario !== INVENTORY_TYPES.ARKA_EQUIPMENT) {
          throw new InventoryWorkflowError(
            'La nomenclatura adicional solo está disponible para el Inventario de Equipos.',
            400,
            'invalid_additional_identifier_column'
          );
        }

        const allRowsResult = await client.query(
          `
              SELECT *
              FROM inventario_carga_fila
              WHERE carga_id = $1
              ORDER BY numero_fila
              FOR UPDATE
            `,
          [cargaId]
        );
        const allRows = allRowsResult.rows;
        const availableHeaders = getAdditionalIdentifierHeaders(
          Object.keys(allRows[0]?.datos_originales || {})
        );
        if (!availableHeaders.includes(additionalIdentifierHeader)) {
          throw new InventoryWorkflowError(
            'La columna seleccionada no corresponde a un encabezado adicional del archivo.',
            400,
            'invalid_additional_identifier_column'
          );
        }

        const modifiedRows = addAdditionalIdentifierToRows(allRows, additionalIdentifierHeader);
        const rowsWithAdditionalIdentifier = allRows.filter(
          (row) =>
            row.estado === 'exitosa' &&
            row.payload.identificadores?.some(
              (identifier) => identifier.tipo === ADDITIONAL_IDENTIFIER_TYPE
            )
        );
        if (rowsWithAdditionalIdentifier.length) {
          await flagExistingIdentifiers(client, rowsWithAdditionalIdentifier, batch.ual_id);
        }

        const successfulRows = allRows.filter((row) => row.estado === 'exitosa');
        if (!successfulRows.length && !batch.declaracion_sin_inventario) {
          return { noSuccessfulRows: true, batch, rows: allRows };
        }

        for (const row of modifiedRows) {
          await client.query(
            `
                UPDATE inventario_carga_fila
                SET estado = $2,
                    payload = $3::jsonb,
                    errores = $4::jsonb
                WHERE id = $1
              `,
            [row.id, row.estado, JSON.stringify(row.payload), JSON.stringify(row.errores)]
          );
        }
        rowsResult = { rows: successfulRows };
        totalRows = allRows.length;
      } else {
        rowsResult = await client.query(
          `
              SELECT *
              FROM inventario_carga_fila
              WHERE carga_id = $1
                AND estado = 'exitosa'
              ORDER BY numero_fila
              FOR UPDATE
            `,
          [cargaId]
        );
        totalRows = Math.max(
          totalRows,
          rowsResult.rows.length + (Number(batch.filas_fallidas) || 0)
        );
      }
      if (!rowsResult.rows.length && !batch.declaracion_sin_inventario) {
        throw new InventoryWorkflowError('No hay filas exitosas para enviar a aprobación.', 400);
      }

      const laboratoryResult = await client.query(
        `
            SELECT u.nombre AS laboratorio, df.nombre AS dependencia
            FROM ual u
            JOIN dependencia_facultad df
              ON df.dependencia_facultad_id = u.facultad_id
            WHERE u.ual_id = $1
          `,
        [batch.ual_id]
      );
      const laboratory = laboratoryResult.rows[0];
      for (const row of rowsResult.rows) {
        const payload = row.payload;
        const inventoryResult = await client.query(
          `
              INSERT INTO inventario (
                serie,
                placa,
                nombre_bien,
                funcionario_doc,
                nombre_funcionario,
                sede,
                dependencia,
                espacio_fisico,
                disponible_prestamo,
                tipo_inventario,
                laboratorio_ual_id,
                estado_aprobacion,
                modo_control,
                atributos,
                carga_id
              )
              VALUES (
                NULLIF($1, ''),
                NULLIF($2, ''),
                $3,
                $4,
                $5,
                NULL,
                $6,
                $7,
                FALSE,
                $8,
                $9,
                'pendiente',
                $10,
                $11::jsonb,
                $12
              )
              RETURNING id
            `,
          [
            String(payload.serie || ''),
            String(payload.placa || ''),
            payload.descripcion,
            getUserDocument(req) || null,
            getUserName(req) || null,
            laboratory?.dependencia || null,
            laboratory?.laboratorio || null,
            batch.tipo_inventario,
            batch.ual_id,
            payload.modoControl,
            JSON.stringify({
              ...payload.atributos,
              codigoInterno: payload.codigoInterno,
              marca: payload.marca,
              modelo: payload.modelo,
              proveedor: payload.proveedor,
              observaciones: payload.observaciones,
              referencia: payload.referencia,
            }),
            cargaId,
          ]
        );
        const inventarioId = inventoryResult.rows[0].id;
        const identifiers = [
          ...(payload.placa ? [{ tipo: 'placa_arka', valor: payload.placa }] : []),
          ...(payload.identificadores || []),
        ];
        const storedIdentifiers = new Set();
        for (const identifier of identifiers) {
          const normalized = normalizeIdentifier(identifier.valor);
          if (!normalized || storedIdentifiers.has(normalized)) continue;
          storedIdentifiers.add(normalized);
          await client.query(
            `
                INSERT INTO inventario_identificador (
                  inventario_id, ual_id, tipo, valor, valor_normalizado, etiqueta
                )
                VALUES ($1, $2, $3, $4, $5, $6)
              `,
            [
              inventarioId,
              batch.ual_id,
              identifier.tipo,
              identifier.valor,
              normalized,
              identifier.etiqueta || null,
            ]
          );
        }
        for (const balance of payload.existencias || []) {
          await client.query(
            `
                INSERT INTO inventario_existencia (
                  inventario_id, grado, ubicacion, cantidad, unidad
                )
                VALUES ($1, $2, $3, $4, $5)
              `,
            [inventarioId, balance.grado, balance.ubicacion, balance.cantidad, balance.unidad]
          );
        }
        await client.query(
          `
              UPDATE inventario_carga_fila
              SET estado = 'pendiente_aprobacion', inventario_id = $1
              WHERE id = $2
            `,
          [inventarioId, row.id]
        );
        await addInventoryAudit(client, req, {
          cargaId,
          inventarioId,
          ualId: batch.ual_id,
          action: 'registro_creado_pendiente_aprobacion',
          detail: {
            tipoInventario: batch.tipo_inventario,
            numeroFila: row.numero_fila,
            descripcion: payload.descripcion,
            identificadores: identifiers,
          },
        });
      }

      await client.query(
        `
            UPDATE inventario_carga_fila
            SET estado = 'pendiente_aprobacion'
            WHERE carga_id = $1
              AND estado = 'exitosa'
          `,
        [cargaId]
      );
      await client.query(
        `
            UPDATE inventario_carga
            SET estado = 'pendiente_aprobacion',
                coordinador_documento = $1,
                filas_exitosas = $3,
                filas_fallidas = $4,
                fecha_confirmacion = CURRENT_TIMESTAMP
            WHERE id = $2
          `,
        [
          coordinatorDocument,
          cargaId,
          rowsResult.rows.length,
          Math.max(totalRows - rowsResult.rows.length, 0),
        ]
      );
      await addInventoryAudit(client, req, {
        cargaId,
        ualId: batch.ual_id,
        action: 'carga_enviada_a_aprobacion',
        detail: {
          coordinadorDocumento: coordinatorDocument,
          filasEnviadas: rowsResult.rows.length,
          columnaNomenclaturaAdicional: additionalIdentifierHeader || null,
          declaracionSinInventario: batch.declaracion_sin_inventario,
        },
      });
      await addGeneralLog(
        client,
        req,
        `Envió a aprobación una carga de ${INVENTORY_LABELS[batch.tipo_inventario]} con ${rowsResult.rows.length} registros.`,
        `Laboratorio ${batch.ual_id}`
      );
      return { ualId: batch.ual_id };
    });

    if (result.noSuccessfulRows) {
      return renderPreviewPage(req, res, result.batch, result.rows, {
        error:
          'La columna seleccionada produjo errores en todas las filas. Revisa los identificadores o selecciona otra columna.',
      });
    }
    return res.redirect(
      getRedirectUrl('/milab/inventarios/gestion_inventario', {
        ual_id: result.ualId,
        success: 'La carga fue enviada al coordinador para aprobación.',
      })
    );
  } catch (error) {
    if (error.code === 'invalid_additional_identifier_column') {
      return res.redirect(
        getRedirectUrl(`/milab/inventarios/cargas/${cargaId}`, {
          error: error.message,
        })
      );
    }
    if (error.code === 'inventory_type_locked') {
      return res.redirect(
        getRedirectUrl(`/milab/inventarios/cargas/${cargaId}`, {
          error: error.message,
        })
      );
    }
    const handled = renderWorkflowError(res, error);
    if (handled) return handled;
    if (error.code === '23505') {
      return res.status(409).render('home/message_error', {
        message: 'No se pudo confirmar la carga',
        message2:
          'Uno o más identificadores ya fueron registrados. Actualiza el inventario e intenta cargar nuevamente.',
        limit: 'loginOnly',
      });
    }
    console.error('Error confirmando una carga de inventario:', error);
    return next(error);
  }
});

router.post(
  '/declarar-sin-complementarios',
  requireInventoryEditor,
  async function (req, res, next) {
    const ualId = parsePositiveId(req.body.ual_id);
    const coordinatorDocument = String(req.body.coordinador_documento || '').trim();
    if (!ualId || !coordinatorDocument) {
      return res.redirect(
        getRedirectUrl('/milab/inventarios/gestion_inventario', {
          ual_id: ualId,
          panel: INVENTORY_TYPES.COMPLEMENTARY,
          error: 'Selecciona un coordinador autorizado para enviar la declaración.',
        })
      );
    }
    if (req.body.confirmacion_sin_inventario !== 'confirmo') {
      return res.redirect(
        getRedirectUrl('/milab/inventarios/gestion_inventario', {
          ual_id: ualId,
          panel: INVENTORY_TYPES.COMPLEMENTARY,
          error:
            'Marca la casilla para confirmar que el laboratorio no tiene inventario complementario.',
        })
      );
    }

    try {
      if (!getUserDocument(req)) {
        throw new InventoryWorkflowError(
          'Tu sesión no tiene un documento de usuario válido para registrar la declaración.',
          400
        );
      }
      if (!(await hasLaboratoryAccess(pool, req, ualId, { editorsOnly: true }))) {
        throw new InventoryWorkflowError('El laboratorio no está asignado a tu usuario.', 403);
      }
      await withTransaction(async (client) => {
        await client.query('SELECT ual_id FROM ual WHERE ual_id = $1 FOR UPDATE', [ualId]);
        if ((await getInventoryTypeLock(client, ualId, INVENTORY_TYPES.COMPLEMENTARY)).bloqueado) {
          throw new InventoryWorkflowError(
            'El inventario complementario ya fue enviado al coordinador o está aprobado.',
            409,
            'inventory_type_locked'
          );
        }
        const coordinatorResult = await client.query(
          `
            SELECT 1
            FROM ual u
            JOIN coordinador_facultad_alcance ca
              ON ca.facultad_id = u.facultad_id
             AND ca.coordinador_documento_id = $2
             AND ca.activo = TRUE
            JOIN coordinador c
              ON c.documento = ca.coordinador_documento_id
             AND c.activo = TRUE
            WHERE u.ual_id = $1
              AND u.activo = TRUE
            LIMIT 1
          `,
          [ualId, coordinatorDocument]
        );
        if (!coordinatorResult.rows.length) {
          throw new InventoryWorkflowError(
            'El coordinador seleccionado no está autorizado para este laboratorio.',
            400
          );
        }
        const batchResult = await client.query(
          `
            INSERT INTO inventario_carga (
              ual_id,
              tipo_inventario,
              archivo_nombre,
              creada_por_documento,
              coordinador_documento,
              estado,
              declaracion_sin_inventario,
              fecha_confirmacion
            )
            VALUES ($1, $2, 'Declaración sin inventario complementario', $3, $4,
                    'pendiente_aprobacion', TRUE, CURRENT_TIMESTAMP)
            RETURNING id
          `,
          [ualId, INVENTORY_TYPES.COMPLEMENTARY, getUserDocument(req), coordinatorDocument]
        );
        const cargaId = batchResult.rows[0].id;
        await addInventoryAudit(client, req, {
          cargaId,
          ualId,
          action: 'declaracion_sin_inventario_complementario',
          detail: { coordinadorDocumento: coordinatorDocument },
        });
        await addGeneralLog(
          client,
          req,
          'Envió a aprobación la declaración de que el laboratorio no tiene inventario complementario.',
          `Laboratorio ${ualId}`
        );
      });
      return res.redirect(
        getRedirectUrl('/milab/inventarios/gestion_inventario', {
          ual_id: ualId,
          success: 'La declaración fue enviada al coordinador para aprobación.',
        })
      );
    } catch (error) {
      if (error.code === 'inventory_type_locked') {
        return res.redirect(
          getRedirectUrl('/milab/inventarios/gestion_inventario', {
            ual_id: ualId,
            panel: INVENTORY_TYPES.COMPLEMENTARY,
            error: error.message,
          })
        );
      }
      const handled = renderWorkflowError(res, error);
      if (handled) return handled;
      console.error('Error creando declaración de inventario complementario:', error);
      return next(error);
    }
  }
);

router.get('/aprobaciones', requireInventoryApprover, async function (req, res, next) {
  try {
    const result = await pool.query(
      `
        SELECT
          c.id,
          c.ual_id,
          u.nombre AS laboratorio,
          df.nombre AS dependencia,
          c.tipo_inventario,
          c.archivo_nombre,
          c.estado,
          c.fecha_creacion,
          c.total_filas,
          c.filas_exitosas,
          c.filas_fallidas,
          c.declaracion_sin_inventario,
          c.coordinador_documento
        FROM inventario_carga c
        JOIN ual u ON u.ual_id = c.ual_id
        JOIN dependencia_facultad df
          ON df.dependencia_facultad_id = u.facultad_id
        WHERE c.estado = 'pendiente_aprobacion'
          AND (
            $1::boolean
            OR (
              c.coordinador_documento = $2
              AND EXISTS (
                SELECT 1
                FROM coordinador_facultad_alcance ca
                JOIN coordinador active_coordinator
                  ON active_coordinator.documento = ca.coordinador_documento_id
                 AND active_coordinator.activo = TRUE
                WHERE ca.coordinador_documento_id = $2
                  AND ca.facultad_id = u.facultad_id
                  AND ca.activo = TRUE
              )
            )
          )
        ORDER BY c.fecha_creacion ASC
      `,
      [isGlobalInventoryViewer(req), getUserDocument(req)]
    );
    return res.render('home/inventarios/aprobaciones/index', {
      batches: result.rows,
      inventoryLabels: INVENTORY_LABELS,
      errorMessage: String(req.query.error || ''),
      successMessage: String(req.query.success || ''),
    });
  } catch (error) {
    console.error('Error cargando aprobaciones de inventarios:', error);
    return next(error);
  }
});

router.get('/aprobaciones/:id', requireInventoryApprover, async function (req, res, next) {
  const cargaId = parsePositiveId(req.params.id);
  if (!cargaId) {
    return res.status(404).render('home/message_error', {
      message: 'Carga no encontrada',
      message2: 'El identificador de la carga no es válido.',
      limit: 'loginOnly',
    });
  }
  try {
    const result = await pool.query(
      `
        SELECT
          c.*,
          u.nombre AS laboratorio,
          df.nombre AS dependencia,
          co.nombre AS coordinador_nombre
        FROM inventario_carga c
        JOIN ual u ON u.ual_id = c.ual_id
        JOIN dependencia_facultad df
          ON df.dependencia_facultad_id = u.facultad_id
        LEFT JOIN coordinador co ON co.documento = c.coordinador_documento
        WHERE c.id = $1
          AND (
            $2::boolean
            OR (
              c.coordinador_documento = $3
              AND EXISTS (
                SELECT 1
                FROM coordinador_facultad_alcance ca
                JOIN coordinador active_coordinator
                  ON active_coordinator.documento = ca.coordinador_documento_id
                 AND active_coordinator.activo = TRUE
                WHERE ca.coordinador_documento_id = $3
                  AND ca.facultad_id = u.facultad_id
                  AND ca.activo = TRUE
              )
            )
          )
      `,
      [cargaId, isGlobalInventoryViewer(req), getUserDocument(req)]
    );
    const batch = result.rows[0];
    if (!batch) {
      return res.status(404).render('home/message_error', {
        message: 'Carga no encontrada',
        message2: 'La carga no existe o no tienes permiso para aprobarla.',
        limit: 'loginOnly',
      });
    }
    const rows = await fetchBatchRows(pool, cargaId);
    return res.render('home/inventarios/aprobaciones/detalle', {
      batch,
      rows,
      inventoryLabels: INVENTORY_LABELS,
      canResolve: isAdmin(req) || isCoordinator(req),
      errorMessage: String(req.query.error || ''),
    });
  } catch (error) {
    console.error('Error consultando una aprobación de inventario:', error);
    return next(error);
  }
});

router.post(
  '/aprobaciones/:id/resolver',
  requireInventoryApprover,
  async function (req, res, next) {
    const cargaId = parsePositiveId(req.params.id);
    const decision = String(req.body.decision || '');
    const comentario = String(req.body.comentario || '')
      .trim()
      .slice(0, 2000);
    if (!cargaId || !['aprobar', 'rechazar'].includes(decision)) {
      return res.status(400).render('home/message_error', {
        message: 'Decisión inválida',
        message2: 'Selecciona aprobar o rechazar la carga.',
        limit: 'loginOnly',
      });
    }

    try {
      await withTransaction(async (client) => {
        const result = await client.query(
          `
            SELECT
              c.*,
              u.nombre AS laboratorio,
              u.facultad_id,
              df.nombre AS facultad
            FROM inventario_carga c
            JOIN ual u ON u.ual_id = c.ual_id
            JOIN dependencia_facultad df
              ON df.dependencia_facultad_id = u.facultad_id
            WHERE c.id = $1
            FOR UPDATE OF c
          `,
          [cargaId]
        );
        const batch = result.rows[0];
        if (!batch) throw new InventoryWorkflowError('La carga no existe.', 404);
        if (batch.estado !== 'pendiente_aprobacion') {
          throw new InventoryWorkflowError('Esta carga ya fue resuelta.', 409);
        }
        if (!isAdmin(req)) {
          if (batch.coordinador_documento !== getUserDocument(req)) {
            throw new InventoryWorkflowError('La carga está asignada a otro coordinador.', 403);
          }
          const accessResult = await client.query(
            `
              SELECT 1
              FROM coordinador_facultad_alcance
              WHERE coordinador_documento_id = $1
                AND facultad_id = $2
                AND activo = TRUE
                AND EXISTS (
                  SELECT 1
                  FROM coordinador
                  WHERE documento = $1
                    AND activo = TRUE
                )
              LIMIT 1
            `,
            [getUserDocument(req), batch.facultad_id]
          );
          if (!accessResult.rows.length) {
            throw new InventoryWorkflowError(
              'No tienes autorización para aprobar inventarios de este laboratorio.',
              403
            );
          }
        }

        const approved = decision === 'aprobar';
        const rowsResult = await client.query(
          `
            SELECT
              f.id,
              f.numero_fila,
              f.inventario_id,
              i.placa,
              i.tipo_inventario
            FROM inventario_carga_fila f
            LEFT JOIN inventario i ON i.id = f.inventario_id
            WHERE f.carga_id = $1
              AND f.estado = 'pendiente_aprobacion'
            ORDER BY f.numero_fila
            FOR UPDATE OF f
          `,
          [cargaId]
        );

        if (approved) {
          for (const row of rowsResult.rows) {
            if (!row.inventario_id) continue;
            const inventoryResult = await client.query(
              `
                UPDATE inventario
                SET estado_aprobacion = 'aprobado',
                    disponible_prestamo = CASE
                      WHEN tipo_inventario = $2 THEN TRUE
                      ELSE disponible_prestamo
                    END,
                    fecha_modificacion = CURRENT_TIMESTAMP
                WHERE id = $1
                RETURNING id, tipo_inventario, placa, nombre_bien, atributos, espacio_fisico
              `,
              [row.inventario_id, INVENTORY_TYPES.ARKA_EQUIPMENT]
            );
            const inventory = inventoryResult.rows[0];
            if (!inventory) {
              throw new InventoryWorkflowError(
                'No se encontró el registro de inventario pendiente de esta fila.',
                409
              );
            }
            if (inventory.tipo_inventario === INVENTORY_TYPES.ARKA_EQUIPMENT) {
              const equipmentResult = await client.query(
                'SELECT id FROM equipo WHERE inventario_id = $1 FOR UPDATE',
                [inventory.id]
              );
              let equipmentId;
              if (equipmentResult.rows.length) {
                equipmentId = equipmentResult.rows[0].id;
              } else {
                const insertedEquipment = await client.query(
                  `
                    INSERT INTO equipo (inventario_id, estado)
                    VALUES ($1, 'disponible')
                    RETURNING id
                  `,
                  [inventory.id]
                );
                equipmentId = insertedEquipment.rows[0]?.id;
                if (!equipmentId) {
                  throw new InventoryWorkflowError(
                    'No fue posible crear la extensión técnica del equipo aprobado.',
                    409
                  );
                }
              }
              await addInventoryAudit(client, req, {
                cargaId,
                inventarioId: inventory.id,
                ualId: batch.ual_id,
                action: 'equipo_tecnico_asociado',
                detail: { equipoId: equipmentId, codigo: inventory.placa },
              });
            }
            await client.query(
              `
                UPDATE inventario_carga_fila
                SET estado = 'aprobada'
                WHERE id = $1
              `,
              [row.id]
            );
            await addInventoryAudit(client, req, {
              cargaId,
              inventarioId: row.inventario_id,
              ualId: batch.ual_id,
              action: 'registro_aprobado',
              detail: {
                numeroFila: row.numero_fila,
                comentario,
                prestamoHabilitado: inventory.tipo_inventario === INVENTORY_TYPES.ARKA_EQUIPMENT,
              },
            });
          }
        } else {
          await client.query(
            `
              UPDATE inventario
              SET estado_aprobacion = 'rechazado',
                  fecha_modificacion = CURRENT_TIMESTAMP
              WHERE carga_id = $1
                AND estado_aprobacion = 'pendiente'
            `,
            [cargaId]
          );
          await client.query(
            `
              UPDATE inventario_identificador
              SET activo = FALSE
              WHERE inventario_id IN (
                SELECT id FROM inventario WHERE carga_id = $1
              )
                AND activo = TRUE
            `,
            [cargaId]
          );
          await client.query(
            `
              UPDATE inventario_carga_fila
              SET estado = 'rechazada'
              WHERE carga_id = $1
                AND estado = 'pendiente_aprobacion'
            `,
            [cargaId]
          );
          for (const row of rowsResult.rows) {
            await addInventoryAudit(client, req, {
              cargaId,
              inventarioId: row.inventario_id,
              ualId: batch.ual_id,
              action: 'registro_rechazado',
              detail: { numeroFila: row.numero_fila, comentario },
            });
          }
        }

        await client.query(
          `
            UPDATE inventario_carga
            SET estado = $1,
                fecha_resolucion = CURRENT_TIMESTAMP
            WHERE id = $2
          `,
          [approved ? 'aprobada' : 'rechazada', cargaId]
        );
        await client.query(
          `
            INSERT INTO inventario_estado_laboratorio (
              ual_id,
              tipo_inventario,
              estado,
              sin_inventario,
              carga_id,
              aprobado_por_documento,
              fecha_aprobacion
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (ual_id, tipo_inventario)
            DO UPDATE SET
              estado = CASE
                WHEN EXCLUDED.estado = 'aprobado' THEN 'aprobado'
                WHEN inventario_estado_laboratorio.estado = 'aprobado' THEN 'aprobado'
                ELSE 'rechazado'
              END,
              sin_inventario = CASE
                WHEN EXCLUDED.estado = 'aprobado' THEN EXCLUDED.sin_inventario
                WHEN inventario_estado_laboratorio.estado = 'aprobado'
                  THEN inventario_estado_laboratorio.sin_inventario
                ELSE FALSE
              END,
              carga_id = CASE
                WHEN EXCLUDED.estado = 'aprobado'
                  OR inventario_estado_laboratorio.estado <> 'aprobado'
                  THEN EXCLUDED.carga_id
                ELSE inventario_estado_laboratorio.carga_id
              END,
              aprobado_por_documento = CASE
                WHEN EXCLUDED.estado = 'aprobado' THEN EXCLUDED.aprobado_por_documento
                WHEN inventario_estado_laboratorio.estado = 'aprobado'
                  THEN inventario_estado_laboratorio.aprobado_por_documento
                ELSE NULL
              END,
              fecha_aprobacion = CASE
                WHEN EXCLUDED.estado = 'aprobado' THEN EXCLUDED.fecha_aprobacion
                WHEN inventario_estado_laboratorio.estado = 'aprobado'
                  THEN inventario_estado_laboratorio.fecha_aprobacion
                ELSE NULL
              END,
              fecha_modificacion = CURRENT_TIMESTAMP
          `,
          [
            batch.ual_id,
            batch.tipo_inventario,
            approved ? 'aprobado' : 'rechazado',
            approved && batch.declaracion_sin_inventario,
            cargaId,
            approved ? getUserDocument(req) : null,
            approved ? new Date() : null,
          ]
        );
        await addInventoryAudit(client, req, {
          cargaId,
          ualId: batch.ual_id,
          action: approved ? 'carga_aprobada' : 'carga_rechazada',
          detail: {
            comentario,
            filasResueltas: rowsResult.rows.length,
            coordinadorDocumento: getUserDocument(req),
          },
        });
        await addGeneralLog(
          client,
          req,
          `${approved ? 'Aprobó' : 'Rechazó'} una carga de ${INVENTORY_LABELS[batch.tipo_inventario]} (${rowsResult.rows.length} registros).`,
          `Laboratorio ${batch.ual_id}`
        );
      });
      return res.redirect(
        getRedirectUrl('/milab/inventarios/aprobaciones', {
          success: decision === 'aprobar' ? 'La carga fue aprobada.' : 'La carga fue rechazada.',
        })
      );
    } catch (error) {
      const handled = renderWorkflowError(res, error);
      if (handled) return handled;
      if (error.code === '23505') {
        return res.status(409).render('home/message_error', {
          message: 'No se pudo aprobar el equipo',
          message2:
            'La placa o uno de sus identificadores ya está asociado a otro registro técnico. Revisa y reconcilia el catálogo antes de reintentar.',
          limit: 'loginOnly',
        });
      }
      console.error('Error resolviendo una aprobación de inventario:', error);
      return next(error);
    }
  }
);

module.exports = router;
