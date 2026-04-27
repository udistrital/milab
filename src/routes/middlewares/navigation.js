const pool = require('../../libs/db');
const { resolveCoordinatorScope } = require('../../libs/faculty-scope');
const { formatRoleLabel, getPrimaryRole, normalizeRoles } = require('../../libs/roles');
const { getMenuForRoles } = require('../../libs/menu');

function createLink(label, href, icon) {
  return { label, href, icon };
}

function createGroup(title, icon, items) {
  return { title, icon, items };
}

function buildStaticNavigation(user) {
  const role = user?.tipo || '';
  const isAuthenticated = Boolean(role);
  const primaryLinks = [];
  const secondaryGroups = [];
  const accountLinks = [];

  if (isAuthenticated) {
    primaryLinks.push(createLink('Inicio', '/milab/inicio', 'bi-house-door'));
  } else {
    primaryLinks.push(createLink('Invitados', '/milab/api/consulta-invit', 'bi-search'));
  }

  if (role === 'admin') {
    primaryLinks.push(createLink('Monitoreo', '/milab/api/dashboard', 'bi-activity'));

    secondaryGroups.push(
      createGroup('Registro', 'bi-person-plus', [
        createLink(
          'Registro de coordinadores',
          '/milab/api/registro_coordinador/load_info',
          'bi-person-badge'
        ),
      ])
    );

    secondaryGroups.push(
      createGroup('Consulta y control', 'bi-grid-1x2', [
        createLink('Certificados', '/milab/api/get_list_estudiantes', 'bi-file-earmark-check'),
        createLink(
          'Consulta masiva',
          '/milab/api/get_list_estudiantes/get_consulta',
          'bi-collection'
        ),
        createLink(
          'Coordinadores registrados',
          '/milab/api/coordinadores_registrados',
          'bi-people'
        ),
        createLink(
          'Estudiantes y docentes registrados',
          '/milab/api/estudiantes_registrados',
          'bi-card-list'
        ),
        createLink('Facultades y UAL', '/milab/api/facultad', 'bi-building'),
        createLink('Logs', '/milab/api/logs', 'bi-journal-text'),
        createLink(
          'Laboratoristas registrados',
          '/milab/api/laboratoristas_registrados',
          'bi-person-workspace'
        ),
        createLink('Agregar admin', '/milab/api/admins/load_info', 'bi-person-gear'),
        createLink('Sanciones', '/milab/api/get_list_multas', 'bi-shield-exclamation'),
      ])
    );

    secondaryGroups.push(
      createGroup('Paz y Salvos', 'bi-patch-check', [
        createLink('Verificar estudiante', '/milab/api/verificar_estudiante', 'bi-person-check'),
        createLink('Verificar docente', '/milab/api/verificar_docente', 'bi-person-vcard'),
      ])
    );
  }

  if (role === 'coordinador') {
    primaryLinks.push(
      createLink('Autorizaciones', '/milab/api/aprobacion_multa', 'bi-clipboard2-check')
    );

    secondaryGroups.push(
      createGroup('Registro', 'bi-person-plus', [
        createLink(
          'Registro de laboratoristas',
          '/milab/api/register_labs/load_info',
          'bi-person-plus'
        ),
      ])
    );

    secondaryGroups.push(
      createGroup('Consulta y control', 'bi-grid-1x2', [
        createLink(
          'Consulta masiva',
          '/milab/api/get_list_estudiantes/get_consulta',
          'bi-collection'
        ),
        createLink(
          'Estudiantes y docentes registrados',
          '/milab/api/estudiantes_registrados',
          'bi-card-list'
        ),
        createLink(
          'Laboratoristas registrados',
          '/milab/api/laboratoristas_registrados',
          'bi-person-workspace'
        ),
        createLink('Sanciones', '/milab/api/get_list_multas', 'bi-shield-exclamation'),
      ])
    );

    secondaryGroups.push(
      createGroup('Paz y Salvos', 'bi-patch-check', [
        createLink('Verificar estudiante', '/milab/api/verificar_estudiante', 'bi-person-check'),
        createLink('Verificar docente', '/milab/api/verificar_docente', 'bi-person-vcard'),
      ])
    );
  }

  if (role === 'laboratorista') {
    secondaryGroups.push(
      createGroup('Consultas', 'bi-search', [
        createLink(
          'Consulta masiva',
          '/milab/api/get_list_estudiantes/get_consulta',
          'bi-collection'
        ),
        createLink('Sanciones', '/milab/api/get_list_multas', 'bi-shield-exclamation'),
      ])
    );

    secondaryGroups.push(
      createGroup('Administración', 'bi-sliders', [
        createLink('Sanciones de estudiantes', '/milab/api/get-info-multa/get', 'bi-mortarboard'),
        createLink(
          'Sanciones de docentes',
          '/milab/api/get-info-multa-docente/get',
          'bi-person-lines-fill'
        ),
      ])
    );

    secondaryGroups.push(
      createGroup('Paz y Salvos', 'bi-patch-check', [
        createLink('Verificar estudiante', '/milab/api/verificar_estudiante', 'bi-person-check'),
        createLink('Verificar docente', '/milab/api/verificar_docente', 'bi-person-vcard'),
      ])
    );
  }

  if (role === 'estudiante') {
    primaryLinks.push(
      createLink('Solicitar certificado', '/milab/api/get-data1/verificacion', 'bi-patch-check')
    );
  }

  if (role === 'docente') {
    primaryLinks.push(
      createLink(
        'Solicitar certificado',
        '/milab/api/verifica_multa_docente/verificacion',
        'bi-patch-check'
      )
    );
  }

  if (isAuthenticated) {
    accountLinks.push(createLink('Perfil', '/milab/api/profile', 'bi-person-circle'));
  }

  return {
    isAuthenticated,
    role,
    roleLabel: formatRoleLabel(role),
    primaryLinks,
    secondaryGroups,
    accountLinks,
  };
}

