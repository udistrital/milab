CREATE SCHEMA IF NOT EXISTS milab;
SET search_path TO milab;
SET TIME ZONE 'America/Bogota';

BEGIN;

CREATE TABLE IF NOT EXISTS cursos (
    codigo_curso VARCHAR(100) NOT NULL,
    id_facultad INT NOT NULL,
    nombre_curso VARCHAR(255) NOT NULL,
    url_edx TEXT NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_cursos PRIMARY KEY (codigo_curso),
    CONSTRAINT fk_cursos_facultad FOREIGN KEY (id_facultad)
        REFERENCES facultad(facultad_id) ON DELETE RESTRICT,
    CONSTRAINT ck_cursos_codigo_no_vacio CHECK (BTRIM(codigo_curso) <> ''),
    CONSTRAINT ck_cursos_nombre_no_vacio CHECK (BTRIM(nombre_curso) <> ''),
    CONSTRAINT ck_cursos_url_edx_no_vacia CHECK (BTRIM(url_edx) <> '')
);

CREATE INDEX IF NOT EXISTS idx_cursos_facultad ON cursos(id_facultad);
CREATE INDEX IF NOT EXISTS idx_cursos_activo ON cursos(activo);

CREATE TABLE IF NOT EXISTS curso_laboratorio (
    codigo_curso VARCHAR(100) NOT NULL,
    id_laboratorio INT NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_curso_laboratorio PRIMARY KEY (codigo_curso, id_laboratorio),
    CONSTRAINT fk_curso_laboratorio_curso FOREIGN KEY (codigo_curso)
        REFERENCES cursos(codigo_curso) ON DELETE CASCADE,
    CONSTRAINT fk_curso_laboratorio_laboratorio FOREIGN KEY (id_laboratorio)
        REFERENCES ual(ual_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_curso_laboratorio_curso
    ON curso_laboratorio(codigo_curso);
CREATE INDEX IF NOT EXISTS idx_curso_laboratorio_laboratorio
    ON curso_laboratorio(id_laboratorio);
CREATE INDEX IF NOT EXISTS idx_curso_laboratorio_activo
    ON curso_laboratorio(activo);

CREATE TABLE IF NOT EXISTS equipo_especializado (
    codigo_curso VARCHAR(100) NOT NULL,
    id_equipo INT NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_equipo_especializado PRIMARY KEY (codigo_curso, id_equipo),
    CONSTRAINT fk_equipo_especializado_curso FOREIGN KEY (codigo_curso)
        REFERENCES cursos(codigo_curso) ON DELETE CASCADE,
    CONSTRAINT fk_equipo_especializado_equipo FOREIGN KEY (id_equipo)
        REFERENCES equipo(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_equipo_especializado_curso
    ON equipo_especializado(codigo_curso);
CREATE INDEX IF NOT EXISTS idx_equipo_especializado_equipo
    ON equipo_especializado(id_equipo);
CREATE INDEX IF NOT EXISTS idx_equipo_especializado_activo
    ON equipo_especializado(activo);

CREATE OR REPLACE FUNCTION validar_facultad_curso_laboratorio()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    facultad_curso INT;
    facultad_laboratorio INT;
BEGIN
    SELECT id_facultad
    INTO facultad_curso
    FROM cursos
    WHERE codigo_curso = NEW.codigo_curso;

    SELECT facultad_id
    INTO facultad_laboratorio
    FROM ual
    WHERE ual_id = NEW.id_laboratorio;

    IF facultad_curso IS DISTINCT FROM facultad_laboratorio THEN
        RAISE EXCEPTION
            'El laboratorio % no pertenece a la facultad del curso %',
            NEW.id_laboratorio,
            NEW.codigo_curso;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validar_facultad_curso_laboratorio
    ON curso_laboratorio;

CREATE TRIGGER trg_validar_facultad_curso_laboratorio
BEFORE INSERT OR UPDATE OF codigo_curso, id_laboratorio
ON curso_laboratorio
FOR EACH ROW
EXECUTE FUNCTION validar_facultad_curso_laboratorio();

COMMIT;
