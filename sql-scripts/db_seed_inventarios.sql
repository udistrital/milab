SET search_path TO milab;

BEGIN;

UPDATE menu_item
SET activo = FALSE
WHERE route IN ('/milab/prestamos/inventario', '/milab/prestamos/equipos');

INSERT INTO menu_item (section, label, icon, order_index, activo)
SELECT 'secondary', 'Inventarios', 'bi-boxes', 6, TRUE
WHERE NOT EXISTS (
    SELECT 1
    FROM menu_item
    WHERE section = 'secondary'
      AND parent_id IS NULL
      AND label = 'Inventarios'
);

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index, activo)
SELECT 'secondary', parent.id, 'Gestión del inventario',
       '/milab/inventarios/gestion_inventario', 'bi-box-seam', 1, TRUE
FROM menu_item parent
WHERE parent.section = 'secondary'
  AND parent.parent_id IS NULL
  AND parent.label = 'Inventarios'
ON CONFLICT DO NOTHING;

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index, activo)
SELECT 'secondary', parent.id, 'Aprobaciones de inventario',
       '/milab/inventarios/aprobaciones', 'bi-clipboard-check', 2, TRUE
FROM menu_item parent
WHERE parent.section = 'secondary'
  AND parent.parent_id IS NULL
  AND parent.label = 'Inventarios'
ON CONFLICT DO NOTHING;

INSERT INTO rol_permiso (rol_id, menu_item_id, can_view, can_use, activo)
SELECT r.id, mi.id, TRUE, r.nombre <> 'coordinador_general', TRUE
FROM rol r
JOIN menu_item mi
  ON mi.section = 'secondary'
 AND mi.parent_id IS NULL
 AND mi.label = 'Inventarios'
WHERE r.nombre IN ('admin', 'coordinador_general', 'laboratorista', 'coordinador')
ON CONFLICT (rol_id, menu_item_id)
DO UPDATE SET can_view = EXCLUDED.can_view,
              can_use = EXCLUDED.can_use,
              activo = EXCLUDED.activo,
              fecha_modificacion = CURRENT_TIMESTAMP;

UPDATE menu_item
SET activo = TRUE
WHERE route IN (
    '/milab/inventarios/gestion_inventario',
    '/milab/inventarios/aprobaciones'
);

INSERT INTO rol_permiso (rol_id, menu_item_id, can_view, can_use, activo)
SELECT r.id, mi.id, TRUE, r.nombre <> 'coordinador_general', TRUE
FROM rol r
JOIN menu_item mi
  ON mi.route = '/milab/inventarios/gestion_inventario'
WHERE r.nombre IN ('admin', 'coordinador_general', 'laboratorista', 'coordinador')
ON CONFLICT (rol_id, menu_item_id)
DO UPDATE SET can_view = EXCLUDED.can_view,
              can_use = EXCLUDED.can_use,
              activo = EXCLUDED.activo,
              fecha_modificacion = CURRENT_TIMESTAMP;

INSERT INTO rol_permiso (rol_id, menu_item_id, can_view, can_use, activo)
SELECT r.id, mi.id, TRUE, r.nombre <> 'coordinador_general', TRUE
FROM rol r
JOIN menu_item mi
  ON mi.route = '/milab/inventarios/aprobaciones'
WHERE r.nombre IN ('admin', 'coordinador_general', 'coordinador')
ON CONFLICT (rol_id, menu_item_id)
DO UPDATE SET can_view = EXCLUDED.can_view,
              can_use = EXCLUDED.can_use,
              activo = EXCLUDED.activo,
              fecha_modificacion = CURRENT_TIMESTAMP;

COMMIT;
