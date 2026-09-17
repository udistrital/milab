CREATE SCHEMA IF NOT EXISTS milab;
SET search_path TO milab;
SET TIME ZONE 'America/Bogota';

BEGIN;

INSERT INTO cursos (
    codigo_curso,
    id_facultad,
    nombre_curso,
    url_edx,
    activo
)
SELECT
    seed.codigo_curso,
    facultad.facultad_id,
    seed.nombre_curso,
    seed.url_edx,
    TRUE
FROM (
    VALUES
        ('MOCK-COURSE-001', 'Curso de prueba 1', 'https://edx.org/course/mock-course-001'),
        ('MOCK-COURSE-002', 'Curso de prueba 2', 'https://edx.org/course/mock-course-002'),
        ('MOCK-COURSE-003', 'Curso de prueba 3', 'https://edx.org/course/mock-course-003'),
        ('MOCK-COURSE-004', 'Curso de prueba 4', 'https://edx.org/course/mock-course-004')
) AS seed(codigo_curso, nombre_curso, url_edx)
CROSS JOIN LATERAL (
    SELECT facultad_id
    FROM facultad
    WHERE activo = TRUE
    ORDER BY facultad_id
    LIMIT 1
) AS facultad
ON CONFLICT (codigo_curso) DO UPDATE
SET id_facultad = EXCLUDED.id_facultad,
    nombre_curso = EXCLUDED.nombre_curso,
    url_edx = EXCLUDED.url_edx,
    activo = EXCLUDED.activo,
    fecha_modificacion = CURRENT_TIMESTAMP;

INSERT INTO curso_laboratorio (
    codigo_curso,
    id_laboratorio,
    activo
)
SELECT
    cursos.codigo_curso,
    laboratorio.ual_id,
    TRUE
FROM cursos
CROSS JOIN LATERAL (
    SELECT ual_id
    FROM ual
    WHERE activo = TRUE
      AND facultad_id = cursos.id_facultad
    ORDER BY ual_id
    LIMIT 1
) AS laboratorio
WHERE cursos.codigo_curso LIKE 'MOCK-COURSE-%'
ON CONFLICT (codigo_curso, id_laboratorio) DO UPDATE
SET activo = TRUE,
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
    FROM equipo
    WHERE activo = TRUE
    ORDER BY id
    LIMIT 1
) AS equipo
WHERE cursos.codigo_curso LIKE 'MOCK-COURSE-%'
ON CONFLICT (codigo_curso, id_equipo) DO UPDATE
SET activo = TRUE,
    fecha_modificacion = CURRENT_TIMESTAMP;

-- ==============================================================
-- === Menú y Permisos RBAC - Módulo CAPACITACIÓN            ===
-- ==============================================================

INSERT INTO menu_item (section, label, icon, order_index)
SELECT 'secondary', 'Capacitación', 'bi-mortarboard-fill', 10
WHERE NOT EXISTS (
    SELECT 1 FROM menu_item
    WHERE section = 'secondary'
      AND label   = 'Capacitación'
      AND parent_id IS NULL
);

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary',
       parent.id,
       'Creación de cursos',
       '/milab/capacitacion/cursos/load_info',
       'bi-bookmark-plus',
       1
FROM menu_item parent
WHERE parent.section = 'secondary'
  AND parent.label   = 'Capacitación'
  AND parent.parent_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM menu_item
    WHERE parent_id = parent.id
      AND label     = 'Creación de cursos'
      AND route     = '/milab/capacitacion/cursos/load_info'
  )
ON CONFLICT DO NOTHING;

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary',
       parent.id,
       'Asociación curso-equipo',
       '/milab/capacitacion/asociacion-equipos/load_info',
       'bi-diagram-3',
       2
FROM menu_item parent
WHERE parent.section = 'secondary'
  AND parent.label   = 'Capacitación'
  AND parent.parent_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM menu_item
    WHERE parent_id = parent.id
      AND label     = 'Asociación curso-equipo'
      AND route     = '/milab/capacitacion/asociacion-equipos/load_info'
  )
ON CONFLICT DO NOTHING;

INSERT INTO rol_permiso (rol_id, menu_item_id, can_view, can_use, activo)
SELECT r.id, mi.id, TRUE, TRUE, TRUE
FROM rol r
CROSS JOIN menu_item mi
WHERE r.nombre = 'admin'
  AND mi.section = 'secondary'
  AND mi.label IN ('Capacitación','Creación de cursos','Asociación curso-equipo')
ON CONFLICT (rol_id, menu_item_id) DO UPDATE
    SET can_view = TRUE,
        can_use  = TRUE,
        activo   = TRUE,
        fecha_modificacion = CURRENT_TIMESTAMP;

INSERT INTO rol_permiso (rol_id, menu_item_id, can_view, can_use, activo)
SELECT r.id, mi.id, TRUE, TRUE, TRUE
FROM rol r
CROSS JOIN menu_item mi
WHERE r.nombre = 'laboratorista'
  AND mi.section = 'secondary'
  AND mi.label IN ('Capacitación','Asociación curso-equipo')
ON CONFLICT (rol_id, menu_item_id) DO UPDATE
    SET can_view = TRUE,
        can_use  = TRUE,
        activo   = TRUE,
        fecha_modificacion = CURRENT_TIMESTAMP;

INSERT INTO rol_permiso (rol_id, menu_item_id, can_view, can_use, activo)
SELECT r.id, mi.id, FALSE, FALSE, FALSE
FROM rol r
CROSS JOIN menu_item mi
WHERE r.nombre = 'laboratorista'
  AND mi.section = 'secondary'
  AND mi.label   = 'Creación de cursos'
ON CONFLICT (rol_id, menu_item_id) DO UPDATE
    SET can_view = FALSE,
        can_use  = FALSE,
        activo   = FALSE,
        fecha_modificacion = CURRENT_TIMESTAMP;

COMMIT;
