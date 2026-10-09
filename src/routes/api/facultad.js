const express = require('express');

const pool = require('../../libs/db');
const { normalizeLogDocument } = require('../../libs/account-email');
const { requireRoles } = require('../middlewares/auth');

const router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: false }));

const requireAdminFacultyAccess = requireRoles('admin', {
  message: '¡Acceso denegado!',
  message2: 'No tienes permisos para esta acción',
  limit: 'noSession',
});

function getLogActorDocument(req) {
  return normalizeLogDocument(req.session?.user?.documento);
}

function normalizeUalDescription(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeUalOccupants(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeUalActiveFlag(value) {
  return String(value || '').toLowerCase() === 'on';
}

function normalizeUalShortCode(value) {
  const normalized = String(value || '')
    .trim()
    .toUpperCase();
  return normalized || null;
}

function isValidUalShortCode(value) {
  return /^[A-Z0-9_-]+$/.test(value);
}

const OPTIONAL_UAL_COLUMNS = [
  'codigo_abreviacion',
  'descripcion',
  'sal_id_espacio',
  'sal_ocupantes',
  'activo',
];

const OPTIONAL_UAL_FALLBACKS = {
  codigo_abreviacion: 'NULL::text AS codigo_abreviacion',
  descripcion: 'NULL::text AS descripcion',
  sal_id_espacio: 'NULL::text AS sal_id_espacio',
  sal_ocupantes: 'NULL::text AS sal_ocupantes',
  activo: 'TRUE AS activo',
};

async function resolveExistingUalColumns() {
  const result = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = ANY (current_schemas(true))
       AND table_name = 'ual'
       AND column_name = ANY($1::text[])`,
    [OPTIONAL_UAL_COLUMNS]
  );

  return new Set(result.rows.map((row) => row.column_name));
}

async function fetchUalsByFacultyId(facultadId) {
  const existingColumns = await resolveExistingUalColumns();
  const missingColumns = OPTIONAL_UAL_COLUMNS.filter((column) => !existingColumns.has(column));

  if (missingColumns.length > 0) {
    console.warn(
      `Columnas opcionales ausentes en ual: ${missingColumns.join(', ')}. Aplicando fallback.`
    );
  }

  const selectOptionalColumns = OPTIONAL_UAL_COLUMNS.map((column) =>
    existingColumns.has(column) ? column : OPTIONAL_UAL_FALLBACKS[column]
  ).join(', ');

  const query = `SELECT ual_id, nombre, ${selectOptionalColumns} FROM ual WHERE facultad_id = $1 ORDER BY nombre ASC`;
  return pool.query(query, [facultadId]);
}

function fetchUalLaboratoristas(facultadId) {
  return pool.query(
    `SELECT lu.ual_id,
            l.documento,
            l.nombre,
            l.correo,
            l.activo,
            lu.activo AS asignacion_activa
     FROM laboratorista_ual lu
     JOIN ual u ON u.ual_id = lu.ual_id
     JOIN laboratorista l ON l.documento = lu.laboratorista_documento_id
     WHERE u.facultad_id = $1
     ORDER BY l.nombre ASC`,
    [facultadId]
  );
}

// Incluye los coordinadores heredados de la facultad padre (vista de alcance).
function fetchUnitCoordinadores(facultadId) {
  return pool.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (c.documento)
              c.documento,
              c.nombre,
              c.correo,
              c.activo,
              cfa.activo AS asignacion_activa,
              (cfa.facultad_asignada_id <> cfa.facultad_id) AS heredado,
              fa.nombre AS asignado_en
       FROM coordinador_facultad_alcance cfa
       JOIN coordinador c ON c.documento = cfa.coordinador_documento_id
       JOIN dependencia_facultad fa ON fa.dependencia_facultad_id = cfa.facultad_asignada_id
       WHERE cfa.facultad_id = $1
       ORDER BY c.documento, (cfa.facultad_asignada_id <> cfa.facultad_id) ASC
     ) coordinadores
     ORDER BY heredado ASC, nombre ASC`,
    [facultadId]
  );
}

router.use(requireAdminFacultyAccess);

function parsePositiveId(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function renderFacultyError(res, message, message2) {
  return res.render('home/message_error', { message, message2, limit: null });
}

function buildFacultyRedirect({ padreId = null, facultadId = null } = {}) {
  if (facultadId) return `/milab/api/facultad?facultad_id=${facultadId}`;
  if (padreId) return `/milab/api/facultad?padre_id=${padreId}`;
  return '/milab/api/facultad';
}

async function fetchFacultyHierarchy(client = pool) {
  const result = await client.query(
    `SELECT d.dependencia_facultad_id AS facultad_id,
            d.nombre,
            d.padre_id,
            d.activo,
            (SELECT COUNT(*)::int
             FROM dependencia_facultad h
             WHERE h.padre_id = d.dependencia_facultad_id) AS dependencias_count,
            (SELECT COUNT(*)::int
             FROM ual u
             WHERE u.facultad_id = d.dependencia_facultad_id) AS uals_count
     FROM dependencia_facultad d
     ORDER BY d.nombre ASC`
  );
  return result.rows || [];
}

async function fetchFacultyRow(client, id) {
  const result = await client.query(
    `SELECT dependencia_facultad_id AS facultad_id, nombre, padre_id
     FROM dependencia_facultad
     WHERE dependencia_facultad_id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function countFacultyChildren(client, id) {
  const result = await client.query(
    'SELECT COUNT(*)::int AS c FROM dependencia_facultad WHERE padre_id = $1',
    [id]
  );
  return result.rows[0]?.c || 0;
}

// Solo dos niveles: el padre debe ser una facultad y quien tiene dependencias no puede tener padre.
async function validateParentAssignment(client, { id = null, padreId }) {
  if (!padreId) return null;
  if (id && Number(id) === Number(padreId)) {
    return 'Un registro no puede pertenecer a sí mismo.';
  }

  const padre = await fetchFacultyRow(client, padreId);
  if (!padre) return 'La facultad seleccionada no existe.';
  if (padre.padre_id) {
    return 'Solo puedes asignar como padre una facultad (registro sin padre).';
  }
  if (id && (await countFacultyChildren(client, id)) > 0) {
    return 'Este registro tiene dependencias asociadas y no puede convertirse en dependencia.';
  }
  return null;
}

function isHierarchyViolation(error) {
  return error?.code === '23514' || error?.code === '23503';
}

// Endpoint JSON: UALs de una facultad o dependencia (usado por la SPA sin recarga)
router.get('/ual/json', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { facultad_id: facultadId } = req.query;
  if (!facultadId) return res.status(400).json({ error: 'facultad_id requerido' });

  try {
    const facRes = await pool.query(
      `SELECT dependencia_facultad_id AS facultad_id, nombre, padre_id
       FROM dependencia_facultad
       WHERE dependencia_facultad_id = $1`,
      [facultadId]
    );
    if (facRes.rows.length === 0) return res.status(404).json({ error: 'Facultad no encontrada' });
    const facultad = facRes.rows[0];

    const [ualRes, labRes, coordRes] = await Promise.all([
      fetchUalsByFacultyId(facultadId),
      fetchUalLaboratoristas(facultadId),
      fetchUnitCoordinadores(facultadId),
    ]);

    const labsByUal = new Map();
    for (const lab of labRes.rows) {
      const key = String(lab.ual_id);
      if (!labsByUal.has(key)) labsByUal.set(key, []);
      labsByUal.get(key).push({
        documento: lab.documento,
        nombre: lab.nombre,
        correo: lab.correo,
        activo: lab.activo === true,
        asignacion_activa: lab.asignacion_activa === true,
      });
    }

    const uals = ualRes.rows.map((ual) => ({
      ...ual,
      laboratoristas: labsByUal.get(String(ual.ual_id)) || [],
    }));

    return res.json({ facultad, uals, coordinadores: coordRes.rows });
  } catch (error) {
    console.error('Error en /ual/json:', error);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// Endpoint JSON: dependencias de una facultad
router.get('/dependencias/json', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const padreId = parsePositiveId(req.query.padre_id);
  if (!padreId) return res.status(400).json({ error: 'padre_id requerido' });

  try {
    const hierarchy = await fetchFacultyHierarchy();
    const facultad = hierarchy.find((row) => Number(row.facultad_id) === padreId && !row.padre_id);
    if (!facultad) return res.status(404).json({ error: 'Facultad no encontrada' });
    const dependencias = hierarchy.filter((row) => Number(row.padre_id) === padreId);
    return res.json({ facultad, dependencias });
  } catch (error) {
    console.error('Error en /dependencias/json:', error);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// Página principal: facultades -> dependencias -> UALs (admin solo)
router.get('/', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const facultadId = parsePositiveId(req.query.facultad_id);
  const padreId = parsePositiveId(req.query.padre_id);

  try {
    const hierarchy = await fetchFacultyHierarchy();
    const facultades = hierarchy.filter((row) => !row.padre_id);
    const dependencias = hierarchy.filter((row) => row.padre_id);
    let selectedFacultad = null;
    let uals = [];

    if (facultadId) {
      selectedFacultad = hierarchy.find((row) => Number(row.facultad_id) === facultadId) || null;
      if (selectedFacultad) {
        const ualRes = await fetchUalsByFacultyId(facultadId);
        uals = ualRes.rows;
      }
    }

    const selectedPadreId = selectedFacultad
      ? Number(selectedFacultad.padre_id) || null
      : facultades.some((row) => Number(row.facultad_id) === padreId)
        ? padreId
        : null;

    return res.render('home/facultad', {
      facultades,
      dependencias,
      uals,
      selectedFacultad,
      selectedPadreId,
    });
  } catch (error) {
    console.error('Error cargando facultades/UALs:', error);
    return renderFacultyError(res, 'Error al cargar datos', 'Por favor intenta nuevamente');
  }
});

// Agregar facultad (sin padre) o dependencia (con padre_id)
router.post('/add', async (req, res) => {
  const nombre = String(req.body.nombre || '').trim();
  const padreId = parsePositiveId(req.body.padre_id);
  const tipoRegistro = padreId ? 'dependencia' : 'facultad';
  if (!nombre || nombre.length > 255) {
    return renderFacultyError(
      res,
      'Nombre inválido',
      `Proporcione un nombre de ${tipoRegistro} válido (máximo 255 caracteres)`
    );
  }

  try {
    const parentError = await validateParentAssignment(pool, { padreId });
    if (parentError) {
      return renderFacultyError(res, 'Facultad padre inválida', parentError);
    }

    await pool.query('INSERT INTO dependencia_facultad (nombre, padre_id) VALUES ($1, $2)', [
      nombre,
      padreId,
    ]);
    await pool.query(
      'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
      [req.session.user.tipo, getLogActorDocument(req), `agregar ${tipoRegistro}`, nombre]
    );
    return res.redirect(buildFacultyRedirect({ padreId }));
  } catch (error) {
    console.error(`Error agregando ${tipoRegistro}:`, error);
    if (isHierarchyViolation(error)) {
      return renderFacultyError(res, 'Facultad padre inválida', 'Revisa la facultad seleccionada.');
    }
    return renderFacultyError(res, `Error al agregar ${tipoRegistro}`, 'Inténtalo nuevamente');
  }
});

// Eliminar facultad o dependencia (solo si no tiene dependencias, UALs ni usuarios)
router.post('/eliminar', async (req, res) => {
  const facultadId = parsePositiveId(req.body.facultad_id);
  if (!facultadId) {
    return renderFacultyError(res, 'ID de facultad inválido', 'Verifique la solicitud');
  }

  try {
    const row = await fetchFacultyRow(pool, facultadId);
    if (!row) {
      return renderFacultyError(
        res,
        'Registro no encontrado',
        'La facultad o dependencia no existe.'
      );
    }
    const tipoRegistro = row.padre_id ? 'dependencia' : 'facultad';

    const childrenCount = await countFacultyChildren(pool, facultadId);
    const depUal = await pool.query('SELECT COUNT(*)::int AS c FROM ual WHERE facultad_id = $1', [
      facultadId,
    ]);
    const depLab = await pool.query(
      `SELECT COUNT(DISTINCT lu.laboratorista_documento_id)::int AS c
       FROM laboratorista_ual lu
       JOIN ual u ON u.ual_id = lu.ual_id
       WHERE u.facultad_id = $1`,
      [facultadId]
    );
    const depCoord = await pool.query(
      'SELECT COUNT(*)::int AS c FROM coordinador_facultad WHERE facultad_id = $1',
      [facultadId]
    );

    if (childrenCount > 0) {
      return renderFacultyError(
        res,
        'No se puede eliminar la facultad',
        'Tiene dependencias asociadas. Elimínalas o muévelas a otra facultad primero.'
      );
    }

    if (depUal.rows[0].c > 0 || depLab.rows[0].c > 0 || depCoord.rows[0].c > 0) {
      return renderFacultyError(
        res,
        `No se puede eliminar la ${tipoRegistro}`,
        'Tiene UALs o usuarios asociados. Elimine dependencias primero.'
      );
    }

    await pool.query('DELETE FROM dependencia_facultad WHERE dependencia_facultad_id = $1', [
      facultadId,
    ]);
    await pool.query(
      'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
      [req.session.user.tipo, getLogActorDocument(req), `eliminar ${tipoRegistro}`, row.nombre]
    );
    return res.redirect(buildFacultyRedirect({ padreId: row.padre_id }));
  } catch (error) {
    console.error('Error eliminando facultad:', error);
    return renderFacultyError(res, 'Error al eliminar facultad', 'Inténtalo nuevamente');
  }
});

// Agregar UAL a una facultad
router.post('/ual/add', async (req, res) => {
  const { facultad_id: facultadId } = req.body;
  const { nombre } = req.body;
  const codigoAbreviacion = normalizeUalShortCode(req.body.codigo_abreviacion);
  const descripcion = normalizeUalDescription(req.body.descripcion);
  const salIdEspacio = normalizeUalShortCode(req.body.sal_id_espacio);
  const salOcupantes = normalizeUalOccupants(req.body.sal_ocupantes);
  const activo = normalizeUalActiveFlag(req.body.activo);
  if (!facultadId || !nombre || !nombre.trim()) {
    return res.render('home/message_error', {
      message: 'Datos inválidos',
      message2: 'Proporcione nombre de UAL y facultad válidos',
      limit: null,
    });
  }

  if (codigoAbreviacion) {
    if (codigoAbreviacion.length > 30 || !isValidUalShortCode(codigoAbreviacion)) {
      return res.render('home/message_error', {
        message: 'Código abreviado inválido',
        message2: 'Usa máximo 30 caracteres con letras, números, guion o guion bajo.',
        limit: null,
      });
    }
  }

  if (descripcion && descripcion.length > 255) {
    return res.render('home/message_error', {
      message: 'Descripción inválida',
      message2: 'La descripción de la UAL no puede superar 255 caracteres.',
      limit: null,
    });
  }

  if (salIdEspacio && salIdEspacio.length > 30) {
    return res.render('home/message_error', {
      message: 'ID de espacio inválido',
      message2: 'SAL_ID_ESPACIO no puede superar 30 caracteres.',
      limit: null,
    });
  }

  if (salOcupantes && salOcupantes.length > 30) {
    return res.render('home/message_error', {
      message: 'Ocupantes inválido',
      message2: 'SAL_OCUPANTES no puede superar 30 caracteres.',
      limit: null,
    });
  }

  try {
    await pool.query(
      'INSERT INTO ual (nombre, codigo_abreviacion, descripcion, sal_id_espacio, sal_ocupantes, facultad_id, activo) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [
        nombre.trim(),
        codigoAbreviacion,
        descripcion,
        salIdEspacio,
        salOcupantes,
        facultadId,
        activo,
      ]
    );
    await pool.query(
      'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
      [req.session.user.tipo, getLogActorDocument(req), 'agregar UAL', nombre.trim()]
    );
    return res.redirect(`/milab/api/facultad?facultad_id=${facultadId}`);
  } catch (error) {
    console.error('Error agregando UAL:', error);

    if (
      error?.code === '23505' &&
      String(error?.constraint || '').includes('idx_ual_codigo_abreviacion_unique')
    ) {
      return res.render('home/message_error', {
        message: 'Código abreviado duplicado',
        message2: 'Ya existe una UAL con ese código abreviado.',
        limit: null,
      });
    }

    return res.render('home/message_error', {
      message: 'Error al agregar UAL',
      message2: 'Inténtalo nuevamente',
      limit: null,
    });
  }
});

// Editar UAL (admin o coordinador dentro de su facultad)
router.post('/ual/editar', async (req, res) => {
  const { ual_id: ualId, facultad_id: facultadId, new_facultad_id: newFacultadId } = req.body;
  const { nombre } = req.body;
  const codigoAbreviacion = normalizeUalShortCode(req.body.codigo_abreviacion);
  const descripcion = normalizeUalDescription(req.body.descripcion);
  const salIdEspacio = normalizeUalShortCode(req.body.sal_id_espacio);
  const salOcupantes = normalizeUalOccupants(req.body.sal_ocupantes);
  const activo = normalizeUalActiveFlag(req.body.activo);
  if (!ualId || !nombre || !nombre.trim()) {
    return res.render('home/message_error', {
      message: 'Datos inválidos',
      message2: 'Proporcione un nombre válido para la UAL',
      limit: null,
    });
  }

  if (codigoAbreviacion) {
    if (codigoAbreviacion.length > 30 || !isValidUalShortCode(codigoAbreviacion)) {
      return res.render('home/message_error', {
        message: 'Código abreviado inválido',
        message2: 'Usa máximo 30 caracteres con letras, números, guion o guion bajo.',
        limit: null,
      });
    }
  }

  if (descripcion && descripcion.length > 255) {
    return res.render('home/message_error', {
      message: 'Descripción inválida',
      message2: 'La descripción de la UAL no puede superar 255 caracteres.',
      limit: null,
    });
  }

  if (salIdEspacio && salIdEspacio.length > 30) {
    return res.render('home/message_error', {
      message: 'ID de espacio inválido',
      message2: 'SAL_ID_ESPACIO no puede superar 30 caracteres.',
      limit: null,
    });
  }

  if (salOcupantes && salOcupantes.length > 30) {
    return res.render('home/message_error', {
      message: 'Ocupantes inválido',
      message2: 'SAL_OCUPANTES no puede superar 30 caracteres.',
      limit: null,
    });
  }

  try {
    // Solo admin edita UAL

    const oldRes = await pool.query(
      'SELECT ual.nombre AS ual_nombre, ual.codigo_abreviacion AS ual_codigo_abreviacion, ual.descripcion AS ual_descripcion, ual.sal_id_espacio AS ual_sal_id_espacio, ual.sal_ocupantes AS ual_sal_ocupantes, ual.activo AS ual_activo, ual.facultad_id AS ual_facultad, f.nombre AS facultad_nombre FROM ual JOIN dependencia_facultad f ON f.dependencia_facultad_id = ual.facultad_id WHERE ual_id = $1',
      [ualId]
    );
    const oldRow = oldRes.rows[0] || {
      ual_nombre: '',
      ual_facultad: facultadId,
      facultad_nombre: '',
    };

    // Actualización de nombre y metadatos operativos
    await pool.query(
      'UPDATE ual SET nombre = $1, codigo_abreviacion = $2, descripcion = $3, sal_id_espacio = $4, sal_ocupantes = $5, activo = $6 WHERE ual_id = $7',
      [nombre.trim(), codigoAbreviacion, descripcion, salIdEspacio, salOcupantes, activo, ualId]
    );

    // Si es admin y envía new_facultad_id diferente, mover UAL a otra facultad
    let redirectFacultadId = facultadId;
    let cambioFacultadTexto = '';
    if (
      req.session.user.tipo === 'admin' &&
      newFacultadId &&
      String(newFacultadId) !== String(oldRow.ual_facultad)
    ) {
      // Validar que la facultad destino existe
      const facDestRes = await pool.query(
        'SELECT nombre FROM dependencia_facultad WHERE dependencia_facultad_id = $1',
        [newFacultadId]
      );
      if (facDestRes.rows.length === 0) {
        return res.render('home/message_error', {
          message: 'Facultad destino inválida',
          message2: 'Seleccione una facultad existente',
          limit: null,
        });
      }
      await pool.query('UPDATE ual SET facultad_id = $1 WHERE ual_id = $2', [newFacultadId, ualId]);
      cambioFacultadTexto = ` | facultad: ${oldRow.facultad_nombre} -> ${facDestRes.rows[0].nombre}`;
      redirectFacultadId = newFacultadId;
    }

    await pool.query(
      'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
      [
        req.session.user.tipo,
        getLogActorDocument(req),
        'editar UAL',
        `${oldRow.ual_nombre} -> ${nombre.trim()}${cambioFacultadTexto}`,
      ]
    );
    return res.redirect(`/milab/api/facultad?facultad_id=${redirectFacultadId || ''}`);
  } catch (error) {
    console.error('Error editando UAL:', error);

    if (
      error?.code === '23505' &&
      String(error?.constraint || '').includes('idx_ual_codigo_abreviacion_unique')
    ) {
      return res.render('home/message_error', {
        message: 'Código abreviado duplicado',
        message2: 'Ya existe una UAL con ese código abreviado.',
        limit: null,
      });
    }

    return res.render('home/message_error', {
      message: 'Error al editar UAL',
      message2: 'Inténtalo nuevamente',
      limit: null,
    });
  }
});

// Eliminar UAL (solo si no tiene laboratoristas asociados)
router.post('/ual/eliminar', async (req, res) => {
  const { ual_id: ualId, facultad_id: facultadId } = req.body;
  if (!ualId) {
    return res.render('home/message_error', {
      message: 'ID de UAL inválido',
      message2: 'Verifique la solicitud',
      limit: null,
    });
  }

  try {
    const depLabMulti = await pool.query(
      'SELECT COUNT(*)::int AS c FROM laboratorista_ual WHERE ual_id = $1',
      [ualId]
    );
    const depLabCount = depLabMulti.rows[0]?.c || 0;

    if (depLabCount > 0) {
      return res.render('home/message_error', {
        message: 'No se puede eliminar la UAL',
        message2: 'Tiene laboratoristas asociados. Elimine dependencias primero.',
        limit: null,
      });
    }
    const ualNameRes = await pool.query('SELECT nombre FROM ual WHERE ual_id = $1', [ualId]);
    const ualName = ualNameRes.rows[0] ? ualNameRes.rows[0].nombre : String(ualId);
    await pool.query('DELETE FROM ual WHERE ual_id = $1', [ualId]);
    await pool.query(
      'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
      [req.session.user.tipo, getLogActorDocument(req), 'eliminar UAL', ualName]
    );
    return res.redirect(`/milab/api/facultad?facultad_id=${facultadId || ''}`);
  } catch (error) {
    console.error('Error eliminando UAL:', error);
    return res.render('home/message_error', {
      message: 'Error al eliminar UAL',
      message2: 'Inténtalo nuevamente',
      limit: null,
    });
  }
});

// Editar facultad o dependencia (nombre y facultad padre)
router.post('/editar', async (req, res) => {
  const facultadId = parsePositiveId(req.body.facultad_id);
  const nombre = String(req.body.nombre || '').trim();
  if (!facultadId || !nombre || nombre.length > 255) {
    return renderFacultyError(
      res,
      'Datos inválidos',
      'Proporcione un nombre válido para la facultad (máximo 255 caracteres)'
    );
  }

  try {
    const oldRow = await fetchFacultyRow(pool, facultadId);
    if (!oldRow) {
      return renderFacultyError(
        res,
        'Registro no encontrado',
        'La facultad o dependencia no existe.'
      );
    }

    const changesParent = Object.prototype.hasOwnProperty.call(req.body, 'padre_id');
    const padreId = changesParent ? parsePositiveId(req.body.padre_id) : oldRow.padre_id || null;
    if (changesParent && Number(padreId || 0) !== Number(oldRow.padre_id || 0)) {
      const parentError = await validateParentAssignment(pool, { id: facultadId, padreId });
      if (parentError) {
        return renderFacultyError(res, 'Facultad padre inválida', parentError);
      }
    }

    await pool.query(
      `UPDATE dependencia_facultad
       SET nombre = $1, padre_id = $2, fecha_modificacion = CURRENT_TIMESTAMP
       WHERE dependencia_facultad_id = $3`,
      [nombre, padreId, facultadId]
    );

    let parentChange = '';
    if (Number(padreId || 0) !== Number(oldRow.padre_id || 0)) {
      parentChange = ` | padre: ${oldRow.padre_id || 'ninguno'} -> ${padreId || 'ninguno'}`;
    }
    await pool.query(
      'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
      [
        req.session.user.tipo,
        getLogActorDocument(req),
        padreId ? 'editar dependencia' : 'editar facultad',
        `${oldRow.nombre} -> ${nombre}${parentChange}`,
      ]
    );
    return res.redirect(buildFacultyRedirect({ padreId }));
  } catch (error) {
    console.error('Error editando facultad:', error);
    if (isHierarchyViolation(error)) {
      return renderFacultyError(res, 'Facultad padre inválida', 'Revisa la facultad seleccionada.');
    }
    return renderFacultyError(res, 'Error al editar facultad', 'Inténtalo nuevamente');
  }
});

module.exports = router;