async function getPendingSanctionsCount(user, role) {
  if (!user || role !== 'coordinador') return 0;

  const scope = await resolveCoordinatorScope(pool, user.documento);

  if (!scope.coordinatorDocument || scope.facultyIds.length === 0) {
    return 0;
  }

  const result = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM multas m
     INNER JOIN ual u ON m.ual = u.nombre
     WHERE m.con_estado_multa IN ('Pendiente', 'POR SALDAR')
       AND u.id_facultad = ANY($1::int[])`,
    [scope.facultyIds]
  );

  return result.rows[0]?.total || 0;
}

async function buildNavigation(user) {
  const roles = normalizeRoles(user?.roles || user?.tipo);
  const isAuthenticated = roles.length > 0;

  if (!isAuthenticated) {
    return {
      isAuthenticated,
      role: '',
      roleLabel: 'Invitado',
      primaryLinks: [createLink('Invitados', '/milab/api/consulta-invit', 'bi-search')],
      secondaryGroups: [],
      accountLinks: [],
    };
  }

  try {
    const menu = await getMenuForRoles(roles);
    const hasMenu =
      menu.primaryLinks.length || menu.secondaryGroups.length || menu.accountLinks.length;

    if (hasMenu) {
      return {
        isAuthenticated,
        role: getPrimaryRole(roles),
        roleLabel: formatRoleLabel(roles),
        ...menu,
      };
    }
  } catch {
    // Fallback to static navigation when DB is unavailable.
  }

  const fallback = buildStaticNavigation({ tipo: getPrimaryRole(roles) });
  return {
    ...fallback,
    roleLabel: formatRoleLabel(roles),
  };
}

async function navigationMiddleware(req, res, next) {
  try {
    const sessionUser = req.session?.user || null;
    const navigation = await buildNavigation(sessionUser);
    const roles = normalizeRoles(sessionUser?.roles || sessionUser?.tipo);
    const primaryRole = getPrimaryRole(roles);
    const pendingSanctionsCount = await getPendingSanctionsCount(sessionUser, primaryRole);

    if (sessionUser) {
      Object.assign(res.locals, sessionUser);
    }

    res.locals.user = sessionUser;
    res.locals.roles = roles;
    res.locals.tipo = primaryRole;
    res.locals.documento = sessionUser?.documento || '';
    res.locals.appNavigation = navigation;
    res.locals.isAuthenticated = navigation.isAuthenticated;
    res.locals.sessionRoleLabel = navigation.roleLabel;
    res.locals.pendingSanctionsCount = pendingSanctionsCount;

    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  buildNavigation,
  navigationMiddleware,
};
