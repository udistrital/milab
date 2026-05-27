const express = require('express');
const axios = require('axios');

const pool = require('../../libs/db');
const { requireRoles } = require('../middlewares/auth');

require('dotenv').config();

const router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: true }));

const requireAdminAccess = requireRoles('admin', {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

function normalizeEmail(value) {
  return (value || '').toString().trim().toLowerCase();
}

function normalizeDocument(value) {
  return (value || '').toString().trim();
}

function resolveOatiEmail(payload) {
  return normalizeEmail(
    payload?.correo ||
      payload?.email ||
      payload?.correo_institucional ||
      payload?.email_institucional ||
      payload?.correoInstitucional ||
      payload?.emailInstitucional ||
      ''
  );
}

async function lookupTeacherByDocumento(documento) {
  try {
    const respuesta = await axios.get(
      'https://autenticacion.portaloas.udistrital.edu.co/wso2eiserver/services/' +
        'servicios_academicos_produccion/consultar_estado_docente/' +
        documento
    );

    const docente = respuesta.data?.docentesCollection?.docente?.[0];
    if (!docente) return null;

    return {
      documento,
      nombre: docente.nombre || '',
      correo: resolveOatiEmail(docente),
    };
  } catch {
    return null;
  }
}

async function lookupStudentByDocumento(documento) {
  try {
    const respuesta = await axios.get(
      'https://autenticacion.portaloas.udistrital.edu.co/wso2eiserver/services/' +
        'servicios_academicos_produccion/datos_basicos_activos_cedula/' +
        documento
    );

    const collection = respuesta.data?.datosEstudianteCollection?.datosBasicosEstudiante || [];
    if (!collection.length) return null;

    const item = collection[collection.length - 1];

    return {
      documento,
      nombre: item.nombre || '',
      correo: resolveOatiEmail(item),
    };
  } catch {
    return null;
  }
}

async function lookupAdminByDocumento(documento) {
  const docente = await lookupTeacherByDocumento(documento);
  if (docente) return docente;

  return lookupStudentByDocumento(documento);
}

async function ensureAdminRoleExists() {
  await pool.query("INSERT INTO rol (nombre) VALUES ('admin') ON CONFLICT DO NOTHING");
}

async function ensureUserIdentity({ correo, documento, nombre }) {
  const existing = await pool.query(
    'SELECT id FROM usuario WHERE LOWER(correo) = LOWER($1) OR documento = $2 LIMIT 1',
    [correo, documento]
  );

  if (existing.rows.length) {
    const userId = existing.rows[0].id;
    await pool.query(
      `UPDATE usuario
       SET correo = $1,
           documento = $2,
           nombre = $3,
           fecha_modificacion = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [correo, documento, nombre, userId]
    );
    return userId;
  }

  const inserted = await pool.query(
    'INSERT INTO usuario (correo, documento, nombre) VALUES ($1, $2, $3) RETURNING id',
    [correo, documento, nombre]
  );
  return inserted.rows[0].id;
}

async function ensureAdminRoleAssignment(userId) {
  await pool.query(
    `INSERT INTO usuario_rol (usuario_id, rol_id, activo)
     SELECT $1, id, TRUE FROM rol WHERE nombre = 'admin'
     ON CONFLICT (usuario_id, rol_id) DO UPDATE
     SET activo = TRUE,
       fecha_modificacion = CURRENT_TIMESTAMP`,
    [userId]
  );
}

async function upsertLegacyUsuario({ documento, nombre, correo }) {
  const existing = await pool.query(
    'SELECT documento FROM usuario WHERE documento = $1 OR LOWER(correo) = LOWER($2) LIMIT 1',
    [documento, correo]
  );

  if (existing.rows.length) {
    const existingDocumento = existing.rows[0].documento;
    await pool.query(
      `UPDATE usuario
       SET documento = $1,
           nombre = $2,
           correo = $3
       WHERE documento = $4`,
      [documento, nombre, correo, existingDocumento]
    );
    return;
  }

  await pool.query(
    `INSERT INTO usuario (documento, nombre, correo, estado)
     VALUES ($1, $2, $3, $4)`,
    [documento, nombre, correo, 'ACTIVO']
  );
}

function buildViewContext({
  lookupDocumento = '',
  lookupData = null,
  lookupMessage = null,
  lookupStatus = null,
  error = null,
  success = null,
} = {}) {
  return {
    lookupDocumento,
    lookupData,
    lookupMessage,
    lookupStatus,
    error,
    success,
    formData: {
      nombre: lookupData?.nombre || '',
      correo: lookupData?.correo || '',
      documento: lookupData?.documento || lookupDocumento || '',
    },
  };
}

router.get('/load_info', requireAdminAccess, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const documentoQuery = normalizeDocument(req.query.documento);

  if (!documentoQuery) {
    return res.render('home/admin_add', buildViewContext());
  }

  const lookupData = await lookupAdminByDocumento(documentoQuery);
  if (lookupData) {
    return res.render(
      'home/admin_add',
      buildViewContext({
        lookupDocumento: documentoQuery,
        lookupData,
        lookupMessage: 'Datos precargados desde OATI.',
        lookupStatus: 'success',
      })
    );
  }

  return res.render(
    'home/admin_add',
    buildViewContext({
      lookupDocumento: documentoQuery,
      lookupData: { documento: documentoQuery, nombre: '', correo: '' },
      lookupMessage: 'No se encontró información en OATI. Completa el formulario manualmente.',
      lookupStatus: 'warning',
    })
  );
});

router.post('/', requireAdminAccess, async (req, res) => {
  const documento = normalizeDocument(req.body.documento);
  const nombre = (req.body.nombre || '').trim();
  const correo = normalizeEmail(req.body.correo);

  const baseContext = buildViewContext({
    lookupData: { documento, nombre, correo },
  });

  if (!documento || !nombre || !correo) {
    return res.render('home/admin_add', {
      ...baseContext,
      error: 'Nombre, documento y correo son obligatorios.',
    });
  }

  if (!correo.endsWith('@udistrital.edu.co')) {
    return res.render('home/admin_add', {
      ...baseContext,
      error: 'El correo debe ser institucional (@udistrital.edu.co).',
    });
  }

  try {
    await ensureAdminRoleExists();
    const userId = await ensureUserIdentity({ correo, documento, nombre });
    await ensureAdminRoleAssignment(userId);
    await upsertLegacyUsuario({ documento, nombre, correo });

    return res.render('home/admin_add', {
      ...buildViewContext({ lookupData: { documento, nombre, correo } }),
      success: 'Administrador agregado correctamente.',
    });
  } catch (error) {
    console.error('Error creando admin:', error);
    return res.render('home/admin_add', {
      ...baseContext,
      error: 'No fue posible registrar el administrador.',
    });
  }
});

module.exports = router;
