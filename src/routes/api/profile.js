const express = require('express');

const pool = require('../../libs/db');
const { getAcademicServicePath, requestOati } = require('../../libs/oati-client');
const { buildSessionUser, fetchUserByEmail } = require('../../libs/user-identity');
const { normalizeRoles, ROLE_LABELS, ROLE_PRIORITY } = require('../../libs/roles');
const { startSessionLifetime } = require('../../libs/session-policy');

const router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: true }));

function regenerateSession(req) {
  return new Promise((resolve) => {
    if (!req.session) return resolve(false);
    req.session.regenerate((err) => {
      if (err) {
        console.error('Failed to regenerate session after profile login:', err);
        return resolve(false);
      }
      return resolve(true);
    });
  });
}

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

function isNoEmailPlaceholder(correo, documento = '') {
  const normalizedCorreo = normalizeEmail(correo);
  const normalizedDocumento = String(documento || '')
    .trim()
    .toLowerCase();

  if (!normalizedCorreo) {
    return true;
  }

  if (normalizedCorreo.includes('no-email')) {
    return true;
  }

  if (normalizedCorreo.endsWith('@placeholder.milab.local')) {
    return true;
  }

  if (normalizedDocumento && normalizedCorreo === `${normalizedDocumento}@udistrital.edu.co`) {
    return true;
  }

  return false;
}

async function findUsuarioByDocumento(documento) {
  const normalizedDocumento = String(documento || '').trim();
  if (!normalizedDocumento) {
    return null;
  }

  const result = await pool.query(
    `SELECT id, documento, correo, nombre, codigo, estado, carrera
     FROM usuario
     WHERE documento = $1
     LIMIT 1`,
    [normalizedDocumento]
  );

  return result.rows[0] || null;
}

