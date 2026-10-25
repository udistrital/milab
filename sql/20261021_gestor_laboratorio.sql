SET search_path TO milab;

BEGIN;

INSERT INTO rol (nombre, activo)
VALUES ('gestor_laboratorio', TRUE)
ON CONFLICT (nombre)
DO UPDATE SET activo = TRUE,
              fecha_modificacion = CURRENT_TIMESTAMP;

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index, activo)
SELECT
    'secondary',
    parent.id,
    'Gestores de laboratorio',
    '/milab/api/gestores_laboratorio',
    'bi-person-gear',
    4,
    TRUE
FROM menu_item parent
WHERE parent.section = 'secondary'
  AND parent.label = 'Registro'
  AND parent.parent_id IS NULL
ON CONFLICT (section, parent_id, label, route)
DO UPDATE SET activo = TRUE,
              fecha_modificacion = CURRENT_TIMESTAMP;

INSERT INTO rol_permiso (rol_id, menu_item_id, can_view, can_use, activo)
SELECT r.id, mi.id, TRUE, TRUE, TRUE
FROM rol r
JOIN menu_item mi
  ON mi.route = '/milab/api/gestores_laboratorio'
WHERE r.nombre = 'admin'
ON CONFLICT (rol_id, menu_item_id)
DO UPDATE SET can_view = TRUE,
              can_use = TRUE,
              activo = TRUE,
              fecha_modificacion = CURRENT_TIMESTAMP;

INSERT INTO rol_permiso (rol_id, menu_item_id, can_view, can_use, activo)
SELECT r.id, mi.id, TRUE, TRUE, TRUE
FROM rol r
JOIN menu_item mi
  ON mi.section = 'secondary'
 AND mi.label = 'Encuentros'
 AND mi.parent_id IS NULL
WHERE r.nombre = 'gestor_laboratorio'
ON CONFLICT (rol_id, menu_item_id)
DO UPDATE SET can_view = TRUE,
              can_use = TRUE,
              activo = TRUE,
              fecha_modificacion = CURRENT_TIMESTAMP;

INSERT INTO rol_permiso (rol_id, menu_item_id, can_view, can_use, activo)
SELECT r.id, mi.id, TRUE, TRUE, TRUE
FROM rol r
JOIN menu_item mi
  ON mi.route = '/milab/encuentros/gestion'
WHERE r.nombre = 'gestor_laboratorio'
ON CONFLICT (rol_id, menu_item_id)
DO UPDATE SET can_view = TRUE,
              can_use = TRUE,
              activo = TRUE,
              fecha_modificacion = CURRENT_TIMESTAMP;

COMMIT;
