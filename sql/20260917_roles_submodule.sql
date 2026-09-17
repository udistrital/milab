BEGIN;

INSERT INTO rol (nombre)
VALUES ('coordinador_general')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Roles', '/milab/api/admin/roles', 'bi-people', 2
FROM menu_item parent
WHERE parent.section = 'secondary'
  AND parent.label = 'Configuración'
  AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO rol_permiso (rol_id, menu_item_id, can_view, can_use)
SELECT r.id, mi.id, TRUE, TRUE
FROM rol r
JOIN menu_item mi
  ON mi.section = 'secondary'
 AND mi.label = 'Roles'
 AND mi.route = '/milab/api/admin/roles'
WHERE r.nombre = 'admin'
ON CONFLICT (rol_id, menu_item_id) DO UPDATE
SET can_view = TRUE,
    can_use = TRUE;

WITH role_ref AS (
  SELECT id
  FROM rol
  WHERE nombre = 'coordinador_general'
),
menu_ref AS (
  SELECT id
  FROM menu_item
)
INSERT INTO rol_permiso (rol_id, menu_item_id, can_view, can_use)
SELECT role_ref.id, menu_ref.id, TRUE, FALSE
FROM role_ref
CROSS JOIN menu_ref
ON CONFLICT (rol_id, menu_item_id) DO UPDATE
SET can_view = TRUE,
  can_use = FALSE;

COMMIT;
