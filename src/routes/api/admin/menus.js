const express = require('express');
const pool = require('../../../libs/db');
const {
  listPrestamosFacultyAccess,
  updatePrestamosFacultyAccess,
} = require('../../../libs/prestamos-module-access');
const { requireRoles } = require('../../middlewares/auth');

const router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: true }));

const requireAdmin = requireRoles('admin', {
  message: 'Acceso denegado',
  message2: 'Solo los administradores pueden gestionar los menus.',
  limit: 'loginOnly',
});

async function loadMenuData() {
  const roles = (await pool.query('SELECT id, nombre AS name FROM rol ORDER BY nombre')).rows;
  const menuItems = (
    await pool.query(
      `
        SELECT mi.id,
               mi.parent_id,
               mi.section,
               mi.label,
               mi.route,
               mi.icon,
               mi.order_index,
               mi.activo AS is_active,
               parent.label AS parent_label
        FROM menu_item mi
        LEFT JOIN menu_item parent ON parent.id = mi.parent_id
        ORDER BY mi.section, mi.parent_id NULLS FIRST, mi.order_index, mi.label
      `
    )
  ).rows;

  const permissions = (
    await pool.query('SELECT rol_id AS role_id, menu_item_id, can_view, can_use FROM rol_permiso')
  ).rows;

  return { roles, menuItems, permissions };
}

function sanitizeText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

async function registerPrestamosAccessAudit(req, facultyName, role, permitido) {
  const user = req.session?.user || {};
  const actor = sanitizeText(user?.tipo) || 'admin';
  const document = sanitizeText(user?.documento_real || user?.documento) || '0';
  const normalizedRole = role === 'laboratorista' ? 'laboratorista' : 'coordinador';
  const action = permitido
    ? 'Habilitar Modulo Prestamos por Facultad'
    : 'Bloquear Modulo Prestamos por Facultad';
  const person = `${facultyName || 'Facultad'} - ${normalizedRole}`;

  try {
    await pool.query(
      `
        INSERT INTO log (nombre, documento, accion, persona)
        VALUES ($1, $2, $3, $4)
      `,
      [actor, document, action, person]
    );
  } catch (error) {
    console.error('Error registrando auditoria de acceso a prestamos:', error);
  }
}

router.get('/', requireAdmin, async (req, res) => {
  try {
    const [{ roles, menuItems, permissions }, prestamosFacultyAccess] = await Promise.all([
      loadMenuData(),
      listPrestamosFacultyAccess(),
    ]);

    return res.render('home/admin_menus', {
      roles,
      menuItems,
      permissions,
      prestamosFacultyAccess,
      error: null,
      success: null,
    });
  } catch (error) {
    console.error('Error cargando menus:', error);
    return res.render('home/message_error', {
      message: '¡Algo ha salido mal!',
      message2: 'No fue posible cargar los menus.',
      limit: null,
    });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  const {
    section,
    label,
    route,
    icon,
    parent_id: parentIdRaw,
    order_index: orderIndexRaw,
    is_active: isActiveRaw,
  } = req.body;

  if (!section || !label) {
    const [{ roles, menuItems, permissions }, prestamosFacultyAccess] = await Promise.all([
      loadMenuData(),
      listPrestamosFacultyAccess(),
    ]);
    return res.render('home/admin_menus', {
      roles,
      menuItems,
      permissions,
      prestamosFacultyAccess,
      error: 'Seccion y etiqueta son obligatorias.',
      success: null,
    });
  }

  const parentId = parentIdRaw ? Number(parentIdRaw) : null;
  const orderIndex = orderIndexRaw ? Number(orderIndexRaw) : 0;
  const isActive = isActiveRaw === 'on' || isActiveRaw === true;

  try {
    await pool.query(
      `
        INSERT INTO menu_item (section, parent_id, label, route, icon, order_index, activo)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (section, parent_id, label, route) DO NOTHING
      `,
      [section, parentId, label, route || null, icon || null, orderIndex, isActive]
    );

    const [{ roles, menuItems, permissions }, prestamosFacultyAccess] = await Promise.all([
      loadMenuData(),
      listPrestamosFacultyAccess(),
    ]);
    return res.render('home/admin_menus', {
      roles,
      menuItems,
      permissions,
      prestamosFacultyAccess,
      error: null,
      success: 'Menu creado o actualizado.',
    });
  } catch (error) {
    console.error('Error creando menu:', error);
    const [{ roles, menuItems, permissions }, prestamosFacultyAccess] = await Promise.all([
      loadMenuData(),
      listPrestamosFacultyAccess(),
    ]);
    return res.render('home/admin_menus', {
      roles,
      menuItems,
      permissions,
      prestamosFacultyAccess,
      error: 'No fue posible crear el menu.',
      success: null,
    });
  }
});

router.post('/permissions', requireAdmin, async (req, res) => {
  const { role_id: roleIdRaw, menu_item_id: menuItemIdRaw, enabled } = req.body;
  const roleId = Number(roleIdRaw);
  const menuItemId = Number(menuItemIdRaw);
  const isEnabled = enabled === true || enabled === 'true' || enabled === 'on' || enabled === 1;

  if (!roleId || !menuItemId) {
    return res.status(400).json({ ok: false, message: 'Parametros invalidos.' });
  }

  try {
    if (isEnabled) {
      await pool.query(
        `
          INSERT INTO rol_permiso (rol_id, menu_item_id, can_view, can_use)
          VALUES ($1, $2, TRUE, TRUE)
          ON CONFLICT (rol_id, menu_item_id) DO UPDATE
          SET can_view = TRUE, can_use = TRUE
        `,
        [roleId, menuItemId]
      );
    } else {
      await pool.query('DELETE FROM rol_permiso WHERE rol_id = $1 AND menu_item_id = $2', [
        roleId,
        menuItemId,
      ]);
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error('Error actualizando permisos:', error);
    return res.status(500).json({ ok: false, message: 'No fue posible actualizar permisos.' });
  }
});

router.post('/prestamos-access', requireAdmin, async (req, res) => {
  const facultadId = Number(req.body?.facultad_id);
  const role = sanitizeText(req.body?.role).toLowerCase();
  const enabledRaw = req.body?.enabled;
  const permitido =
    enabledRaw === true || enabledRaw === 'true' || enabledRaw === 'on' || enabledRaw === 1;

  if (!Number.isInteger(facultadId) || facultadId <= 0) {
    return res.status(400).json({ ok: false, message: 'La facultad es invalida.' });
  }

  if (!['coordinador', 'laboratorista'].includes(role)) {
    return res.status(400).json({ ok: false, message: 'El rol es invalido.' });
  }

  try {
    const facultyResult = await pool.query(
      `
        SELECT nombre
        FROM facultad
        WHERE facultad_id = $1
          AND activo = TRUE
        LIMIT 1
      `,
      [facultadId]
    );

    const facultyName = facultyResult.rows[0]?.nombre;
    if (!facultyName) {
      return res.status(404).json({ ok: false, message: 'La facultad no existe.' });
    }

    await updatePrestamosFacultyAccess(
      {
        facultadId,
        role,
        permitido,
      },
      pool
    );

    await registerPrestamosAccessAudit(req, facultyName, role, permitido);

    return res.json({ ok: true });
  } catch (error) {
    console.error('Error actualizando acceso a prestamos por facultad:', error);
    return res.status(500).json({
      ok: false,
      message: 'No fue posible actualizar el acceso al modulo de prestamos.',
    });
  }
});

module.exports = router;
