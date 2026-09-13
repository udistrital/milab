const pool = require('../../libs/db');
const { normalizeRoles } = require('../../libs/roles');
const { renderAuthError } = require('./auth');

function sanitizePath(pathname) {
  if (!pathname) return '';
  return pathname.split('?')[0];
}

const publicApiAllowlist = [
  { prefix: '/milab/api/login/login', methods: ['POST'], allowSubpaths: false },
  { prefix: '/milab/api/register', methods: ['POST'], allowSubpaths: true },
  { prefix: '/milab/api/consulta-invit', methods: ['GET', 'POST'], allowSubpaths: false },
  { prefix: '/milab/api/get-data1', methods: ['POST'], allowSubpaths: false },
  { prefix: '/milab/api/get-data2', methods: ['POST'], allowSubpaths: false },
  { prefix: '/milab/api/check-services', methods: ['GET'], allowSubpaths: false },
  { prefix: '/milab/api/register_labs/verify_token', methods: ['GET'], allowSubpaths: false },
  { prefix: '/milab/api/register_labs/new', methods: ['GET'], allowSubpaths: false },
];

function isPublicApiPath(requestPath, method) {
  return publicApiAllowlist.some((rule) => {
    if (!rule.methods.includes(method)) return false;

    if (rule.allowSubpaths) {
      return requestPath === rule.prefix || requestPath.startsWith(`${rule.prefix}/`);
    }

    return requestPath === rule.prefix;
  });
}

async function menuPermissionMiddleware(req, res, next) {
  try {
    const path = sanitizePath(req.originalUrl);
    const method = String(req.method || 'GET').toUpperCase();
    const allowProfileFlow =
      req.session?.microsoftProfile &&
      (path === '/milab/api/profile' || path === '/milab/api/profile/identify');

    if (allowProfileFlow) {
      return next();
    }
    const candidates = [path];

    if (!path.endsWith('/load_info')) {
      candidates.push(`${path}/load_info`);
    }

    candidates.push(path.replace(/\/(verify_token|token)$/i, '/load_info'));

    const menuResult = await pool.query(
      `
        SELECT id
        FROM menu_item
        WHERE route = ANY($1)
          AND activo = TRUE
        LIMIT 1
      `,
      [candidates]
    );

    if (!menuResult.rows.length) {
      const isPrivateApiNavigationRequest =
        path.startsWith('/milab/api/') && (method === 'GET' || method === 'HEAD');

      if (isPrivateApiNavigationRequest && !isPublicApiPath(path, method)) {
        return renderAuthError(res, {
          message: 'Acceso denegado',
          message2: 'No tienes permisos para esta ruta.',
          limit: 'loginOnly',
        });
      }

      return next();
    }

    const user = req.session?.user;
    if (!user) {
      return renderAuthError(res, {
        message: 'Acceso denegado',
        message2: 'Debe iniciar sesion para continuar.',
        limit: 'loginOnly',
      });
    }

    const roles = normalizeRoles(user.roles || user.tipo);
    if (!roles.length) {
      return renderAuthError(res, {
        message: 'Acceso denegado',
        message2: 'No tienes permisos para este modulo.',
        limit: 'loginOnly',
      });
    }

    const menuId = menuResult.rows[0].id;
    const permissionResult = await pool.query(
      `
        SELECT 1
        FROM rol_permiso rp
        JOIN rol r ON r.id = rp.rol_id
        WHERE rp.menu_item_id = $1
          AND rp.can_view = TRUE
          AND r.nombre = ANY($2)
        LIMIT 1
      `,
      [menuId, roles]
    );

    if (!permissionResult.rows.length) {
      return renderAuthError(res, {
        message: 'Acceso denegado',
        message2: 'No tienes permisos para este modulo.',
        limit: 'loginOnly',
      });
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  menuPermissionMiddleware,
};
