const { Router } = require('express');
const passport = require('passport');
const axios = require('axios');
const pool = require('../../libs/db');
const { normalizeRoles } = require('../../libs/roles');
const { buildSessionUser, fetchUserByEmail } = require('../../libs/user-identity');

const router = Router();

function extractMicrosoftEmail(profile) {
  return (
    profile?.emails?.[0]?.value ||
    profile?._json?.mail ||
    profile?._json?.userPrincipalName ||
    profile?._json?.preferred_username ||
    ''
  )
    .toLowerCase()
    .trim();
}

function normalizeEstado(value) {
  return (value || '').toString().trim().toUpperCase();
}

function isActiveTeacherRecord(record) {
  const estado = normalizeEstado(record?.estado_docente || record?.estadoDocente || record?.estado);
  return estado === 'A' || estado === 'ACTIVO';
}

function isActiveStudentRecord(record) {
  const estado = normalizeEstado(record?.estado);
  return estado === 'A';
}

async function lookupTeacherByDocumento(documento) {
  try {
    const respuesta = await axios.get(
      'https://autenticacion.portaloas.udistrital.edu.co/wso2eiserver/services/' +
        'servicios_academicos_produccion/consultar_estado_docente/' +
        documento
    );

    const rawDocentes = respuesta.data?.docentesCollection?.docente;
    const docentes = Array.isArray(rawDocentes) ? rawDocentes : rawDocentes ? [rawDocentes] : [];
    if (!docentes.length) return null;

    return docentes.find((docente) => isActiveTeacherRecord(docente)) || null;
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

    return collection.find((item) => isActiveStudentRecord(item)) || null;
  } catch {
    return null;
  }
}

async function ensureRoleAssignment(userId, roleName) {
  await pool.query(
    `INSERT INTO usuario_roles (usuario_id, role_id)
     SELECT $1, id FROM roles WHERE name = $2
     ON CONFLICT (usuario_id, role_id) DO UPDATE
     SET activo = TRUE,
         updated_at = CURRENT_TIMESTAMP`,
    [userId, roleName]
  );
}

async function ensureOatiRolesForUser(usuario) {
  const currentRoles = normalizeRoles(usuario?.roles || []);
  const rolesToAdd = [];

  if (usuario?.documento && !currentRoles.includes('docente')) {
    const docente = await lookupTeacherByDocumento(usuario.documento);
    if (docente) rolesToAdd.push('docente');
  }

  if (usuario?.documento && !currentRoles.includes('estudiante')) {
    const estudiante = await lookupStudentByDocumento(usuario.documento);
    if (estudiante) rolesToAdd.push('estudiante');
  }

  if (!rolesToAdd.length) return usuario;

  for (const role of rolesToAdd) {
    await ensureRoleAssignment(usuario.id, role);
  }

  return fetchUserByEmail(usuario.correo);
}

function regenerateSession(req) {
  return new Promise((resolve) => {
    if (!req.session) {
      return resolve(false);
    }

    req.session.regenerate((err) => {
      if (err) {
        console.error('Failed to regenerate session after Microsoft login:', err);
        return resolve(false);
      }

      return resolve(true);
    });
  });
}

router.get(
  '/microsoft',
  passport.authenticate('auth-microsoft', {
    prompt: 'select_account',
    state: true,
    session: false,
  })
);

router.get(
  '/microsoft/callback',
  passport.authenticate('auth-microsoft', {
    failureRedirect: '/milab/login',
    session: false,
  }),
  async (req, res) => {
    console.log('Microsoft callback hit', {
      originalUrl: req.originalUrl,
      path: req.path,
      hasCode: Boolean(req.query?.code),
      hasState: Boolean(req.query?.state),
      userPresent: !!req.user,
    });

    try {
      const correo = extractMicrosoftEmail(req.user);

      if (!correo || !correo.endsWith('@udistrital.edu.co')) {
        req.session.microsoftProfile = null;
        return res.render('home/message_error', {
          message: '¡Acceso denegado!',
          message2: 'Solo se permiten correos institucionales de la Universidad Distrital.',
          limit: null,
        });
      }

      const usuario = await fetchUserByEmail(correo);

      if (usuario) {
        const enriched = await ensureOatiRolesForUser(usuario);
        await regenerateSession(req);
        if (req.session) {
          req.session.user = buildSessionUser(enriched || usuario);
          req.session.microsoftProfile = null;
        }
        return res.redirect('/milab/inicio');
      }

      await regenerateSession(req);
      if (req.session) {
        req.session.microsoftProfile = {
          nombre: req.user?.displayName || req.user?._json?.displayName || '',
          correo,
          microsoftId: req.user?.id || req.user?._json?.oid || '',
        };
      }

      return res.redirect('/milab/api/profile/identify');
    } catch (error) {
      console.error('Error en callback de Microsoft:', error);
      return res.render('home/message_error', {
        message: '¡Algo ha salido mal!',
        message2: 'No fue posible iniciar sesión con Microsoft.',
        limit: null,
      });
    }
  }
);

module.exports = router;
