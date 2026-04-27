const crypto = require('crypto');
const express = require('express');
const axios = require('axios');
const bcrypt = require('bcrypt');

const pool = require('../../libs/db');
const { buildSessionUser, fetchUserByEmail } = require('../../libs/user-identity');
const { normalizeRoles, ROLE_LABELS, ROLE_PRIORITY } = require('../../libs/roles');

const router = express.Router();

function emptyProfileData() {
  return {
    modo: 'crear',
    nombre: '',
    correo: '',
    documento: '',
    codigo: '',
    estado: '',
    carrera: '',
    tipo_usuario: 'estudiante',
    readonly: false,
    profileLocked: false,
    error: null,
    success: null,
  };
}

function normalizeEmail(value) {
  return (value || '').toString().trim().toLowerCase();
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

function normalizeName(value) {
  return (value || '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeName(value) {
  const normalized = normalizeName(value);
  return normalized ? normalized.split(' ') : [];
}

function shouldSkipIdentityMatch(correo) {
  const allowList = (process.env.PROFILE_NAME_MATCH_EXCEPT || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  if (!allowList.length) return false;

  return allowList.includes(normalizeEmail(correo));
}

function tokenCoverageScore(nameA, nameB) {
  const tokensA = tokenizeName(nameA);
  const tokensB = tokenizeName(nameB);

  if (!tokensA.length || !tokensB.length) return 0;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let overlap = 0;

  for (const token of setA) {
    if (setB.has(token)) overlap += 1;
  }

  return overlap / Math.max(setA.size, setB.size);
}

function diceCoefficient(nameA, nameB) {
  const a = normalizeName(nameA);
  const b = normalizeName(nameB);

  if (!a || !b) return 0;
  if (a === b) return 1;

  const bigrams = (str) => {
    const pairs = [];
    for (let i = 0; i < str.length - 1; i += 1) {
      pairs.push(str.slice(i, i + 2));
    }
    return pairs;
  };

  const pairsA = bigrams(a);
  const pairsB = bigrams(b);
  const counts = new Map();

  for (const pair of pairsA) {
    counts.set(pair, (counts.get(pair) || 0) + 1);
  }

  let intersection = 0;
  for (const pair of pairsB) {
    const count = counts.get(pair);
    if (count) {
      intersection += 1;
      counts.set(pair, count - 1);
    }
  }

  return (2 * intersection) / (pairsA.length + pairsB.length);
}

async function ensureUserIdentity({ correo, documento, nombre }) {
  const existing = await pool.query(
    'SELECT id FROM usuarios WHERE LOWER(correo) = LOWER($1) OR documento = $2 LIMIT 1',
    [correo, documento]
  );

  if (existing.rows.length) {
    const userId = existing.rows[0].id;
    await pool.query(
      `UPDATE usuarios
       SET correo = $1,
           documento = $2,
           nombre = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [correo, documento, nombre, userId]
    );
    return userId;
  }

  const inserted = await pool.query(
    'INSERT INTO usuarios (correo, documento, nombre) VALUES ($1, $2, $3) RETURNING id',
    [correo, documento, nombre]
  );
  return inserted.rows[0].id;
}

async function ensureRoleAssignment(userId, roleName) {
  await pool.query(
    `INSERT INTO usuario_roles (usuario_id, role_id)
     SELECT $1, id FROM roles WHERE name = $2
     ON CONFLICT DO NOTHING`,
    [userId, roleName]
  );
}

async function upsertStudentProfile(userId, documento, codigo, programa, estado) {
  await pool.query(
    `INSERT INTO perfil_estudiante (usuario_id, documento, codigo, programa, estado)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (usuario_id) DO UPDATE
     SET documento = EXCLUDED.documento,
         codigo = EXCLUDED.codigo,
         programa = EXCLUDED.programa,
         estado = EXCLUDED.estado,
         updated_at = CURRENT_TIMESTAMP`,
    [userId, documento, codigo, programa, estado]
  );
}

async function upsertTeacherProfile(userId, documento, estado) {
  await pool.query(
    `INSERT INTO perfil_docente (usuario_id, documento, estado)
     VALUES ($1, $2, $3)
     ON CONFLICT (usuario_id) DO UPDATE
     SET documento = EXCLUDED.documento,
         estado = EXCLUDED.estado,
         updated_at = CURRENT_TIMESTAMP`,
    [userId, documento, estado]
  );
}

async function upsertLegacyUsuario({ documento, codigo, nombre, correo, estado, carrera }) {
  const existing = await pool.query(
    'SELECT documento FROM usuario WHERE documento = $1 OR LOWER(correo) = LOWER($2) LIMIT 1',
    [documento, correo]
  );

  if (existing.rows.length) {
    await pool.query(
      `UPDATE usuario
       SET codigo = $1,
           nombre = $2,
           correo = $3,
           estado = $4,
           carrera = $5
       WHERE documento = $6`,
      [codigo, nombre, correo, estado, carrera, documento]
    );
    return;
  }

  await pool.query(
    `INSERT INTO usuario (documento, codigo, nombre, correo, estado, carrera)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [documento, codigo, nombre, correo, estado, carrera]
  );
}

async function lookupStudentByDocumento(documento) {
  try {
    const respuesta1 = await axios.get(
      'https://autenticacion.portaloas.udistrital.edu.co/wso2eiserver/services/servicios_academicos_produccion/datos_basicos_activos_cedula/' +
        documento
    );

    const collection = respuesta1.data?.datosEstudianteCollection?.datosBasicosEstudiante || [];
    if (!collection.length) return null;

    const item = collection[collection.length - 1];
    const codigo = item.codigo || '';
    const estadoCodigo = item.estado || '';
    const carreraCodigo = item.carrera || '';
    const nombre = item.nombre || '';
    const correo = resolveOatiEmail(item);

    const respuesta2 = await axios.get(
      'https://autenticacion.portaloas.udistrital.edu.co/wso2eiserver/services/servicios_academicos_produccion/estados_codigo/' +
        estadoCodigo
    );

    const respuesta3 = await axios.get(
      'https://autenticacion.portaloas.udistrital.edu.co/wso2eiserver/services/servicios_academicos_produccion/carrera/' +
        carreraCodigo
    );

    return {
      tipo_usuario: 'estudiante',
      documento,
      codigo,
      estado: respuesta2.data?.estado?.nombre || estadoCodigo || '',
      carrera: respuesta3.data?.carrerasCollection?.carrera?.[0]?.nombre || '',
      nombre,
      correo,
    };
  } catch {
    return null;
  }
}

async function lookupTeacherByDocumento(documento) {
  try {
    const respuesta = await axios.get(
      'https://autenticacion.portaloas.udistrital.edu.co/wso2eiserver/services/servicios_academicos_produccion/consultar_estado_docente/' +
        documento
    );

    const docente = respuesta.data?.docentesCollection?.docente?.[0];
    if (!docente) return null;

    return {
      tipo_usuario: 'docente',
      documento,
      codigo: '',
      estado: docente.estado_docente || '',
      carrera: '',
      nombre: docente.nombre || '',
      correo: resolveOatiEmail(docente),
    };
  } catch {
    return null;
  }
}

function buildReadonlyProfile({
  nombre,
  correo,
  documento,
  codigo,
  estado,
  carrera,
  tipo_usuario,
  profileLocked,
}) {
  return {
    modo: 'editar',
    nombre: nombre || '',
    correo: correo || '',
    documento: documento || '',
    codigo: codigo || '',
    estado: estado || '',
    carrera: carrera || '',
    tipo_usuario: tipo_usuario || '',
    readonly: true,
    profileLocked: Boolean(profileLocked),
    error: null,
    success: null,
  };
}

function buildRoleSummary(role, profile) {
  const fields = [
    { label: 'Nombre', value: profile.nombre || '' },
    { label: 'Documento', value: profile.documento || '' },
    { label: 'Correo', value: profile.correo || '' },
  ];

  if (role === 'estudiante') {
    fields.push(
      { label: 'Codigo', value: profile.codigo || '' },
      { label: 'Carrera', value: profile.carrera || '' },
      { label: 'Estado', value: profile.estado || '' }
    );
  }

  if (role === 'docente') {
    fields.push({ label: 'Estado', value: profile.estado || '' });
  }

  if (role === 'laboratorista' || role === 'coordinador') {
    fields.push({ label: 'Estado', value: profile.estado || 'Activo' });
  }

  return fields.map((field) => ({
    label: field.label,
    value: field.value ? field.value : 'Sin dato',
  }));
}

async function loadStudentProfile(documento) {
  if (!documento) return null;

  const result = await pool.query(
    `SELECT
       u.documento,
       u.nombre,
       u.correo,
       pe.codigo,
       pe.programa AS carrera,
       pe.estado
     FROM usuarios u
     LEFT JOIN perfil_estudiante pe ON pe.usuario_id = u.id
     WHERE u.documento = $1
     LIMIT 1`,
    [documento]
  );

  if (!result.rows.length) return null;

  const row = result.rows[0];
  return buildReadonlyProfile({
    nombre: row.nombre,
    correo: row.correo,
    documento: row.documento,
    codigo: row.codigo,
    estado: row.estado,
    carrera: row.carrera,
    tipo_usuario: 'estudiante',
    profileLocked: true,
  });
}

async function loadTeacherProfile(documento) {
  if (!documento) return null;

  const result = await pool.query(
    `SELECT
       u.documento,
       u.nombre,
       u.correo,
       pd.estado
     FROM usuarios u
     LEFT JOIN perfil_docente pd ON pd.usuario_id = u.id
     WHERE u.documento = $1
     LIMIT 1`,
    [documento]
  );

  if (!result.rows.length) return null;

  const row = result.rows[0];
  const estado = (row.estado || '').toString().trim() || 'Activo';

  return buildReadonlyProfile({
    nombre: row.nombre,
    correo: row.correo,
    documento: row.documento,
    codigo: '',
    estado,
    carrera: '',
    tipo_usuario: 'docente',
    profileLocked: true,
  });
}

async function loadLaboratoristaProfile(documento) {
  if (!documento) return null;

  const result = await pool.query(
    `SELECT documento, nombre, correo
     FROM laboratorista
     WHERE n_usuario = $1 OR documento = $1
     LIMIT 1`,
    [documento]
  );

  if (!result.rows.length) return null;

  const row = result.rows[0];
  return buildReadonlyProfile({
    nombre: row.nombre,
    correo: row.correo,
    documento: row.documento,
    codigo: '',
    estado: 'Activo',
    carrera: '',
    tipo_usuario: 'laboratorista',
    profileLocked: false,
  });
}

async function loadCoordinadorProfile(documento) {
  if (!documento) return null;

  const result = await pool.query(
    `SELECT documento, nombre, correo
     FROM coordinador_laboratorio
     WHERE nombre_u = $1 OR documento = $1
     LIMIT 1`,
    [documento]
  );

  if (!result.rows.length) return null;

  const row = result.rows[0];
  return buildReadonlyProfile({
    nombre: row.nombre,
    correo: row.correo,
    documento: row.documento,
    codigo: '',
    estado: 'Activo',
    carrera: '',
    tipo_usuario: 'coordinador',
    profileLocked: false,
  });
}

async function loadProfileBySession(user) {
  const roles = normalizeRoles(user?.roles || user?.tipo);
  const documento = user?.documento_real || user?.documento || '';
  const rolePriority = ROLE_PRIORITY.filter((role) => role !== 'admin');
  const roleLoaders = {
    estudiante: loadStudentProfile,
    docente: loadTeacherProfile,
    laboratorista: loadLaboratoristaProfile,
    coordinador: loadCoordinadorProfile,
  };

  const loadedProfiles = [];
  const roleProfiles = [];

  for (const role of rolePriority) {
    if (!roles.includes(role)) continue;
    const loader = roleLoaders[role];
    if (!loader) continue;
    const profile = await loader(documento);
    if (!profile) continue;

    loadedProfiles.push({ role, profile });
    roleProfiles.push({
      role,
      label: ROLE_LABELS[role] || role,
      fields: buildRoleSummary(role, profile),
    });
  }

  const formRoleOrder = ['estudiante', 'docente', 'coordinador', 'laboratorista'];
  let primaryProfile = null;

  for (const role of formRoleOrder) {
    const entry = loadedProfiles.find((item) => item.role === role);
    if (entry) {
      primaryProfile = entry.profile;
      break;
    }
  }

  if (primaryProfile) {
    return {
      ...primaryProfile,
      roleProfiles,
    };
  }

  return {
    modo: 'editar',
    nombre: user.nombre || '',
    correo: user.correo || '',
    documento: user.documento || '',
    codigo: '',
    estado: user?.tipo ? 'Activo' : '',
    carrera: '',
    tipo_usuario: user.tipo || '',
    readonly: true,
    profileLocked: false,
    error: null,
    success: null,
    roleProfiles,
  };
}

router.get('/', async (req, res) => {
  try {
    if (req.session.user) {
      const profileData = await loadProfileBySession(req.session.user);
      return res.render('home/profile', profileData || emptyProfileData());
    }

    if (req.session.microsoftProfile) {
      return res.redirect('/milab/api/profile/identify');
    }

    return res.redirect('/milab/auth/login');
  } catch (error) {
    console.error('Error cargando perfil:', error);
    return res.render('home/message_error', {
      message: '¡Algo ha salido mal!',
      message2: 'No fue posible cargar el perfil.',
      limit: null,
    });
  }
});

router.get('/identify', async (req, res) => {
  if (req.session.user) {
    return res.redirect('/milab/inicio');
  }

  if (!req.session.microsoftProfile?.correo) {
    return res.redirect('/milab/auth/login');
  }

  return res.render('home/profile_identify', {
    correo: req.session.microsoftProfile.correo || '',
    documento: '',
    error: null,
  });
});

router.post('/identify', async (req, res) => {
  if (!req.session.microsoftProfile?.correo) {
    return res.redirect('/milab/auth/login');
  }

  const documento = (req.body.documento || '').trim();
  const correo = normalizeEmail(req.session.microsoftProfile.correo);
  const nombreEntra = req.session.microsoftProfile?.nombre || '';

  const denyAccess = (message2) => {
    const renderError = () =>
      res.render('home/message_error', {
        message: 'Acceso denegado',
        message2,
        limit: 'loginOnly',
      });

    if (req.session) {
      return req.session.destroy(() => renderError());
    }

    return renderError();
  };

  if (!documento) {
    return res.render('home/profile_identify', {
      correo,
      documento,
      error: 'Por favor ingrese un numero de documento valido.',
    });
  }

  const studentData = await lookupStudentByDocumento(documento);
  const teacherData = await lookupTeacherByDocumento(documento);
  const profileData =
    studentData && studentData.estado !== 'EGRESADO' ? studentData : teacherData || studentData;

  if (!profileData) {
    const staffProfile =
      (await loadLaboratoristaProfile(documento)) || (await loadCoordinadorProfile(documento));

    if (!staffProfile) {
      return denyAccess('El documento no esta asociado para ingresar a MiLab.');
    }

    if (
      staffProfile.correo &&
      normalizeEmail(staffProfile.correo) !== correo &&
      !shouldSkipIdentityMatch(correo)
    ) {
      return denyAccess('El documento no esta asociado al correo indicado.');
    }

    if (staffProfile.nombre && nombreEntra && !shouldSkipIdentityMatch(correo)) {
      const coverage = tokenCoverageScore(staffProfile.nombre, nombreEntra);
      const similarity = diceCoefficient(staffProfile.nombre, nombreEntra);
      const score = Math.max(coverage, similarity);

      if (score < 0.8) {
        return denyAccess('El documento no esta asociado al correo indicado.');
      }
    }

    const staffDocumento = staffProfile.documento || documento;
    const staffNombre = staffProfile.nombre || nombreEntra || '';

    const userId = await ensureUserIdentity({
      correo,
      documento: staffDocumento,
      nombre: staffNombre,
    });
    await ensureRoleAssignment(userId, staffProfile.tipo_usuario);

    const usuario = await fetchUserByEmail(correo);
    if (!usuario) {
      return denyAccess('No fue posible validar el acceso en MiLab.');
    }

    req.session.user = buildSessionUser(usuario);
    req.session.microsoftProfile = null;
    return res.redirect('/milab/inicio');
  }

  if (profileData.estado === 'EGRESADO') {
    return denyAccess('El documento no esta asociado para ingresar a MiLab.');
  }

  if (
    profileData.correo &&
    normalizeEmail(profileData.correo) !== correo &&
    !shouldSkipIdentityMatch(correo)
  ) {
    return denyAccess('El documento no esta asociado al correo indicado.');
  }

  if (profileData.nombre && nombreEntra && !shouldSkipIdentityMatch(correo)) {
    const coverage = tokenCoverageScore(profileData.nombre, nombreEntra);
    const similarity = diceCoefficient(profileData.nombre, nombreEntra);
    const score = Math.max(coverage, similarity);

    if (score < 0.8) {
      return denyAccess('El documento no esta asociado al correo indicado.');
    }
  }

  return res.render('home/profile', {
    ...emptyProfileData(),
    modo: 'crear',
    profileLocked: true,
    nombre: profileData.nombre || '',
    correo,
    documento: profileData.documento || '',
    codigo: profileData.codigo || '',
    estado: profileData.estado || '',
    carrera: profileData.carrera || '',
    tipo_usuario: profileData.tipo_usuario,
  });
});

router.post('/', async (req, res) => {
  const formData = {
    modo: req.body.modo || 'crear',
    nombre: (req.body.nombre || '').trim(),
    correo: (req.body.correo || '').trim().toLowerCase(),
    documento: (req.body.documento || '').trim(),
    codigo: (req.body.codigo || '').trim(),
    estado: (req.body.estado || '').trim(),
    carrera: (req.body.carrera || '').trim(),
    tipo_usuario: (req.body.tipo_usuario || 'estudiante').trim(),
    readonly: false,
    profileLocked: false,
    error: null,
    success: null,
  };

  if (formData.modo === 'crear' && req.session.microsoftProfile?.correo) {
    formData.correo = req.session.microsoftProfile.correo.trim().toLowerCase();
  }

  const isStudent = formData.tipo_usuario === 'estudiante';
  const isTeacher = formData.tipo_usuario === 'docente';

  if (!formData.correo.endsWith('@udistrital.edu.co')) {
    return res.render('home/profile', {
      ...formData,
      error: 'Solo se permiten correos institucionales @udistrital.edu.co.',
    });
  }

  if (!formData.nombre || !formData.documento || !formData.estado) {
    return res.render('home/profile', {
      ...formData,
      error: 'Nombre, documento y estado son obligatorios.',
    });
  }

  if (!isStudent && !isTeacher) {
    return res.render('home/profile', {
      ...formData,
      error: 'El tipo de usuario debe ser estudiante o docente.',
    });
  }

  if (isStudent && (!formData.codigo || !formData.carrera)) {
    return res.render('home/profile', {
      ...formData,
      error: 'Para estudiantes, código y carrera son obligatorios.',
    });
  }

  try {
    if (req.session.user) {
      const sessionRoles = normalizeRoles(req.session.user.roles || req.session.user.tipo);
      const sessionIsStudent = sessionRoles.includes('estudiante');
      const sessionIsTeacher = sessionRoles.includes('docente');

      if (!sessionIsStudent && !sessionIsTeacher) {
        return res.render('home/profile', {
          ...formData,
          error: 'El perfil solo puede actualizarse para roles estudiante o docente.',
        });
      }

      const userId = req.session.user.id;

      if (userId) {
        await pool.query(
          `UPDATE usuarios
           SET nombre = $1,
               correo = $2,
               documento = $3,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $4`,
          [formData.nombre, formData.correo, formData.documento, userId]
        );

        if (isStudent) {
          await upsertStudentProfile(
            userId,
            formData.documento,
            formData.codigo,
            formData.carrera,
            formData.estado
          );
        }

        if (isTeacher) {
          await upsertTeacherProfile(userId, formData.documento, formData.estado);
        }
      }

      await upsertLegacyUsuario({
        documento: formData.documento,
        codigo: isStudent ? formData.codigo : null,
        nombre: formData.nombre,
        correo: formData.correo,
        estado: formData.estado,
        carrera: isStudent ? formData.carrera : null,
      });

      return res.render('home/profile', {
        ...formData,
        modo: 'editar',
        success: 'Perfil actualizado correctamente.',
      });
    }

    if (!req.session.microsoftProfile) {
      return res.redirect('/milab/auth/login');
    }

    const existe = await pool.query(
      `SELECT id FROM usuarios WHERE documento = $1 OR LOWER(correo) = LOWER($2)`,
      [formData.documento, formData.correo]
    );

    if (existe.rows.length > 0) {
      return res.render('home/profile', {
        ...formData,
        error: 'Ya existe un usuario registrado con ese documento o correo.',
      });
    }

    const passwordTemporal = crypto.randomBytes(24).toString('hex');
    const hashedPassword = await bcrypt.hash(passwordTemporal, 12);

    const userId = await ensureUserIdentity({
      correo: formData.correo,
      documento: formData.documento,
      nombre: formData.nombre,
    });

    await ensureRoleAssignment(userId, formData.tipo_usuario);

    if (isStudent) {
      await upsertStudentProfile(
        userId,
        formData.documento,
        formData.codigo,
        formData.carrera,
        formData.estado
      );
    }

    if (isTeacher) {
      await upsertTeacherProfile(userId, formData.documento, formData.estado);
    }

    await upsertLegacyUsuario({
      documento: formData.documento,
      codigo: isStudent ? formData.codigo : null,
      nombre: formData.nombre,
      correo: formData.correo,
      estado: formData.estado,
      carrera: isStudent ? formData.carrera : null,
    });

    await pool.query(
      `INSERT INTO auth (documento, password, tipo, password_cambiado, correo)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (documento) DO UPDATE
       SET correo = EXCLUDED.correo,
           tipo = EXCLUDED.tipo`,
      [formData.documento, hashedPassword, formData.tipo_usuario, true, formData.correo]
    );

    const refreshed = await fetchUserByEmail(formData.correo);
    req.session.user = buildSessionUser(refreshed);
    req.session.microsoftProfile = null;

    return res.redirect('/milab/inicio');
  } catch (error) {
    console.error('Error guardando perfil:', error);
    return res.render('home/profile', {
      ...formData,
      error: 'No fue posible guardar la información del perfil.',
    });
  }
});

module.exports = router;
