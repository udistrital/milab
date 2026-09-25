const express = require('express');

const pool = require('../../../libs/db');
const { normalizeLogDocument } = require('../../../libs/account-email');
const { requireRoles } = require('../../middlewares/auth');
const { renderApplicationError } = require('../../middlewares/error-handler');

const router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: true }));

const SYSTEM_PROTECTED_ROLES = new Set([
  'admin',
  'coordinador_general',
  'coordinador',
  'laboratorista',
  'monitor',
  'docente',
  'estudiante',
]);

const requireAdmin = requireRoles('admin', {
  message: 'Acceso denegado',
  message2: 'Solo los administradores pueden gestionar roles.',
  limit: 'loginOnly',
});

function sanitizeText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function normalizeRoleName(value) {
  return sanitizeText(value).toLowerCase().replace(/\s+/g, '_');
}

function isValidRoleName(value) {
  return /^[a-z][a-z0-9_]{1,39}$/.test(value);
}

function isUniqueViolation(error) {
  return String(error?.code || '') === '23505';
}

function getLogActor(req) {
  const user = req.session?.user || {};
  return {
    nombre: sanitizeText(user.tipo) || 'admin',
    documento: normalizeLogDocument(user.documento_real || user.documento || ''),
  };
}

async function writeRoleAuditLog(req, accion, persona) {
  const actor = getLogActor(req);

  try {
    await pool.query(
      'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
      [actor.nombre, actor.documento, accion, persona || null]
    );
  } catch (error) {
    console.error('Error registrando auditoria de roles:', error);
  }
}

async function loadRolesData() {
  const result = await pool.query(
    `SELECT
       r.id,
       r.nombre,
       COALESCE(user_counts.total, 0)::int AS usuarios_asociados,
       COALESCE(permission_counts.total, 0)::int AS permisos_asociados
     FROM rol r
     LEFT JOIN (
       SELECT usuario_rol.rol_id, COUNT(*) AS total
       FROM usuario_rol
       GROUP BY usuario_rol.rol_id
     ) user_counts
       ON user_counts.rol_id = r.id
     LEFT JOIN (
       SELECT rol_permiso.rol_id, COUNT(*) AS total
       FROM rol_permiso
       GROUP BY rol_permiso.rol_id
     ) permission_counts
       ON permission_counts.rol_id = r.id
     ORDER BY r.nombre ASC`
  );

  return {
    roles: result.rows || [],
  };
}

async function renderRolesPage(req, res, { error = null, success = null } = {}) {
  const data = await loadRolesData();

  return res.render('home/admin_roles', {
    roles: data.roles,
    protectedRoles: Array.from(SYSTEM_PROTECTED_ROLES),
    error,
    success,
  });
}

router.get('/', requireAdmin, async (req, res) => {
  try {
    return await renderRolesPage(req, res);
  } catch (error) {
    console.error('Error cargando modulo de roles:', error);
    return renderApplicationError(
      res,
      {
        message: '¡Algo ha salido mal!',
        message2: 'No fue posible cargar la gestión de roles.',
        limit: null,
      },
      req,
      error
    );
  }
});

router.post('/crear', requireAdmin, async (req, res) => {
  const roleName = normalizeRoleName(req.body?.nombre);

  if (!isValidRoleName(roleName)) {
    return renderRolesPage(req, res, {
      error:
        'Nombre de rol invalido. Usa solo letras minusculas, numeros o guion bajo (2-40 caracteres).',
    });
  }

  try {
    await pool.query('INSERT INTO rol (nombre) VALUES ($1)', [roleName]);
    await writeRoleAuditLog(req, 'Crear rol', roleName);

    return renderRolesPage(req, res, {
      success: `Rol ${roleName} creado correctamente.`,
    });
  } catch (error) {
    console.error('Error creando rol:', error);

    if (isUniqueViolation(error)) {
      return renderRolesPage(req, res, {
        error: `Ya existe un rol con el nombre ${roleName}.`,
      });
    }

    return renderRolesPage(req, res, {
      error: 'No fue posible crear el rol.',
    });
  }
});

