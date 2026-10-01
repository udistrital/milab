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

-- MODULO CAPACITACION SOLICITUDES / SESIONES / CERTIFICACIONES


CREATE TABLE IF NOT EXISTS solicitud_capacitacion (
    id BIGSERIAL NOT NULL,
    codigo_curso VARCHAR(100) NOT NULL,
    solicitante_documento VARCHAR(50) NOT NULL,
    solicitante_nombre VARCHAR(255),
    ual_id_solicitud INT,
    facultad_id INT,
    estado VARCHAR(30) NOT NULL DEFAULT 'pendiente',
    mensaje_solicitante TEXT,
    fecha_notificacion_programacion TIMESTAMPTZ,
    id_sesion_programada_notificada BIGINT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    creado_por_documento VARCHAR(50),
    modificado_por_documento VARCHAR(50),
    CONSTRAINT pk_solicitud_capacitacion PRIMARY KEY (id),
    CONSTRAINT fk_solicitud_capacitacion_curso FOREIGN KEY (codigo_curso)
        REFERENCES cursos(codigo_curso) ON DELETE CASCADE,
    CONSTRAINT fk_solicitud_capacitacion_ual FOREIGN KEY (ual_id_solicitud)
        REFERENCES ual(ual_id) ON DELETE SET NULL,
    CONSTRAINT fk_solicitud_capacitacion_facultad FOREIGN KEY (facultad_id)
        REFERENCES facultad(facultad_id) ON DELETE SET NULL,
    CONSTRAINT ck_solicitud_capacitacion_estado_valido CHECK (
        estado IN ('pendiente','notificado_programada','atendido_cerrado','cancelado')
    ),
    CONSTRAINT ck_solicitud_capacitacion_solicitante_no_vacio CHECK (
        BTRIM(COALESCE(solicitante_documento,'')) <> ''
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_solicitud_capacitacion_doc_curso_estado
    ON solicitud_capacitacion(solicitante_documento, codigo_curso, estado)
    WHERE estado IN ('pendiente','notificado_programada');

CREATE TABLE IF NOT EXISTS sesion_capacitacion (
    id BIGSERIAL NOT NULL,
    codigo_curso VARCHAR(100) NOT NULL,
    ual_id_lugar INT NOT NULL,
    facultad_id INT NOT NULL,
    laboratorista_documento VARCHAR(50) NOT NULL,
    laboratorista_nombre VARCHAR(255),
    fecha_hora_inicio TIMESTAMPTZ NOT NULL,
    fecha_hora_fin TIMESTAMPTZ NOT NULL,
    cupo_maximo INT NOT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'programada',
    observaciones TEXT,
    evidencia_ruta_rel TEXT,
    evidencia_nombre_original TEXT,
    evidencia_mime_type VARCHAR(100),
    evidencia_fecha_subida TIMESTAMPTZ,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    creado_por_documento VARCHAR(50),
    modificado_por_documento VARCHAR(50),
    CONSTRAINT pk_sesion_capacitacion PRIMARY KEY (id),
    CONSTRAINT fk_sesion_capacitacion_curso FOREIGN KEY (codigo_curso)
        REFERENCES cursos(codigo_curso) ON DELETE RESTRICT,
    CONSTRAINT fk_sesion_capacitacion_ual FOREIGN KEY (ual_id_lugar)
        REFERENCES ual(ual_id) ON DELETE RESTRICT,
    CONSTRAINT fk_sesion_capacitacion_facultad FOREIGN KEY (facultad_id)
        REFERENCES facultad(facultad_id) ON DELETE RESTRICT,
    CONSTRAINT ck_sesion_capacitacion_estado_valido CHECK (
        estado IN ('programada','en_curso','realizada','cancelada')
    ),
    CONSTRAINT ck_sesion_capacitacion_cupo_valido CHECK (cupo_maximo >= 1),
    CONSTRAINT ck_sesion_capacitacion_fechas_validas CHECK (
        fecha_hora_fin > fecha_hora_inicio
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_sesion_capacitacion_curso_ual_fechaini
    ON sesion_capacitacion(codigo_curso, ual_id_lugar, fecha_hora_inicio)
    WHERE activo = TRUE;

ALTER TABLE solicitud_capacitacion
    ADD CONSTRAINT fk_solicitud_capacitacion_sesion_notificada
    FOREIGN KEY (id_sesion_programada_notificada)
        REFERENCES sesion_capacitacion(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS inscripcion_sesion_capacitacion (
    id BIGSERIAL NOT NULL,
    sesion_id BIGINT NOT NULL,
    usuario_documento VARCHAR(50) NOT NULL,
    usuario_nombre VARCHAR(255),
    fecha_inscripcion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    origen_inscripcion VARCHAR(30) NOT NULL DEFAULT 'directa',
    solicitud_capacitacion_id BIGINT,
    estado_inscripcion VARCHAR(30) NOT NULL DEFAULT 'inscrito',
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    creado_por_documento VARCHAR(50),
    modificado_por_documento VARCHAR(50),
    CONSTRAINT pk_inscripcion_sesion_capacitacion PRIMARY KEY (id),
    CONSTRAINT fk_inscripcion_sesion_capacitacion_sesion FOREIGN KEY (sesion_id)
        REFERENCES sesion_capacitacion(id) ON DELETE CASCADE,
    CONSTRAINT fk_inscripcion_sesion_capacitacion_solicitud FOREIGN KEY (solicitud_capacitacion_id)
        REFERENCES solicitud_capacitacion(id) ON DELETE SET NULL,
    CONSTRAINT ck_inscripcion_sesion_origen_valido CHECK (
        origen_inscripcion IN ('directa','lista_espera_solicitud')
    ),
    CONSTRAINT ck_inscripcion_sesion_estado_valido CHECK (
        estado_inscripcion IN ('inscrito','cancelado_estudiante','cupo_excedido_lista_espera')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_inscripcion_sesion_user_estado
    ON inscripcion_sesion_capacitacion(sesion_id, usuario_documento)
    WHERE estado_inscripcion IN ('inscrito','cupo_excedido_lista_espera') AND activo = TRUE;

CREATE TABLE IF NOT EXISTS asistencia_capacitacion (
    id BIGSERIAL NOT NULL,
    sesion_id BIGINT NOT NULL,
    usuario_documento VARCHAR(50) NOT NULL,
    inscripcion_id BIGINT,
    asistio BOOLEAN NOT NULL DEFAULT FALSE,
    fecha_hora_marcado_asistencia TIMESTAMPTZ,
    metodo_marcado VARCHAR(30) NOT NULL DEFAULT 'manual',
    marcado_por_laboratorista_doc VARCHAR(50),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    creado_por_documento VARCHAR(50),
    modificado_por_documento VARCHAR(50),
    CONSTRAINT pk_asistencia_capacitacion PRIMARY KEY (id),
    CONSTRAINT fk_asistencia_capacitacion_sesion FOREIGN KEY (sesion_id)
        REFERENCES sesion_capacitacion(id) ON DELETE CASCADE,
    CONSTRAINT fk_asistencia_capacitacion_inscripcion FOREIGN KEY (inscripcion_id)
        REFERENCES inscripcion_sesion_capacitacion(id) ON DELETE CASCADE,
    CONSTRAINT ck_asistencia_capacitacion_metodo_valido CHECK (
        metodo_marcado IN ('manual','qr_documento','lista_asistencia')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_asistencia_capacitacion_sesion_user
    ON asistencia_capacitacion(sesion_id, usuario_documento)
    WHERE activo = TRUE;

CREATE TABLE IF NOT EXISTS certificacion_usuario (
    id BIGSERIAL NOT NULL,
    codigo_curso VARCHAR(100) NOT NULL,
    usuario_documento VARCHAR(50) NOT NULL,
    usuario_nombre VARCHAR(255),
    modalidad VARCHAR(20) NOT NULL,
    fecha_emision TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_vencimiento TIMESTAMPTZ NOT NULL,
    vigencia_meses INT NOT NULL DEFAULT 12,
    sesion_id BIGINT,
    prestamo_solicitud_id INT,
    entrega_equipo_id BIGINT,
    certificado_por_laboratorista_doc VARCHAR(50) NOT NULL,
    certificado_por_laboratorista_nombre VARCHAR(255),
    notas TEXT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    creado_por_documento VARCHAR(50),
    modificado_por_documento VARCHAR(50),
    CONSTRAINT pk_certificacion_usuario PRIMARY KEY (id),
    CONSTRAINT fk_certificacion_usuario_curso FOREIGN KEY (codigo_curso)
        REFERENCES cursos(codigo_curso) ON DELETE RESTRICT,
    CONSTRAINT fk_certificacion_usuario_sesion FOREIGN KEY (sesion_id)
        REFERENCES sesion_capacitacion(id) ON DELETE SET NULL,
    CONSTRAINT fk_certificacion_usuario_prestamo FOREIGN KEY (prestamo_solicitud_id)
        REFERENCES solicitud_prestamo(id) ON DELETE SET NULL,
    CONSTRAINT fk_certificacion_usuario_entrega FOREIGN KEY (entrega_equipo_id)
        REFERENCES entrega_equipo(id) ON DELETE SET NULL,
    CONSTRAINT ck_certificacion_usuario_modalidad_valida CHECK (
        modalidad IN ('programada','prestamo')
    ),
    CONSTRAINT ck_certificacion_usuario_vigencia_valida CHECK (
        vigencia_meses BETWEEN 1 AND 60
    ),
    CONSTRAINT ck_certificacion_usuario_fechas_validas CHECK (
        fecha_vencimiento > fecha_emision
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_certificacion_usuario_curso_user_activa
    ON certificacion_usuario(codigo_curso, usuario_documento)
    WHERE activo = TRUE;

CREATE INDEX IF NOT EXISTS idx_solicitud_capacitacion_solicitante_curso
    ON solicitud_capacitacion(solicitante_documento, codigo_curso);
CREATE INDEX IF NOT EXISTS idx_sesion_capacitacion_ual_fecha
    ON sesion_capacitacion(ual_id_lugar, fecha_hora_inicio);
CREATE INDEX IF NOT EXISTS idx_inscripcion_sesion_user
    ON inscripcion_sesion_capacitacion(sesion_id, usuario_documento);
CREATE INDEX IF NOT EXISTS idx_certificacion_usuario_doc_curso_vig
    ON certificacion_usuario(usuario_documento, codigo_curso, fecha_vencimiento, activo);


-- TRIGGER: sesion_capacitacion valida que UAL.lugar pertenece
-- a la MISMA facultad del curso (igual a curso_laboratorio).

CREATE OR REPLACE FUNCTION validar_facultad_sesion_capacitacion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    facultad_curso INT;
    facultad_ual INT;
BEGIN
    SELECT id_facultad
    INTO facultad_curso
    FROM cursos
    WHERE codigo_curso = NEW.codigo_curso;

    SELECT facultad_id
    INTO facultad_ual
    FROM ual
    WHERE ual_id = NEW.ual_id_lugar;

    IF facultad_curso IS DISTINCT FROM facultad_ual THEN
        RAISE EXCEPTION
            'La UAL/Laboratorio % (facultad %) no coincide con la facultad (%) del curso %',
            NEW.ual_id_lugar,
            COALESCE(facultad_ual::TEXT,'NULL'),
            COALESCE(facultad_curso::TEXT,'NULL'),
            NEW.codigo_curso;
    END IF;

    IF NEW.facultad_id IS DISTINCT FROM facultad_curso THEN
        NEW.facultad_id := COALESCE(facultad_curso, NEW.facultad_id);
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validar_facultad_sesion_capacitacion
    ON sesion_capacitacion;

CREATE TRIGGER trg_validar_facultad_sesion_capacitacion
BEFORE INSERT OR UPDATE OF codigo_curso, ual_id_lugar, facultad_id
ON sesion_capacitacion
FOR EACH ROW
EXECUTE FUNCTION validar_facultad_sesion_capacitacion();

COMMIT;
