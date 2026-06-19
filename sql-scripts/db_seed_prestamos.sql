SET search_path TO milab;

INSERT INTO menu_item (section, label, icon, order_index)
SELECT 'secondary', 'Prestamos', 'bi-box-seam', 7
WHERE NOT EXISTS (
    SELECT 1 FROM menu_item WHERE section = 'secondary' AND label = 'Prestamos' AND parent_id IS NULL
);

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Inventario', '/milab/prestamos/inventario', 'bi-box-seam', 1
FROM menu_item parent
WHERE parent.section = 'secondary' AND parent.label = 'Prestamos' AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Equipos', '/milab/prestamos/equipos', 'bi-pc-display', 2
FROM menu_item parent
WHERE parent.section = 'secondary' AND parent.label = 'Prestamos' AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Solicitar equipo', '/milab/prestamos/solicitar', 'bi-clipboard-check', 3
FROM menu_item parent
WHERE parent.section = 'secondary' AND parent.label = 'Prestamos' AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Mis solicitudes', '/milab/prestamos/mis-solicitudes', 'bi-list-check', 4
FROM menu_item parent
WHERE parent.section = 'secondary' AND parent.label = 'Prestamos' AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Gestion de solicitudes', '/milab/prestamos/gestion-solicitudes', 'bi-clipboard-data', 5
FROM menu_item parent
WHERE parent.section = 'secondary' AND parent.label = 'Prestamos' AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Entrega y devolucion', '/milab/prestamos/entrega-equipos', 'bi-box-arrow-left', 6
FROM menu_item parent
WHERE parent.section = 'secondary' AND parent.label = 'Prestamos' AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Incidencias', '/milab/prestamos/incidencias', 'bi-bug', 7
FROM menu_item parent
WHERE parent.section = 'secondary' AND parent.label = 'Prestamos' AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Solicitar practica', '/milab/prestamos/practicas/solicitar', 'bi-journal-plus', 8
FROM menu_item parent
WHERE parent.section = 'secondary' AND parent.label = 'Prestamos' AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Mis practicas', '/milab/prestamos/practicas/mis-reservas', 'bi-journal-check', 9
FROM menu_item parent
WHERE parent.section = 'secondary' AND parent.label = 'Prestamos' AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Gestion de practicas', '/milab/prestamos/practicas/gestion', 'bi-journal-text', 10
FROM menu_item parent
WHERE parent.section = 'secondary' AND parent.label = 'Prestamos' AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Salas', '/milab/prestamos/salas', 'bi-door-open', 11
FROM menu_item parent
WHERE parent.section = 'secondary' AND parent.label = 'Prestamos' AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Reportes', '/milab/prestamos/reportes', 'bi-bar-chart-line', 12
FROM menu_item parent
WHERE parent.section = 'secondary' AND parent.label = 'Prestamos' AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Auditoria', '/milab/prestamos/auditoria', 'bi-journal-check', 13
FROM menu_item parent
WHERE parent.section = 'secondary' AND parent.label = 'Prestamos' AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;

UPDATE menu_item
SET order_index = 13,
    icon = 'bi-journal-check'
WHERE section = 'secondary'
    AND route = '/milab/prestamos/auditoria';

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Parametrizaciones', '/milab/prestamos/admin/parametrizaciones', 'bi-sliders', 14
FROM menu_item parent
WHERE parent.section = 'secondary' AND parent.label = 'Prestamos' AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;

UPDATE menu_item
SET order_index = 14,
    icon = 'bi-sliders'
WHERE section = 'secondary'
    AND route = '/milab/prestamos/admin/parametrizaciones';

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Configuracion de practicas', '/milab/prestamos/coordinador/practicas/config', 'bi-gear', 15
FROM menu_item parent
WHERE parent.section = 'secondary' AND parent.label = 'Prestamos' AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;

UPDATE menu_item
SET label = 'Configuracion de practicas',
    order_index = 15,
    icon = 'bi-gear'
WHERE section = 'secondary'
    AND route = '/milab/prestamos/coordinador/practicas/config'
    AND label IN ('Config practicas', 'Configuracion de practicas');

INSERT INTO parametrizacion (id, max_horas_mes_practica_libre, max_horas_mes_prestamos)
VALUES (1, 0, 0)
ON CONFLICT (id) DO NOTHING;

DELETE FROM rol_permiso rp
USING rol r, menu_item mi
WHERE rp.rol_id = r.id
    AND rp.menu_item_id = mi.id
    AND r.nombre IN ('admin', 'coordinador', 'laboratorista')
    AND mi.section = 'secondary'
    AND mi.label IN ('Solicitar equipo', 'Mis solicitudes');

DELETE FROM rol_permiso rp
USING menu_item mi
WHERE rp.menu_item_id = mi.id
    AND mi.section = 'secondary'
    AND mi.label = 'Gestion de solicitudes'
    AND mi.route = '/milab/prestamos/gestion-solicitudes';

DELETE FROM rol_permiso rp
USING menu_item mi
WHERE rp.menu_item_id = mi.id
    AND mi.section = 'secondary'
    AND mi.label = 'Entrega y devolucion'
    AND mi.route = '/milab/prestamos/entrega-equipos';

DELETE FROM rol_permiso rp
USING menu_item mi
WHERE rp.menu_item_id = mi.id
    AND mi.section = 'secondary'
    AND mi.label = 'Incidencias'
    AND mi.route = '/milab/prestamos/incidencias';

