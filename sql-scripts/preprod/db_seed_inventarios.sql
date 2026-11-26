SET search_path TO milab;

BEGIN;

INSERT INTO menu_item (section, label, icon, order_index, activo)
SELECT 'secondary', 'Configuración', 'bi-gear', 5, TRUE
WHERE NOT EXISTS (
    SELECT 1
    FROM menu_item
    WHERE section = 'secondary'
      AND parent_id IS NULL
      AND label = 'Configuración'
);

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index, activo)
SELECT 'secondary', parent.id, 'Festivos colombianos',
       '/milab/api/admin/festivos', 'bi-calendar2-week', 4, TRUE
FROM menu_item parent
WHERE parent.section = 'secondary'
  AND parent.parent_id IS NULL
  AND parent.label = 'Configuración'
  AND NOT EXISTS (
      SELECT 1
      FROM menu_item existing
      WHERE existing.route = '/milab/api/admin/festivos'
  )
ON CONFLICT DO NOTHING;

UPDATE menu_item
SET activo = TRUE
WHERE route = '/milab/api/admin/festivos';

UPDATE rol_permiso rp
SET activo = FALSE,
    fecha_modificacion = CURRENT_TIMESTAMP
FROM rol r, menu_item mi
WHERE rp.rol_id = r.id
  AND rp.menu_item_id = mi.id
  AND mi.route = '/milab/api/admin/festivos'
  AND r.nombre <> 'admin'
  AND rp.activo = TRUE;

INSERT INTO rol_permiso (rol_id, menu_item_id, can_view, can_use, activo)
SELECT r.id, mi.id, TRUE, TRUE, TRUE
FROM rol r
CROSS JOIN menu_item mi
WHERE r.nombre = 'admin'
  AND mi.route = '/milab/api/admin/festivos'
ON CONFLICT (rol_id, menu_item_id)
DO UPDATE SET can_view = TRUE,
              can_use = TRUE,
              activo = TRUE,
              fecha_modificacion = CURRENT_TIMESTAMP;

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

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index, activo)
SELECT 'secondary', parent.id, 'Conciliaciones ARKA',
       '/milab/inventarios/conciliaciones-arka', 'bi-arrow-left-right', 3, TRUE
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
    '/milab/inventarios/aprobaciones',
    '/milab/inventarios/conciliaciones-arka'
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

INSERT INTO rol_permiso (rol_id, menu_item_id, can_view, can_use, activo)
SELECT r.id, mi.id, TRUE, r.nombre <> 'coordinador_general', TRUE
FROM rol r
JOIN menu_item mi
  ON mi.route = '/milab/inventarios/conciliaciones-arka'
WHERE r.nombre IN ('admin', 'administrador', 'coordinador_general', 'coordinador')
ON CONFLICT (rol_id, menu_item_id)
DO UPDATE SET can_view = EXCLUDED.can_view,
              can_use = EXCLUDED.can_use,
              activo = EXCLUDED.activo,
              fecha_modificacion = CURRENT_TIMESTAMP;

INSERT INTO equipo_especializado (
    codigo_curso,
    id_equipo,
    activo
)
SELECT
    cursos.codigo_curso,
    equipo.id,
    TRUE
FROM cursos
CROSS JOIN LATERAL (
    SELECT id
    FROM equipo_catalogo
    WHERE activo = TRUE
    ORDER BY id
    LIMIT 1
) AS equipo
WHERE cursos.codigo_curso LIKE 'MOCK-COURSE-%'
ON CONFLICT (codigo_curso, id_equipo) DO UPDATE
SET activo = TRUE,
    fecha_modificacion = CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS prestamo_activacion_laboratorio (
    id SERIAL PRIMARY KEY,
    ual_id INT NOT NULL,
    estado_activacion BOOLEAN NOT NULL DEFAULT FALSE,
    checklist_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    configuracion_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    activado_por_id BIGINT,
    activado_por_documento VARCHAR(50),
    fecha_activacion TIMESTAMPTZ,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_prestamo_activacion_laboratorio_ual UNIQUE (ual_id),
    CONSTRAINT fk_prestamo_activacion_laboratorio_ual FOREIGN KEY (ual_id) REFERENCES ual(ual_id) ON DELETE CASCADE,
    CONSTRAINT fk_prestamo_activacion_laboratorio_usuario FOREIGN KEY (activado_por_id) REFERENCES usuario(id) ON DELETE SET NULL,
    CONSTRAINT ck_prestamo_activacion_laboratorio_checklist_json CHECK (jsonb_typeof(checklist_json) = 'array'),
    CONSTRAINT ck_prestamo_activacion_laboratorio_configuracion_json CHECK (jsonb_typeof(configuracion_json) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_prestamo_activacion_laboratorio_estado
  ON prestamo_activacion_laboratorio(estado_activacion);

ALTER TABLE horario_sala
  ADD COLUMN IF NOT EXISTS origen_carga VARCHAR(20) NOT NULL DEFAULT 'manual';

ALTER TABLE horario_sala
  ADD COLUMN IF NOT EXISTS cargado_por_id BIGINT;

ALTER TABLE horario_sala
  ADD COLUMN IF NOT EXISTS cargado_por_documento VARCHAR(50);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_horario_sala_origen_carga'
  ) THEN
    ALTER TABLE horario_sala
      ADD CONSTRAINT ck_horario_sala_origen_carga
      CHECK (origen_carga IN ('manual', 'excel'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_horario_sala_cargado_por'
  ) THEN
    ALTER TABLE horario_sala
      ADD CONSTRAINT fk_horario_sala_cargado_por
      FOREIGN KEY (cargado_por_id) REFERENCES usuario(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_horario_sala_origen_carga
  ON horario_sala(origen_carga);

COMMIT;