router.post('/:id/editar', requireAdmin, async (req, res) => {
  const roleId = Number(req.params.id);
  const roleName = normalizeRoleName(req.body?.nombre);

  if (!Number.isInteger(roleId) || roleId <= 0) {
    return renderRolesPage(req, res, { error: 'El rol seleccionado es invalido.' });
  }

  if (!isValidRoleName(roleName)) {
    return renderRolesPage(req, res, {
      error:
        'Nombre de rol invalido. Usa solo letras minusculas, numeros o guion bajo (2-40 caracteres).',
    });
  }

  try {
    const currentRoleResult = await pool.query('SELECT id, nombre FROM rol WHERE id = $1 LIMIT 1', [
      roleId,
    ]);

    if (!currentRoleResult.rows.length) {
      return renderRolesPage(req, res, {
        error: 'No encontramos el rol que deseas editar.',
      });
    }

    const currentRoleName = String(currentRoleResult.rows[0].nombre || '')
      .trim()
      .toLowerCase();
    if (SYSTEM_PROTECTED_ROLES.has(currentRoleName) && currentRoleName !== roleName) {
      return renderRolesPage(req, res, {
        error: `El rol base ${currentRoleName} no puede renombrarse.`,
      });
    }

    await pool.query('UPDATE rol SET nombre = $1 WHERE id = $2', [roleName, roleId]);
    await writeRoleAuditLog(req, 'Editar rol', `${currentRoleName} -> ${roleName}`);

    return renderRolesPage(req, res, {
      success: `Rol ${roleName} actualizado correctamente.`,
    });
  } catch (error) {
    console.error('Error editando rol:', error);

    if (isUniqueViolation(error)) {
      return renderRolesPage(req, res, {
        error: `Ya existe un rol con el nombre ${roleName}.`,
      });
    }

    return renderRolesPage(req, res, {
      error: 'No fue posible actualizar el rol.',
    });
  }
});

router.post('/:id/eliminar', requireAdmin, async (req, res) => {
  const roleId = Number(req.params.id);

  if (!Number.isInteger(roleId) || roleId <= 0) {
    return renderRolesPage(req, res, { error: 'El rol seleccionado es invalido.' });
  }

  let client;
  try {
    client = await pool.connect();

    const currentRoleResult = await client.query(
      'SELECT id, nombre FROM rol WHERE id = $1 LIMIT 1',
      [roleId]
    );

    if (!currentRoleResult.rows.length) {
      client.release();
      return renderRolesPage(req, res, {
        error: 'No encontramos el rol que deseas eliminar.',
      });
    }

    const currentRoleName = String(currentRoleResult.rows[0].nombre || '')
      .trim()
      .toLowerCase();
    if (SYSTEM_PROTECTED_ROLES.has(currentRoleName)) {
      client.release();
      return renderRolesPage(req, res, {
        error: `El rol base ${currentRoleName} no puede eliminarse.`,
      });
    }

    const assignments = await client.query(
      'SELECT COUNT(*)::int AS total FROM usuario_rol WHERE rol_id = $1',
      [roleId]
    );
    const assignedUsers = assignments.rows[0]?.total || 0;

    if (assignedUsers > 0) {
      client.release();
      return renderRolesPage(req, res, {
        error: `No se puede eliminar el rol ${currentRoleName} porque tiene usuarios asociados.`,
      });
    }

    await client.query('BEGIN');
    await client.query('DELETE FROM rol_permiso WHERE rol_id = $1', [roleId]);
    await client.query('DELETE FROM rol WHERE id = $1', [roleId]);
    await client.query('COMMIT');
    client.release();

    await writeRoleAuditLog(req, 'Eliminar rol', currentRoleName);

    return renderRolesPage(req, res, {
      success: `Rol ${currentRoleName} eliminado correctamente.`,
    });
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error revirtiendo eliminación de rol:', rollbackError);
      }
      client.release();
    }

    console.error('Error eliminando rol:', error);
    return renderRolesPage(req, res, {
      error: 'No fue posible eliminar el rol.',
    });
  }
});

module.exports = router;