DELETE FROM rol_permiso rp
USING rol r, menu_item mi
WHERE rp.rol_id = r.id
    AND rp.menu_item_id = mi.id
    AND r.nombre IN ('admin', 'coordinador', 'laboratorista')
    AND mi.section = 'secondary'
    AND mi.label IN ('Solicitar practica', 'Mis practicas');

DELETE FROM rol_permiso rp
USING menu_item mi
WHERE rp.menu_item_id = mi.id
    AND mi.section = 'secondary'
    AND mi.label = 'Gestion de practicas'
    AND mi.route = '/milab/prestamos/practicas/gestion';

DELETE FROM rol_permiso rp
USING menu_item mi
WHERE rp.menu_item_id = mi.id
    AND mi.section = 'secondary'
    AND mi.label = 'Salas'
    AND mi.route = '/milab/prestamos/salas';

DELETE FROM rol_permiso rp
USING menu_item mi
WHERE rp.menu_item_id = mi.id
    AND mi.section = 'secondary'
    AND mi.label = 'Reportes'
    AND mi.route = '/milab/prestamos/reportes';

DELETE FROM rol_permiso rp
USING menu_item mi
WHERE rp.menu_item_id = mi.id
    AND mi.section = 'secondary'
    AND mi.label = 'Auditoria'
    AND mi.route = '/milab/prestamos/auditoria';

DELETE FROM rol_permiso rp
USING menu_item mi
WHERE rp.menu_item_id = mi.id
    AND mi.section = 'secondary'
    AND mi.label = 'Parametrizaciones'
    AND mi.route = '/milab/prestamos/admin/parametrizaciones';

DELETE FROM rol_permiso rp
USING menu_item mi
WHERE rp.menu_item_id = mi.id
    AND mi.section = 'secondary'
    AND mi.label IN ('Config practicas', 'Configuracion de practicas')
    AND mi.route = '/milab/prestamos/coordinador/practicas/config';

WITH role_map AS (SELECT id, nombre FROM rol),
menu_map AS (SELECT id, label, route, section, parent_id FROM menu_item)
INSERT INTO rol_permiso (rol_id, menu_item_id)
SELECT role_map.id, menu_map.id
FROM role_map
JOIN menu_map ON menu_map.section = 'secondary'
WHERE (
    role_map.nombre = 'admin' AND menu_map.label IN (
        'Prestamos',
        'Inventario',
        'Equipos',
        'Gestion de solicitudes',
        'Entrega y devolucion',
        'Incidencias',
        'Gestion de practicas',
        'Salas',
        'Reportes',
        'Auditoria',
        'Parametrizaciones',
        'Configuracion de practicas'
    )
) OR (
    role_map.nombre = 'coordinador' AND menu_map.label IN (
        'Prestamos',
        'Inventario',
        'Equipos',
        'Gestion de solicitudes',
        'Entrega y devolucion',
        'Incidencias',
        'Gestion de practicas',
        'Salas',
        'Reportes',
        'Auditoria',
        'Configuracion de practicas'
    )
) OR (
    role_map.nombre = 'laboratorista' AND menu_map.label IN (
        'Prestamos',
        'Inventario',
        'Equipos',
        'Gestion de solicitudes',
        'Entrega y devolucion',
        'Incidencias',
        'Gestion de practicas',
        'Salas',
        'Reportes',
        'Auditoria',
        'Configuracion de practicas'
    )
) OR (
    role_map.nombre = 'estudiante' AND menu_map.label IN (
        'Prestamos',
        'Solicitar equipo',
        'Mis solicitudes',
        'Solicitar practica',
        'Mis practicas'
    )
) OR (
    role_map.nombre = 'docente' AND menu_map.label IN (
        'Prestamos',
        'Solicitar equipo',
        'Mis solicitudes',
        'Solicitar practica',
        'Mis practicas'
    )
)
ON CONFLICT DO NOTHING;

-- Restringe por defecto el modulo de Prestamos a ASAB, Bosa e Ingenieria/Tecnologica.
WITH active_roles AS (
    SELECT unnest(ARRAY['coordinador', 'laboratorista']) AS rol
),
all_active_faculties AS (
    SELECT facultad_id
    FROM facultad
    WHERE activo = TRUE
),
allowed_faculties AS (
    SELECT facultad_id
    FROM facultad
    WHERE activo = TRUE
      AND (
          upper(nombre) IN ('ASAB', 'BOSA', 'CALLE 40')
      )
)
INSERT INTO facultad_modulo_acceso (facultad_id, modulo, rol, permitido, activo)
SELECT f.facultad_id, 'prestamos', r.rol, FALSE, TRUE
FROM all_active_faculties f
CROSS JOIN active_roles r
ON CONFLICT (facultad_id, modulo, rol) DO UPDATE
SET permitido = EXCLUDED.permitido,
    activo = TRUE,
    fecha_modificacion = CURRENT_TIMESTAMP;

WITH active_roles AS (
    SELECT unnest(ARRAY['coordinador', 'laboratorista']) AS rol
),
allowed_faculties AS (
    SELECT facultad_id
    FROM facultad
    WHERE activo = TRUE
      AND (
          upper(nombre) IN ('ASAB', 'BOSA', 'CALLE 40')
      )
)
INSERT INTO facultad_modulo_acceso (facultad_id, modulo, rol, permitido, activo)
SELECT f.facultad_id, 'prestamos', r.rol, TRUE, TRUE
FROM allowed_faculties f
CROSS JOIN active_roles r
ON CONFLICT (facultad_id, modulo, rol) DO UPDATE
SET permitido = EXCLUDED.permitido,
    activo = TRUE,
    fecha_modificacion = CURRENT_TIMESTAMP;
