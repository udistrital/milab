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
    SELECT dependencia_facultad_id AS facultad_id
    FROM dependencia_facultad
    WHERE activo = TRUE
    ORDER BY dependencia_facultad_id
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

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary',
       parent.id,
       'Gestionar capacitaciones',
       '/milab/capacitacion/gestion/load_info',
       'bi-calendar-check',
       3
FROM menu_item parent
WHERE parent.section = 'secondary'
  AND parent.label   = 'Capacitación'
  AND parent.parent_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM menu_item
    WHERE parent_id = parent.id
      AND label     = 'Gestionar capacitaciones'
      AND route     = '/milab/capacitacion/gestion/load_info'
  )
ON CONFLICT DO NOTHING;

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary',
       parent.id,
       'Mis capacitaciones',
       '/milab/capacitacion/mis-capacitaciones/load_info',
       'bi-journal-bookmark',
       4
FROM menu_item parent
WHERE parent.section = 'secondary'
  AND parent.label   = 'Capacitación'
  AND parent.parent_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM menu_item
    WHERE parent_id = parent.id
      AND label     = 'Mis capacitaciones'
      AND route     = '/milab/capacitacion/mis-capacitaciones/load_info'
  )
ON CONFLICT DO NOTHING;

INSERT INTO rol_permiso (rol_id, menu_item_id, can_view, can_use, activo)
SELECT r.id, mi.id, TRUE, TRUE, TRUE
FROM rol r
CROSS JOIN menu_item mi
WHERE LOWER(TRIM(r.nombre)) IN ('admin','administrador')
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
WHERE LOWER(TRIM(r.nombre)) = 'laboratorista'
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
WHERE LOWER(TRIM(r.nombre)) = 'laboratorista'
  AND mi.section = 'secondary'
  AND mi.label   = 'Creación de cursos'
ON CONFLICT (rol_id, menu_item_id) DO UPDATE
    SET can_view = FALSE,
        can_use  = FALSE,
        activo   = FALSE,
        fecha_modificacion = CURRENT_TIMESTAMP;

-- ==================  NUEVOS ITEMS Y PERMISOS  ==================
-- Item 3: Gestionar capacitaciones - permisos (Admin / Coordinador_General / Coordinador / Laboratorista)

INSERT INTO rol_permiso (rol_id, menu_item_id, can_view, can_use, activo)
SELECT r.id, mi.id, TRUE, TRUE, TRUE
FROM rol r
CROSS JOIN menu_item mi
WHERE LOWER(TRIM(r.nombre)) IN ('admin','administrador','coordinador_general','coordinador general','coordinador','laboratorista')
  AND mi.section = 'secondary'
  AND mi.label   = 'Gestionar capacitaciones'
ON CONFLICT (rol_id, menu_item_id) DO UPDATE
    SET can_view = TRUE,
        can_use  = TRUE,
        activo   = TRUE,
        fecha_modificacion = CURRENT_TIMESTAMP;

-- Grupo padre "Capacitación" + "Asociación curso-equipo" para Coordinador_General / Coordinador

INSERT INTO rol_permiso (rol_id, menu_item_id, can_view, can_use, activo)
SELECT r.id, mi.id, TRUE, TRUE, TRUE
FROM rol r
CROSS JOIN menu_item mi
WHERE LOWER(TRIM(r.nombre)) IN ('coordinador_general','coordinador general','coordinador')
  AND mi.section = 'secondary'
  AND mi.label IN ('Capacitación','Asociación curso-equipo')
ON CONFLICT (rol_id, menu_item_id) DO UPDATE
    SET can_view = TRUE,
        can_use  = TRUE,
        activo   = TRUE,
        fecha_modificacion = CURRENT_TIMESTAMP;

-- "Creación de cursos" DENEGADO para Coordinador_General / Coordinador / Laboratorista

INSERT INTO rol_permiso (rol_id, menu_item_id, can_view, can_use, activo)
SELECT r.id, mi.id, FALSE, FALSE, FALSE
FROM rol r
CROSS JOIN menu_item mi
WHERE LOWER(TRIM(r.nombre)) IN ('coordinador_general','coordinador general','coordinador')
  AND mi.section = 'secondary'
  AND mi.label IN ('Creación de cursos','Mis capacitaciones')
ON CONFLICT (rol_id, menu_item_id) DO UPDATE
    SET can_view = FALSE,
        can_use  = FALSE,
        activo   = FALSE,
        fecha_modificacion = CURRENT_TIMESTAMP;

-- Item 4: Mis capacitaciones - Estudiante / Docente (grupo padre + item Mis capacitaciones = TRUE)

INSERT INTO rol_permiso (rol_id, menu_item_id, can_view, can_use, activo)
SELECT r.id, mi.id, TRUE, TRUE, TRUE
FROM rol r
CROSS JOIN menu_item mi
WHERE LOWER(TRIM(r.nombre)) IN ('estudiante','docente')
  AND mi.section = 'secondary'
  AND mi.label IN ('Capacitación','Mis capacitaciones')
ON CONFLICT (rol_id, menu_item_id) DO UPDATE
    SET can_view = TRUE,
        can_use  = TRUE,
        activo   = TRUE,
        fecha_modificacion = CURRENT_TIMESTAMP;

-- Estudiante / Docente: DENEGAR Creación cursos / Asoc curso-equipo / Gestionar capacitaciones

INSERT INTO rol_permiso (rol_id, menu_item_id, can_view, can_use, activo)
SELECT r.id, mi.id, FALSE, FALSE, FALSE
FROM rol r
CROSS JOIN menu_item mi
WHERE LOWER(TRIM(r.nombre)) IN ('estudiante','docente')
  AND mi.section = 'secondary'
  AND mi.label IN ('Creación de cursos','Asociación curso-equipo','Gestionar capacitaciones')
ON CONFLICT (rol_id, menu_item_id) DO UPDATE
    SET can_view = FALSE,
        can_use  = FALSE,
        activo   = FALSE,
        fecha_modificacion = CURRENT_TIMESTAMP;

-- Admin: asegurarse Mis capacitaciones NO visible (no es su módulo)

INSERT INTO rol_permiso (rol_id, menu_item_id, can_view, can_use, activo)
SELECT r.id, mi.id, FALSE, FALSE, FALSE
FROM rol r
CROSS JOIN menu_item mi
WHERE LOWER(TRIM(r.nombre)) IN ('admin','administrador','coordinador_general','coordinador general','coordinador','laboratorista')
  AND mi.section = 'secondary'
  AND mi.label   = 'Mis capacitaciones'
ON CONFLICT (rol_id, menu_item_id) DO UPDATE
    SET can_view = FALSE,
        can_use  = FALSE,
        activo   = FALSE,
        fecha_modificacion = CURRENT_TIMESTAMP;

COMMIT;
