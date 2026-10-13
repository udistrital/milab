const express = require('express');
const multer = require('multer');
const path = require('node:path');
const pool = require('../../libs/db');
const { normalizeRoles } = require('../../libs/roles');
const { requireRoles } = require('../middlewares/auth');
const {
  INVENTORY_TYPES,
  InventoryImportError,
  normalizeIdentifier,
  parseWorkbook,
  validateInventoryRows,
} = require('../../libs/inventario-import');

const router = express.Router();
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_IMPORT_ROWS = 5000;
const INVENTORY_LABELS = Object.freeze({
  [INVENTORY_TYPES.ARKA_EQUIPMENT]: 'Equipo oficial ARKA',
  [INVENTORY_TYPES.COMPLEMENTARY]: 'Inventario complementario',
  [INVENTORY_TYPES.REAGENT]: 'Reactivos',
});
const INVENTORY_ALL_TYPES = Object.values(INVENTORY_TYPES);
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
  constructor(message, status = 400) {
    super(message);
    this.name = 'InventoryWorkflowError';
    this.status = status;
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

async function getManagementContext(client, req, selectedUalId) {
  const laboratories = await getAccessibleLaboratories(client, req);
  const selectedLaboratory =
    laboratories.find((laboratory) => laboratory.ual_id === selectedUalId) || null;
  let coordinators = [];
  let inventoryItems = [];
  let legacyInventoryItems = [];
  let unlinkedEquipmentItems = [];
  let statuses = INVENTORY_ALL_TYPES.map((type) => ({
    tipo_inventario: type,
    etiqueta: INVENTORY_LABELS[type],
    estado: type === INVENTORY_TYPES.REAGENT ? 'opcional' : 'pendiente',
    sin_inventario: false,
    elementos_aprobados: 0,
  }));
  let recentLoads = [];

  if (isGlobalInventoryViewer(req)) {
    [legacyInventoryItems, unlinkedEquipmentItems] = await Promise.all([
      client
        .query(
          `
          SELECT id, serie, placa, nombre_bien, dependencia, espacio_fisico
          FROM inventario
          WHERE tipo_inventario = 'legado'
          ORDER BY fecha_creacion DESC NULLS LAST, id DESC
          LIMIT 100
        `
        )
        .then((result) => result.rows),
      client
        .query(
          `
          SELECT id, codigo, nombre, categoria, estado, laboratorio, facultad
          FROM equipo
          WHERE inventario_id IS NULL
          ORDER BY fecha_creacion DESC NULLS LAST, id DESC
          LIMIT 100
        `
        )
        .then((result) => result.rows),
    ]);
  }

  if (selectedLaboratory) {
    const filterType = INVENTORY_ALL_TYPES.includes(String(req.query.tipo_inventario || ''))
      ? String(req.query.tipo_inventario)
      : null;
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
          SELECT tipo_inventario, COUNT(*)::int AS cargas_pendientes
          FROM inventario_carga
          WHERE ual_id = $1
            AND estado = 'pendiente_aprobacion'
          GROUP BY tipo_inventario
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
      client.query(
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
              SELECT json_agg(json_build_object('tipo', ii.tipo, 'valor', ii.valor)
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
      ),
      client.query(
        `
          SELECT
            c.id,
            c.tipo_inventario,
            c.estado,
            c.archivo_nombre,
            c.fecha_creacion,
            c.total_filas,
            c.filas_exitosas,
            c.filas_fallidas
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
    const pendingByType = new Map(
      pendingResult.rows.map((status) => [status.tipo_inventario, status.cargas_pendientes])
    );
    const countByType = new Map(
      countResult.rows.map((status) => [status.tipo_inventario, status.elementos_aprobados])
    );
    statuses = statuses.map((status) => {
      const savedStatus = statusByType.get(status.tipo_inventario);
      return {
        ...status,
        estado:
          pendingByType.get(status.tipo_inventario) > 0
            ? 'pendiente_aprobacion'
            : savedStatus?.estado || status.estado,
        sin_inventario: savedStatus?.sin_inventario || false,
        elementos_aprobados: countByType.get(status.tipo_inventario) || 0,
      };
    });
    inventoryItems = itemResult.rows;
    recentLoads = loadResult.rows;
  }

  return {
    laboratories,
    selectedLaboratory,
    coordinators,
    inventoryItems,
    legacyInventoryItems,
    unlinkedEquipmentItems,
    statuses,
    recentLoads,
  };
}

function managementViewData(req, context, messages = {}) {
  return {
    ...context,
    selectedType: INVENTORY_ALL_TYPES.includes(String(req.query.tipo_inventario || ''))
      ? String(req.query.tipo_inventario)
      : '',
    successMessage: messages.success || String(req.query.success || ''),
    errorMessage: messages.error || String(req.query.error || ''),
    inventoryLabels: INVENTORY_LABELS,
    isEditor: isAdmin(req) || isLaboratorista(req),
    isAdmin: isAdmin(req),
    isGlobalInventoryViewer: isGlobalInventoryViewer(req),
  };
}

function renderWorkflowError(res, error) {
  if (error instanceof InventoryWorkflowError || error instanceof InventoryImportError) {
    return res.status(error.status || 400).render('home/message_error', {
      message: 'No fue posible completar la operación',
      message2: error.message,
      limit: 'loginOnly',
    });
  }
  return null;
}

async function fetchBatchForEditor(client, req, cargaId) {
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
  if (!isGlobalInventoryViewer(req) && batch.creada_por_documento !== getUserDocument(req)) {
    throw new InventoryWorkflowError('No tienes acceso a esta carga.', 403);
  }
  if (!(await hasLaboratoryAccess(client, req, batch.ual_id, { editorsOnly: true }))) {
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
  const viewRows = rows.map((row) => ({
    numeroFila: row.numeroFila ?? row.numero_fila,
    estado: row.estado,
    payload: row.payload,
    errores: row.errores,
  }));
  return res.render('home/inventarios/gestion_inventario/preview', {
    batch: { ...batch, laboratorio_nombre: laboratoryResult.rows[0]?.nombre },
    rows: viewRows,
    coordinators,
    successMessage: messages.success || '',
    errorMessage: messages.error || '',
    inventoryLabels: INVENTORY_LABELS,
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

router.get('/cargas/:id', requireInventoryEditor, async function (req, res, next) {
  const cargaId = parsePositiveId(req.params.id);
  if (!cargaId) {
    return res.status(404).render('home/message_error', {
      message: 'Carga no encontrada',
      message2: 'El identificador de la carga no es válido.',
      limit: 'loginOnly',
    });
  }
  try {
    const batch = await fetchBatchForEditor(pool, req, cargaId);
    const rows = await fetchBatchRows(pool, cargaId);
    return renderPreviewPage(req, res, batch, rows);
  } catch (error) {
    const handled = renderWorkflowError(res, error);
    if (handled) return handled;
    console.error('Error consultando una carga de inventario:', error);
    return next(error);
  }
});

router.post('/cargas/:id/confirmar', requireInventoryEditor, async function (req, res, next) {
  const cargaId = parsePositiveId(req.params.id);
  const coordinatorDocument = String(req.body.coordinador_documento || '').trim();
  if (!cargaId || !coordinatorDocument) {
    return res.status(400).render('home/message_error', {
      message: 'No fue posible confirmar la carga',
      message2: 'Selecciona un coordinador autorizado para continuar.',
      limit: 'loginOnly',
    });
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

      const rowsResult = await client.query(
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
                  inventario_id, ual_id, tipo, valor, valor_normalizado
                )
                VALUES ($1, $2, $3, $4, $5)
              `,
            [inventarioId, batch.ual_id, identifier.tipo, identifier.valor, normalized]
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
                fecha_confirmacion = CURRENT_TIMESTAMP
            WHERE id = $2
          `,
        [coordinatorDocument, cargaId]
      );
      await addInventoryAudit(client, req, {
        cargaId,
        ualId: batch.ual_id,
        action: 'carga_enviada_a_aprobacion',
        detail: {
          coordinadorDocumento: coordinatorDocument,
          filasEnviadas: rowsResult.rows.length,
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

    return res.redirect(
      getRedirectUrl('/milab/inventarios/gestion_inventario', {
        ual_id: result.ualId,
        success: 'La carga fue enviada al coordinador para aprobación.',
      })
    );
  } catch (error) {
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
          error: 'Selecciona un coordinador autorizado para enviar la declaración.',
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
        const pendingDeclaration = await client.query(
          `
            SELECT 1
            FROM inventario_carga
            WHERE ual_id = $1
              AND tipo_inventario = $2
              AND estado = 'pendiente_aprobacion'
            LIMIT 1
          `,
          [ualId, INVENTORY_TYPES.COMPLEMENTARY]
        );
        if (pendingDeclaration.rows.length) {
          throw new InventoryWorkflowError(
            'Ya existe una carga complementaria pendiente de aprobación.',
            409
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
              const equipmentDescription = [inventory.atributos?.marca, inventory.atributos?.modelo]
                .filter(Boolean)
                .join(' ');
              const equipmentResult = await client.query(
                'SELECT id, inventario_id FROM equipo WHERE codigo = $1 FOR UPDATE',
                [inventory.placa]
              );
              let equipmentId;
              if (equipmentResult.rows.length) {
                const equipment = equipmentResult.rows[0];
                if (equipment.inventario_id && equipment.inventario_id !== inventory.id) {
                  throw new InventoryWorkflowError(
                    `La placa ${inventory.placa} ya está asociada a otro registro de equipo.`,
                    409
                  );
                }
                equipmentId = equipment.id;
                await client.query(
                  `
                    UPDATE equipo
                    SET inventario_id = $1,
                        nombre = $2,
                        descripcion = NULLIF($3, ''),
                        especificaciones = $4::jsonb,
                        categoria = 'Equipo oficial ARKA',
                        laboratorio = $5,
                        facultad = $6,
                        ubicacion = $7
                    WHERE id = $8
                  `,
                  [
                    inventory.id,
                    inventory.nombre_bien,
                    equipmentDescription,
                    JSON.stringify(inventory.atributos || {}),
                    batch.laboratorio,
                    batch.facultad,
                    inventory.espacio_fisico || '',
                    equipment.id,
                  ]
                );
              } else {
                const insertedEquipment = await client.query(
                  `
                    INSERT INTO equipo (
                      codigo,
                      nombre,
                      descripcion,
                      especificaciones,
                      categoria,
                      laboratorio,
                      facultad,
                      estado,
                      ubicacion,
                      inventario_id
                    )
                    SELECT
                      $1,
                      $2,
                      NULLIF(BTRIM(CONCAT_WS(' ', NULLIF($3, ''), NULLIF($4, ''))), ''),
                      $5::jsonb,
                      'Equipo oficial ARKA',
                      u.nombre,
                      df.nombre,
                      'disponible',
                      $6,
                      $7
                    FROM ual u
                    JOIN dependencia_facultad df
                      ON df.dependencia_facultad_id = u.facultad_id
                    WHERE u.ual_id = $8
                    RETURNING id
                  `,
                  [
                    inventory.placa,
                    inventory.nombre_bien,
                    inventory.atributos?.marca || '',
                    inventory.atributos?.modelo || '',
                    JSON.stringify(inventory.atributos || {}),
                    inventory.espacio_fisico || '',
                    inventory.id,
                    batch.ual_id,
                  ]
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