async function hasPlaceholderAccount(documento) {
  const existingByDocument = await findUsuarioByDocumento(documento);
  return Boolean(existingByDocument && isNoEmailPlaceholder(existingByDocument.correo, documento));
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
  const envName = (process.env.NODE_ENV || '').toLowerCase();
  if (envName === 'production') {
    return false;
  }

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

async function deactivateRoleAssignment(userId, roleName) {
  await pool.query(
    `UPDATE usuario_rol
     SET activo = FALSE,
         fecha_modificacion = CURRENT_TIMESTAMP
     WHERE usuario_id = $1
       AND activo = TRUE
       AND rol_id IN (SELECT id FROM rol WHERE nombre = $2)`,
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
         fecha_modificacion = CURRENT_TIMESTAMP`,
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
         fecha_modificacion = CURRENT_TIMESTAMP`,
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

function normalizeEstadoCodigo(value) {
  return (value || '').toString().trim().toUpperCase();
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function isActiveStudentRecord(record) {
  return normalizeEstadoCodigo(record?.estado) === 'A';
}

function isActiveTeacherRecord(record) {
  const estado = normalizeEstadoCodigo(
    record?.estado_docente || record?.estadoDocente || record?.estado
  );
  return estado === 'A' || estado === 'ACTIVO';
}

// Solo registros de estudiante con estado A (activo) que no resuelvan a EGRESADO.
async function lookupActiveStudentRecords(documento) {
  let studentData;
  try {
    studentData = await requestOati(
      getAcademicServicePath(`datos_basicos_activos_cedula/${documento}`)
    );
  } catch {
    return [];
  }

  const collection = toArray(studentData?.datosEstudianteCollection?.datosBasicosEstudiante);
  const seenCodigos = new Set();
  const activeRecords = [];

  for (const record of collection) {
    const codigo = (record?.codigo || '').toString().trim();
    if (!codigo || seenCodigos.has(codigo) || !isActiveStudentRecord(record)) continue;

    let estado = 'ACTIVO';
    try {
      const estadoData = await requestOati(
        getAcademicServicePath(`estados_codigo/${record.estado}`)
      );
      estado = estadoData?.estado?.nombre || estado;
    } catch {
      // Se conserva ACTIVO porque el código de estado ya es A.
    }
    if (normalizeEstadoCodigo(estado) === 'EGRESADO') continue;

    let carrera = '';
    try {
      const carreraData = await requestOati(
        getAcademicServicePath(`carrera/${record.carrera || ''}`)
      );
      carrera = carreraData?.carrerasCollection?.carrera?.[0]?.nombre || '';
    } catch {
      // Se usa el código de carrera de OATI si no se puede resolver el nombre.
    }

    seenCodigos.add(codigo);
    activeRecords.push({
      tipo_usuario: 'estudiante',
      documento,
      codigo,
      estado,
      carrera: carrera || (record.carrera || '').toString(),
      nombre: record.nombre || '',
      correo: resolveOatiEmail(record),
    });
  }

  return activeRecords;
}

async function lookupTeacherByDocumento(documento) {
  try {
    const teacherData = await requestOati(
      getAcademicServicePath(`consultar_estado_docente/${documento}`)
    );

    const docente = toArray(teacherData?.docentesCollection?.docente).find((item) =>
      isActiveTeacherRecord(item)
    );
    if (!docente) return null;

    return {
      tipo_usuario: 'docente',
      documento,
      codigo: '',
      estado: docente.estado_docente || docente.estadoDocente || docente.estado || '',
      carrera: '',
      nombre: docente.nombre || '',
      correo: resolveOatiEmail(docente),
    };
  } catch {
    return null;
  }
}

const MILAB_ROLE_TABLES = [
  {
    role: 'laboratorista',
    sql: `SELECT documento, nombre, correo
          FROM laboratorista
          WHERE (documento = $1 OR n_usuario = $1
                 OR ($2::text <> '' AND LOWER(COALESCE(correo, '')) = $2::text))
            AND COALESCE(activo, TRUE) = TRUE
          LIMIT 1`,
  },
  {
    role: 'coordinador',
    sql: `SELECT documento, nombre, correo
          FROM coordinador
          WHERE (documento = $1 OR nombre_u = $1
                 OR ($2::text <> '' AND LOWER(COALESCE(correo, '')) = $2::text))
            AND COALESCE(activo, TRUE) = TRUE
          LIMIT 1`,
  },
  {
    role: 'monitor',
    sql: `SELECT documento, nombre, correo
          FROM monitor
          WHERE (documento = $1
                 OR ($2::text <> '' AND LOWER(COALESCE(correo, '')) = $2::text))
            AND COALESCE(activo, TRUE) = TRUE
          LIMIT 1`,
  },
];

const OATI_ROLES = ['estudiante', 'docente'];

// Roles registrados en MILab: tablas de laboratorista/coordinador/monitor y roles ya
// asignados (por ejemplo admin) a una cuenta provisional con ese documento.
async function findMilabRolesByDocumento(documento, correo) {
  const roles = new Set();
  let identity = null;
  const normalizedCorreo = normalizeEmail(correo);

  for (const { role, sql } of MILAB_ROLE_TABLES) {
    const result = await pool.query(sql, [documento, normalizedCorreo]);
    const row = result.rows[0];
    if (!row) continue;
    roles.add(role);
    if (!identity) identity = { nombre: row.nombre || '', correo: row.correo || '' };
  }

  const assigned = await pool.query(
    `SELECT r.nombre AS rol, u.nombre, u.correo
     FROM usuario u
     JOIN usuario_rol ur ON ur.usuario_id = u.id AND ur.activo = TRUE
     JOIN rol r ON r.id = ur.rol_id
     WHERE u.documento = $1`,
    [documento]
  );
  for (const row of assigned.rows) {
    const rol = (row.rol || '').toString().trim().toLowerCase();
    // Solo cuentas provisionales: una cuenta con correo real ingresa directamente por correo.
    if (!rol || OATI_ROLES.includes(rol) || !isNoEmailPlaceholder(row.correo, documento)) continue;
    roles.add(rol);
    if (!identity) identity = { nombre: row.nombre || '', correo: '' };
  }

  return { roles: [...roles], identity };
}

async function linkMilabRoleRecords(userId, documento, correo) {
  const normalizedCorreo = normalizeEmail(correo);
  await pool.query(
    `UPDATE laboratorista
     SET usuario_id = $1, fecha_modificacion = CURRENT_TIMESTAMP
     WHERE (documento = $2 OR n_usuario = $2
            OR ($3::text <> '' AND LOWER(COALESCE(correo, '')) = $3::text))
       AND COALESCE(activo, TRUE) = TRUE`,
    [userId, documento, normalizedCorreo]
  );
  await pool.query(
    `UPDATE coordinador
     SET usuario_id = $1, fecha_modificacion = CURRENT_TIMESTAMP
     WHERE (documento = $2 OR nombre_u = $2
            OR ($3::text <> '' AND LOWER(COALESCE(correo, '')) = $3::text))
       AND COALESCE(activo, TRUE) = TRUE`,
    [userId, documento, normalizedCorreo]
  );
  await pool.query(
    `UPDATE monitor
     SET usuario_id = $1, fecha_modificacion = CURRENT_TIMESTAMP
     WHERE (documento = $2
            OR ($3::text <> '' AND LOWER(COALESCE(correo, '')) = $3::text))
       AND COALESCE(activo, TRUE) = TRUE`,
    [userId, documento, normalizedCorreo]
  );
}

// Asigna exactamente los roles validados: estudiante/docente según OATI y los roles de MILab.
async function completeRegistration({
  correo,
  documento,
  nombre,
  estudiante = null,
  docente = null,
  milabRoles = [],
}) {
  const userId = await ensureUserIdentity({ correo, documento, nombre });

  if (estudiante) {
    await ensureRoleAssignment(userId, 'estudiante');
    await upsertStudentProfile(
      userId,
      documento,
      estudiante.codigo,
      estudiante.carrera,
      estudiante.estado
    );
  } else {
    await deactivateRoleAssignment(userId, 'estudiante');
  }

  if (docente) {
    await ensureRoleAssignment(userId, 'docente');
    await upsertTeacherProfile(userId, documento, docente.estado || '');
  } else {
    await deactivateRoleAssignment(userId, 'docente');
  }

  for (const role of milabRoles) {
    await ensureRoleAssignment(userId, role);
  }
  if (milabRoles.length) {
    await linkMilabRoleRecords(userId, documento, correo);
  }

  if (estudiante || docente) {
    await upsertLegacyUsuario({
      documento,
      codigo: estudiante ? estudiante.codigo : null,
      nombre,
      correo,
      estado: (estudiante || docente).estado || '',
      carrera: estudiante ? estudiante.carrera : null,
    });
  }

  return userId;
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
    FROM usuario u
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
    FROM usuario u
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
    FROM coordinador
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

  const estudiantes = await lookupActiveStudentRecords(documento);
  const docente = await lookupTeacherByDocumento(documento);
  const { roles: milabRoles, identity: milabIdentity } = await findMilabRolesByDocumento(
    documento,
    correo
  );

  if (!estudiantes.length && !docente && !milabRoles.length) {
    return denyAccess('El documento no esta asociado para ingresar a MILab.');
  }

  const identityRef = estudiantes[0] || docente || milabIdentity || {};

  if (
    identityRef.correo &&
    normalizeEmail(identityRef.correo) !== correo &&
    !shouldSkipIdentityMatch(correo)
  ) {
    return denyAccess('El documento no esta asociado al correo indicado.');
  }

  if (identityRef.nombre && nombreEntra && !shouldSkipIdentityMatch(correo)) {
    const coverage = tokenCoverageScore(identityRef.nombre, nombreEntra);
    const similarity = diceCoefficient(identityRef.nombre, nombreEntra);
    const score = Math.max(coverage, similarity);

    if (score < 0.8) {
      return denyAccess('El documento no esta asociado al correo indicado.');
    }
  }

  const nombreRegistro = identityRef.nombre || nombreEntra || '';
  const loginRegisteredUser = async () => {
    const usuario = await fetchUserByEmail(correo);
    if (!usuario) {
      return denyAccess('No fue posible validar el acceso en MILab.');
    }

    await regenerateSession(req);
    if (req.session) {
      req.session.user = buildSessionUser(usuario);
      startSessionLifetime(req.session);
      req.session.microsoftProfile = null;
      req.session.registroPendiente = null;
    }
    return res.redirect('/milab/inicio');
  };

  // Sin perfil OATI activo: ingresa solo con los roles registrados en MILab.
  if (!estudiantes.length && !docente) {
    await completeRegistration({ correo, documento, nombre: nombreRegistro, milabRoles });
    return loginRegisteredUser();
  }

  const singleChoice = estudiantes.length <= 1;
  if (singleChoice && (await hasPlaceholderAccount(documento))) {
    await completeRegistration({
      correo,
      documento,
      nombre: nombreRegistro,
      estudiante: estudiantes[0] || null,
      docente,
      milabRoles,
    });
    return loginRegisteredUser();
  }

  req.session.registroPendiente = {
    correo,
    documento,
    estudiantes,
    docente,
    milabRoles,
  };

  const perfilBase = estudiantes.length === 1 ? estudiantes[0] : docente;
  return res.render('home/profile', {
    ...emptyProfileData(),
    modo: 'crear',
    profileLocked: true,
    nombre: nombreRegistro,
    correo,
    documento,
    codigo: estudiantes.length === 1 ? estudiantes[0].codigo : '',
    estado: estudiantes.length > 1 ? '' : perfilBase?.estado || '',
    carrera: estudiantes.length === 1 ? estudiantes[0].carrera : '',
    tipo_usuario: estudiantes.length ? 'estudiante' : 'docente',
    opcionesCodigo: estudiantes.length > 1 ? estudiantes : [],
  });
});

router.post('/', async (req, res) => {
  // Los datos de un usuario registrado solo los modifica el admin desde el dashboard.
  if (req.session.user) {
    let profileData = null;
    try {
      profileData = await loadProfileBySession(req.session.user);
    } catch (error) {
      console.error('Error cargando perfil:', error);
    }
    return res.status(403).render('home/profile', {
      ...(profileData || emptyProfileData()),
      readonly: true,
      error: 'El perfil no se puede modificar. Solicite cualquier corrección al administrador.',
      success: null,
    });
  }

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

  if (!formData.correo.endsWith('@udistrital.edu.co')) {
    return res.render('home/profile', {
      ...formData,
      error: 'Solo se permiten correos institucionales @udistrital.edu.co.',
    });
  }

  // En el registro solo se aceptan los datos validados contra OATI en /identify.
  let registroPendiente = null;
  let estudianteElegido = null;
  if (!req.session.user && req.session.microsoftProfile) {
    registroPendiente = req.session.registroPendiente;
    if (!registroPendiente || normalizeEmail(registroPendiente.correo) !== formData.correo) {
      return res.redirect('/milab/api/profile/identify');
    }

    const estudiantes = Array.isArray(registroPendiente.estudiantes)
      ? registroPendiente.estudiantes
      : [];
    formData.modo = 'crear';
    formData.documento = registroPendiente.documento;
    formData.profileLocked = true;
    formData.opcionesCodigo = estudiantes.length > 1 ? estudiantes : [];

    if (estudiantes.length) {
      estudianteElegido =
        estudiantes.length === 1
          ? estudiantes[0]
          : estudiantes.find((item) => item.codigo === formData.codigo) || null;

      if (!estudianteElegido) {
        return res.render('home/profile', {
          ...formData,
          tipo_usuario: 'estudiante',
          codigo: '',
          estado: '',
          carrera: '',
          error: 'Seleccione el código de estudiante activo con el que desea registrarse.',
        });
      }

      formData.tipo_usuario = 'estudiante';
      formData.codigo = estudianteElegido.codigo;
      formData.estado = estudianteElegido.estado;
      formData.carrera = estudianteElegido.carrera;
    } else if (registroPendiente.docente) {
      formData.tipo_usuario = 'docente';
      formData.codigo = '';
      formData.carrera = '';
      formData.estado = registroPendiente.docente.estado || formData.estado;
    }

    formData.nombre = (estudianteElegido || registroPendiente.docente)?.nombre || formData.nombre;
  }

  const isStudent = formData.tipo_usuario === 'estudiante';
  const isTeacher = formData.tipo_usuario === 'docente';

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
    if (!req.session.microsoftProfile) {
      return res.redirect('/milab/auth/login');
    }

    const existe = await pool.query(
      `SELECT id, documento, correo
       FROM usuario
       WHERE documento = $1 OR LOWER(correo) = LOWER($2)`,
      [formData.documento, formData.correo]
    );

    const normalizedDocumento = String(formData.documento || '').trim();
    const normalizedCorreo = normalizeEmail(formData.correo);
    const matchedRows = Array.isArray(existe.rows) ? existe.rows : [];
    const sameDocumentRow = matchedRows.find(
      (row) => String(row.documento || '').trim() === normalizedDocumento
    );
    const hasEmailInAnotherDocument = matchedRows.some((row) => {
      const rowCorreo = normalizeEmail(row.correo);
      const rowDocumento = String(row.documento || '').trim();
      return rowCorreo === normalizedCorreo && rowDocumento !== normalizedDocumento;
    });
    const canPromotePlaceholder =
      !!sameDocumentRow && isNoEmailPlaceholder(sameDocumentRow.correo, normalizedDocumento);

    if (hasEmailInAnotherDocument || (matchedRows.length > 0 && !canPromotePlaceholder)) {
      return res.render('home/profile', {
        ...formData,
        error: 'Ya existe un usuario registrado con ese documento o correo.',
      });
    }

    await completeRegistration({
      correo: formData.correo,
      documento: formData.documento,
      nombre: formData.nombre,
      estudiante: estudianteElegido,
      docente: registroPendiente.docente || null,
      milabRoles: registroPendiente.milabRoles || [],
    });

    const refreshed = await fetchUserByEmail(formData.correo);
    await regenerateSession(req);
    if (req.session) {
      req.session.user = buildSessionUser(refreshed);
      startSessionLifetime(req.session);
      req.session.microsoftProfile = null;
      req.session.registroPendiente = null;
    }

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
