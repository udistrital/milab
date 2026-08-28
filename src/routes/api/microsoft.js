const { Router } = require('express');
const passport = require('passport');
const { requestOati, getAcademicServicePath } = require('../../libs/oati-client');
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

function normalizeEmail(value) {
  return (value || '').toString().trim().toLowerCase();
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
    const data = await requestOati(getAcademicServicePath(`consultar_estado_docente/${documento}`));

    const rawDocentes = data?.docentesCollection?.docente;
    const docentes = Array.isArray(rawDocentes) ? rawDocentes : rawDocentes ? [rawDocentes] : [];
    if (!docentes.length) return null;

    return docentes.find((docente) => isActiveTeacherRecord(docente)) || null;
  } catch {
    return null;
  }
}

async function lookupStudentByDocumento(documento) {
  try {
    const data = await requestOati(
      getAcademicServicePath(`datos_basicos_activos_cedula/${documento}`)
    );

    const collection = data?.datosEstudianteCollection?.datosBasicosEstudiante || [];
    if (!collection.length) return null;

    return collection.find((item) => isActiveStudentRecord(item)) || null;
  } catch {
    return null;
  }
}

async function ensureRoleAssignment(userId, roleName) {
  await pool.query(
    `INSERT INTO usuario_rol (usuario_id, rol_id)
     SELECT $1, id FROM rol WHERE nombre = $2
    ON CONFLICT (usuario_id, rol_id) DO UPDATE
     SET activo = TRUE,
       fecha_modificacion = CURRENT_TIMESTAMP`,
    [userId, roleName]
  );
}

async function findRegisteredCoordinator(usuario) {
  const documento = (usuario?.documento || '').toString().trim();
  const correo = normalizeEmail(usuario?.correo);

  const result = await pool.query(
    `SELECT documento, usuario_id, nombre_u, correo
     FROM coordinador
     WHERE ($1::text <> '' AND (documento = $1::text OR nombre_u = $1::text))
        OR ($2::text <> '' AND LOWER(COALESCE(correo, '')) = $2::text)
     LIMIT 1`,
    [documento, correo]
  );

  return result.rows[0] || null;
}

async function findRegisteredLaboratorista(usuario) {
  const documento = (usuario?.documento || '').toString().trim();
  const correo = normalizeEmail(usuario?.correo);

  const result = await pool.query(
    `SELECT documento, usuario_id, n_usuario, correo
     FROM laboratorista
     WHERE ($1::text <> '' AND (documento = $1::text OR n_usuario = $1::text))
        OR ($2::text <> '' AND LOWER(COALESCE(correo, '')) = $2::text)
     LIMIT 1`,
    [documento, correo]
  );

  return result.rows[0] || null;
}

async function ensureCoordinatorRoleForUser(usuario, currentRoles) {
  const coordinator = await findRegisteredCoordinator(usuario);

  if (!coordinator) {
    return false;
  }

  await pool.query(
    `UPDATE coordinador
     SET usuario_id = $1,
         nombre_u = CASE
           WHEN nombre_u IS NULL OR TRIM(nombre_u) = '' THEN $2
           ELSE nombre_u
         END,
         fecha_modificacion = CURRENT_TIMESTAMP
     WHERE documento = $3`,
    [usuario.id, usuario.documento, coordinator.documento]
  );

  if (!currentRoles.includes('coordinador')) {
    await ensureRoleAssignment(usuario.id, 'coordinador');
    return true;
  }

  return coordinator.usuario_id !== usuario.id;
}

async function ensureLaboratoristaRoleForUser(usuario, currentRoles) {
  const laboratorista = await findRegisteredLaboratorista(usuario);

  if (!laboratorista) {
    return false;
  }

  await pool.query(
    `UPDATE laboratorista
     SET usuario_id = $1,
         n_usuario = CASE
           WHEN n_usuario IS NULL OR TRIM(n_usuario) = '' THEN $2
           ELSE n_usuario
         END,
         fecha_modificacion = CURRENT_TIMESTAMP
     WHERE documento = $3`,
    [usuario.id, usuario.documento, laboratorista.documento]
  );

  if (!currentRoles.includes('laboratorista')) {
    await ensureRoleAssignment(usuario.id, 'laboratorista');
    return true;
  }

  return laboratorista.usuario_id !== usuario.id;
}

async function ensureRegisteredSystemRolesForUser(usuario) {
  const currentRoles = normalizeRoles(usuario?.roles || []);
  let changed = false;

  if (await ensureCoordinatorRoleForUser(usuario, currentRoles)) {
    changed = true;
  }

  if (await ensureLaboratoristaRoleForUser(usuario, currentRoles)) {
    changed = true;
  }

  if (!changed) {
    return usuario;
  }

  return fetchUserByEmail(usuario.correo);
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

async function ensureAssociatedRolesForUser(usuario) {
  const withRegisteredRoles = await ensureRegisteredSystemRolesForUser(usuario);
  return ensureOatiRolesForUser(withRegisteredRoles);
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
    failureRedirect: '/milab/',
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
        const enriched = await ensureAssociatedRolesForUser(usuario);
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
