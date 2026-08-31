const pool = require('../../libs/db');
const { resolveCoordinatorScope } = require('../../libs/faculty-scope');
const {
  getPrestamosModuleAccess,
  removePrestamosNavigation,
} = require('../../libs/prestamos-module-access');
const { formatRoleLabel, getPrimaryRole, normalizeRoles } = require('../../libs/roles');
const { getMenuForRoles } = require('../../libs/menu');

function createLink(label, href, icon) {
  return { label, href, icon };
}

function createGroup(title, icon, items) {
  return { title, icon, items };
}

function normalizeHoursValue(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }
  return numeric;
}

async function getStudentMonthlyUsageSummary(user) {
  const roles = normalizeRoles(user?.roles || user?.tipo);
  if (!user?.id || !roles.includes('estudiante')) {
    return null;
  }

  try {
    const [limitsResult, loansResult, practicesResult] = await Promise.all([
      pool.query(
        `
          SELECT max_horas_mes_practica_libre, max_horas_mes_prestamos
          FROM parametrizacion
          WHERE id = 1
          LIMIT 1
        `
      ),
      pool.query(
        `
          SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (fecha_fin - fecha_inicio)) / 3600), 0) AS horas
          FROM solicitud_prestamo
          WHERE usuario_id = $1
            AND estado NOT IN ('cancelado', 'rechazado')
            AND fecha_inicio >= date_trunc('month', CURRENT_TIMESTAMP)
            AND fecha_inicio < date_trunc('month', CURRENT_TIMESTAMP) + interval '1 month'
        `,
        [user.id]
      ),
      pool.query(
        `
          SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (fecha_fin - fecha_inicio)) / 3600), 0) AS horas
          FROM reserva_practica
          WHERE usuario_id = $1
            AND tipo_practica = 'libre'
            AND estado NOT IN ('cancelada', 'rechazada')
            AND fecha_inicio >= date_trunc('month', CURRENT_TIMESTAMP)
            AND fecha_inicio < date_trunc('month', CURRENT_TIMESTAMP) + interval '1 month'
        `,
        [user.id]
      ),
    ]);

    const limits = limitsResult.rows[0] || {};
    const loanLimit = normalizeHoursValue(limits.max_horas_mes_prestamos);
    const freePracticeLimit = normalizeHoursValue(limits.max_horas_mes_practica_libre);
    const loanUsed = normalizeHoursValue(loansResult.rows[0]?.horas);
    const freePracticeUsed = normalizeHoursValue(practicesResult.rows[0]?.horas);

    function buildUsageItem(label, used, limit, icon) {
      const hasLimit = limit > 0;
      const remaining = hasLimit ? Math.max(limit - used, 0) : null;
      const percentage = hasLimit ? Math.min((used / limit) * 100, 100) : 0;

      return {
        label,
        icon,
        used,
        limit,
        hasLimit,
        remaining,
        percentage,
      };
    }

    return {
      items: [
        buildUsageItem('Practicas libres', freePracticeUsed, freePracticeLimit, 'bi-journal-check'),
        buildUsageItem('Prestamos de equipos', loanUsed, loanLimit, 'bi-box-seam'),
      ],
    };
  } catch {
    return null;
  }
}

