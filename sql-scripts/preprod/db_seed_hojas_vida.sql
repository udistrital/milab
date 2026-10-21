CREATE SCHEMA IF NOT EXISTS milab;
SET search_path TO milab;
SET TIME ZONE 'America/Bogota';

BEGIN;


DO $$
DECLARE
    v_usuario VARCHAR(50) := 'system:seed:hojas_vida';
BEGIN
    INSERT INTO milab.hoja_vida_config_campos
        (nombre_campo, seccion, obligatorio, activo, fecha_creacion, fecha_modificacion, usuario_creacion, usuario_modificacion)
    VALUES
        ('marca',             'Información equipo', TRUE,  TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, v_usuario, v_usuario),
        ('numero_serie',      'Información equipo', TRUE,  TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, v_usuario, v_usuario),
        ('codigo_inventario', 'Información equipo', TRUE,  TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, v_usuario, v_usuario),
        ('proveedor',         'Información equipo', FALSE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, v_usuario, v_usuario),
        ('valor_compra',      'Información equipo', FALSE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, v_usuario, v_usuario),
        ('cuenta_manual',     'Especificaciones',   FALSE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, v_usuario, v_usuario),
        ('accesorios',        'Especificaciones',   FALSE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, v_usuario, v_usuario)
    ON CONFLICT (nombre_campo) DO UPDATE
    SET
        seccion              = EXCLUDED.seccion,
        obligatorio          = EXCLUDED.obligatorio,
        activo               = EXCLUDED.activo,
        fecha_modificacion   = EXCLUDED.fecha_modificacion,
        usuario_modificacion = EXCLUDED.usuario_modificacion;
END $$;


INSERT INTO rol (nombre)
VALUES ('admin'),
       ('coordinador'),
       ('coordinador_general'),
       ('laboratorista')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO menu_item (section, label, route, icon)
VALUES (
  'secondary',
  'Hojas de Vida y Mantenimientos',
  '/milab/prestamos/hojas-vida',
  'bi-journal-medical'
)
ON CONFLICT (section, parent_id, label, route) DO NOTHING;

INSERT INTO rol_permiso (rol_id, menu_item_id, can_view, can_use)
SELECT r.id, mi.id, TRUE, TRUE
FROM rol r
JOIN menu_item mi
  ON mi.section = 'secondary'
 AND mi.label = 'Hojas de Vida y Mantenimientos'
 AND mi.route = '/milab/prestamos/hojas-vida'
WHERE r.nombre IN ('admin', 'coordinador', 'coordinador_general', 'laboratorista')
ON CONFLICT (rol_id, menu_item_id) DO UPDATE
SET can_view = TRUE,
    can_use = TRUE,
    fecha_modificacion = CURRENT_TIMESTAMP;

COMMIT;
