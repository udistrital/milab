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

COMMIT;