function ensureCoordinatorSignatureAccountLink(navigation, roles) {
  const normalizedRoles = normalizeRoles(roles);
  if (!normalizedRoles.includes('coordinador')) {
    return navigation;
  }

  const accountLinks = Array.isArray(navigation.accountLinks) ? [...navigation.accountLinks] : [];
  const signatureHref = '/milab/prestamos/coordinador/firma';
  const hasExistingLink = accountLinks.some((item) => item?.href === signatureHref);

  if (!hasExistingLink) {
    const signatureLink = createLink('Firma del coordinador', signatureHref, 'bi-pen');
    const profileIndex = accountLinks.findIndex((item) => item?.href === '/milab/api/profile');

    if (profileIndex >= 0) {
      accountLinks.splice(profileIndex, 0, signatureLink);
    } else {
      accountLinks.push(signatureLink);
    }
  }

  return {
    ...navigation,
    accountLinks,
  };
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
    primaryLinks.push(createLink('Prestamos', '/milab/prestamos/', 'bi-box-seam'));

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
        createLink('Menus y accesos', '/milab/api/admin/menus', 'bi-ui-checks-grid'),
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
    primaryLinks.push(createLink('Monitoreo', '/milab/api/dashboard', 'bi-activity'));
    primaryLinks.push(
      createLink('Autorizaciones', '/milab/api/aprobacion_multa', 'bi-clipboard2-check')
    );
    primaryLinks.push(createLink('Prestamos', '/milab/prestamos/', 'bi-box-seam'));

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
    primaryLinks.push(createLink('Monitoreo', '/milab/api/dashboard', 'bi-activity'));
    primaryLinks.push(createLink('Prestamos', '/milab/prestamos/', 'bi-box-seam'));
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

  if (role === 'monitor') {
    primaryLinks.push(createLink('Prestamos', '/milab/prestamos/', 'bi-box-seam'));
  }

  if (role === 'estudiante') {
    primaryLinks.push(
      createLink('Solicitar certificado', '/milab/api/get-data1/verificacion', 'bi-patch-check')
    );
    primaryLinks.push(createLink('Prestamos', '/milab/prestamos/', 'bi-box-seam'));
  }

  if (role === 'docente') {
    primaryLinks.push(
      createLink(
        'Solicitar certificado',
        '/milab/api/verifica_multa_docente/verificacion',
        'bi-patch-check'
      )
    );
    primaryLinks.push(createLink('Prestamos', '/milab/prestamos/', 'bi-box-seam'));
  }

  if (isAuthenticated) {
    accountLinks.push(createLink('Perfil', '/milab/api/profile', 'bi-person-circle'));
  }

  return ensureCoordinatorSignatureAccountLink(
    {
      isAuthenticated,
      role,
      roleLabel: formatRoleLabel(role),
      primaryLinks,
      secondaryGroups,
      accountLinks,
    },
    role
  );
}

async function getPendingSanctionsCount(user, role) {
  if (!user || role !== 'coordinador') return 0;

  const scope = await resolveCoordinatorScope(pool, user.documento);

  if (!scope.coordinatorDocument || scope.facultyIds.length === 0) {
    return 0;
  }

  const result = await pool.query(
    `SELECT COUNT(*)::int AS total
    FROM multa m
     INNER JOIN ual u ON u.ual_id = m.ual_id
     WHERE m.con_estado_multa IN ('Pendiente', 'POR SALDAR')
       AND u.facultad_id = ANY($1::int[])`,
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

  let accessInfo;
  try {
    accessInfo = await getPrestamosModuleAccess(user);
  } catch {
    accessInfo = null;
  }

  try {
    const menu = await getMenuForRoles(roles);
    const hasMenu =
      menu.primaryLinks.length || menu.secondaryGroups.length || menu.accountLinks.length;

    if (hasMenu) {
      const filteredMenu =
        accessInfo?.blocked && ['coordinador', 'laboratorista', 'monitor'].includes(accessInfo.role)
          ? removePrestamosNavigation(menu)
          : menu;
      return ensureCoordinatorSignatureAccountLink(
        {
          isAuthenticated,
          role: getPrimaryRole(roles),
          roleLabel: formatRoleLabel(roles),
          ...filteredMenu,
        },
        roles
      );
    }
  } catch {
    const fallback = buildStaticNavigation({ tipo: getPrimaryRole(roles) });
    const filteredFallback =
      accessInfo?.blocked && ['coordinador', 'laboratorista', 'monitor'].includes(accessInfo.role)
        ? removePrestamosNavigation(fallback)
        : fallback;
    return {
      ...filteredFallback,
      roleLabel: formatRoleLabel(roles),
    };
  }

  const fallback = buildStaticNavigation({ tipo: getPrimaryRole(roles) });
  const filteredFallback =
    accessInfo?.blocked && ['coordinador', 'laboratorista', 'monitor'].includes(accessInfo.role)
      ? removePrestamosNavigation(fallback)
      : fallback;
  return {
    ...filteredFallback,
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
    const studentUsageSummary = await getStudentMonthlyUsageSummary(sessionUser);

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
    res.locals.studentUsageSummary = studentUsageSummary;

    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  buildNavigation,
  navigationMiddleware,
};
