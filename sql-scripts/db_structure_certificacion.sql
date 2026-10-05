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
    CONSTRAINT ck_codigo_curso_cursos CHECK (BTRIM(codigo_curso) <> ''),
    CONSTRAINT ck_nombre_curso_cursos CHECK (BTRIM(nombre_curso) <> ''),
    CONSTRAINT ck_url_edx_cursos CHECK (BTRIM(url_edx) <> '')
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
    CONSTRAINT fk_curso_laboratorio_cursos FOREIGN KEY (codigo_curso)
        REFERENCES cursos(codigo_curso) ON DELETE CASCADE,
    CONSTRAINT fk_curso_laboratorio_ual FOREIGN KEY (id_laboratorio)
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
    CONSTRAINT fk_equipo_especializado_cursos FOREIGN KEY (codigo_curso)
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

-- ============================================================
-- MODULO CAPACITACION SOLICITUDES / SESIONES / CERTIFICACIONES
--
-- Lineamientos OIST aplicados (5 tablas NUEVAS, sin despliegue):
--   * PK = id (BIGSERIAL)
--   * FK columna = <tabla_referenciada>_id
--   * CHECK = ck_<columna>_<tabla>
--   * UNIQUE = uq_<columna(s)>_<tabla>  [INDEX WHERE para condicionales]
--   * FK = fk_<tabla_origen>_<tabla_destino_COMPLETA>
--   * activo + fecha_creacion + fecha_modificacion en todas
--
-- Nombres de columnas = COINCIDEN 1:1 con queries JS en
--   capacitacion-gestion.js + prestamos.js (evita desalineación)
-- ============================================================

CREATE TABLE IF NOT EXISTS solicitud_capacitacion (
    id BIGSERIAL NOT NULL,
    codigo_curso VARCHAR(100) NOT NULL,
    solicitante_documento VARCHAR(50) NOT NULL,
    solicitante_usuario_id INT,
    solicitante_nombre VARCHAR(255),
    nombre_curso_snapshot VARCHAR(255),
    ual_id INT,
    facultad_id INT,
    estado VARCHAR(30) NOT NULL DEFAULT 'pendiente',
    mensaje_solicitante TEXT,
    motivo TEXT,
    observaciones_laboratorista TEXT,
    notas_internas TEXT,
    fecha_notificacion_programacion TIMESTAMPTZ,
    sesion_capacitacion_id BIGINT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    creado_por_documento VARCHAR(50),
    modificado_por_documento VARCHAR(50),
    CONSTRAINT pk_solicitud_capacitacion PRIMARY KEY (id),
    CONSTRAINT fk_solicitud_capacitacion_cursos FOREIGN KEY (codigo_curso)
        REFERENCES cursos(codigo_curso) ON DELETE CASCADE,
    CONSTRAINT fk_solicitud_capacitacion_usuario FOREIGN KEY (solicitante_usuario_id)
        REFERENCES usuario(id) ON DELETE SET NULL,
    CONSTRAINT fk_solicitud_capacitacion_ual FOREIGN KEY (ual_id)
        REFERENCES ual(ual_id) ON DELETE SET NULL,
    CONSTRAINT fk_solicitud_capacitacion_facultad FOREIGN KEY (facultad_id)
        REFERENCES facultad(facultad_id) ON DELETE SET NULL,
    CONSTRAINT fk_solicitud_capacitacion_sesion_capacitacion FOREIGN KEY (sesion_capacitacion_id)
        REFERENCES sesion_capacitacion(id) ON DELETE SET NULL,
    CONSTRAINT ck_estado_solicitud_capacitacion CHECK (
        estado IN ('pendiente','notificado','notificado_programada','atendido','atendido_cerrado','cancelado')
    ),
    CONSTRAINT ck_solicitante_documento_solicitud_capacitacion CHECK (
        BTRIM(COALESCE(solicitante_documento,'')) <> ''
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_solicitante_documento_codigo_curso_estado_solicitud_capacitacion
    ON solicitud_capacitacion(solicitante_documento, codigo_curso, estado)
    WHERE estado IN ('pendiente','notificado','notificado_programada');
CREATE INDEX IF NOT EXISTS idx_solicitud_capacitacion_estado_activo
    ON solicitud_capacitacion(estado, activo);
CREATE INDEX IF NOT EXISTS idx_solicitud_capacitacion_sesion_capacitacion
    ON solicitud_capacitacion(sesion_capacitacion_id);

CREATE TABLE IF NOT EXISTS sesion_capacitacion (
    id BIGSERIAL NOT NULL,
    codigo_curso VARCHAR(100) NOT NULL,
    nombre_curso_snapshot VARCHAR(255),
    ual_id INT NOT NULL,
    facultad_id INT NOT NULL,
    laboratorista_responsable_doc VARCHAR(50) NOT NULL,
    laboratorista_responsable_nombre VARCHAR(255),
    fecha_inicio TIMESTAMPTZ NOT NULL,
    fecha_fin TIMESTAMPTZ NOT NULL,
    cupo_maximo INT NOT NULL,
    lugar VARCHAR(255),
    descripcion TEXT,
    enlace_sesion TEXT,
    estado VARCHAR(20) NOT NULL DEFAULT 'programada',
    evidencia_path TEXT,
    evidencia_nombre_original TEXT,
    evidencia_mime VARCHAR(100),
    evidencia_fecha_subida TIMESTAMPTZ,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    creado_por_documento VARCHAR(50),
    modificado_por_documento VARCHAR(50),
    CONSTRAINT pk_sesion_capacitacion PRIMARY KEY (id),
    CONSTRAINT fk_sesion_capacitacion_cursos FOREIGN KEY (codigo_curso)
        REFERENCES cursos(codigo_curso) ON DELETE RESTRICT,
    CONSTRAINT fk_sesion_capacitacion_ual FOREIGN KEY (ual_id)
        REFERENCES ual(ual_id) ON DELETE RESTRICT,
    CONSTRAINT fk_sesion_capacitacion_facultad FOREIGN KEY (facultad_id)
        REFERENCES facultad(facultad_id) ON DELETE RESTRICT,
    CONSTRAINT ck_estado_sesion_capacitacion CHECK (
        estado IN ('programada','en_curso','realizada','cancelada')
    ),
    CONSTRAINT ck_cupo_maximo_sesion_capacitacion CHECK (cupo_maximo >= 1),
    CONSTRAINT ck_fecha_inicio_sesion_capacitacion CHECK (
        fecha_fin > fecha_inicio
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_codigo_curso_ual_id_fecha_inicio_sesion_capacitacion
    ON sesion_capacitacion(codigo_curso, ual_id, fecha_inicio)
    WHERE activo = TRUE;
CREATE INDEX IF NOT EXISTS idx_sesion_capacitacion_ual_fecha
    ON sesion_capacitacion(ual_id, fecha_inicio);
CREATE INDEX IF NOT EXISTS idx_sesion_capacitacion_estado_activo
    ON sesion_capacitacion(estado, activo);

CREATE TABLE IF NOT EXISTS inscripcion_sesion_capacitacion (
    id BIGSERIAL NOT NULL,
    sesion_capacitacion_id BIGINT NOT NULL,
    usuario_documento VARCHAR(50) NOT NULL,
    usuario_id INT,
    usuario_nombre VARCHAR(255),
    fecha_inscripcion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    origen VARCHAR(30) NOT NULL DEFAULT 'directa',
    solicitud_capacitacion_id BIGINT,
    estado VARCHAR(30) NOT NULL DEFAULT 'inscrito',
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    creado_por_documento VARCHAR(50),
    modificado_por_documento VARCHAR(50),
    CONSTRAINT pk_inscripcion_sesion_capacitacion PRIMARY KEY (id),
    CONSTRAINT fk_inscripcion_sesion_capacitacion_sesion_capacitacion FOREIGN KEY (sesion_capacitacion_id)
        REFERENCES sesion_capacitacion(id) ON DELETE CASCADE,
    CONSTRAINT fk_inscripcion_sesion_capacitacion_usuario FOREIGN KEY (usuario_id)
        REFERENCES usuario(id) ON DELETE SET NULL,
    CONSTRAINT fk_inscripcion_sesion_capacitacion_solicitud_capacitacion FOREIGN KEY (solicitud_capacitacion_id)
        REFERENCES solicitud_capacitacion(id) ON DELETE SET NULL,
    CONSTRAINT ck_origen_inscripcion_sesion_capacitacion CHECK (
        origen IN ('directa','lista_espera_solicitud')
    ),
    CONSTRAINT ck_estado_inscripcion_sesion_capacitacion CHECK (
        estado IN ('inscrito','cancelado','cancelado_estudiante','cupo_excedido','cupo_excedido_lista_espera')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sesion_capacitacion_id_usuario_documento_inscripcion_sesion_capacitacion
    ON inscripcion_sesion_capacitacion(sesion_capacitacion_id, usuario_documento)
    WHERE estado IN ('inscrito','cupo_excedido','cupo_excedido_lista_espera') AND activo = TRUE;
CREATE INDEX IF NOT EXISTS idx_inscripcion_sesion_capacitacion_usuario
    ON inscripcion_sesion_capacitacion(sesion_capacitacion_id, usuario_documento);
CREATE INDEX IF NOT EXISTS idx_inscripcion_sesion_capacitacion_estado_activo
    ON inscripcion_sesion_capacitacion(estado, activo);
CREATE INDEX IF NOT EXISTS idx_inscripcion_sesion_capacitacion_solicitud_capacitacion
    ON inscripcion_sesion_capacitacion(solicitud_capacitacion_id);

CREATE TABLE IF NOT EXISTS asistencia_capacitacion (
    id BIGSERIAL NOT NULL,
    sesion_capacitacion_id BIGINT NOT NULL,
    usuario_documento VARCHAR(50) NOT NULL,
    inscripcion_sesion_capacitacion_id BIGINT,
    asistio BOOLEAN NOT NULL DEFAULT FALSE,
    fecha_registro TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    metodo VARCHAR(30) NOT NULL DEFAULT 'manual',
    registrado_por_laboratorista_doc VARCHAR(50),
    registrado_por_laboratorista_nombre VARCHAR(255),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    creado_por_documento VARCHAR(50),
    modificado_por_documento VARCHAR(50),
    CONSTRAINT pk_asistencia_capacitacion PRIMARY KEY (id),
    CONSTRAINT fk_asistencia_capacitacion_sesion_capacitacion FOREIGN KEY (sesion_capacitacion_id)
        REFERENCES sesion_capacitacion(id) ON DELETE CASCADE,
    CONSTRAINT fk_asistencia_capacitacion_inscripcion_sesion_capacitacion FOREIGN KEY (inscripcion_sesion_capacitacion_id)
        REFERENCES inscripcion_sesion_capacitacion(id) ON DELETE SET NULL,
    CONSTRAINT ck_metodo_asistencia_capacitacion CHECK (
        metodo IN ('manual','qr_documento','lista_asistencia')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sesion_capacitacion_id_usuario_documento_asistencia_capacitacion
    ON asistencia_capacitacion(sesion_capacitacion_id, usuario_documento)
    WHERE activo = TRUE;
CREATE INDEX IF NOT EXISTS idx_asistencia_capacitacion_asistio
    ON asistencia_capacitacion(sesion_capacitacion_id, asistio, activo);
CREATE INDEX IF NOT EXISTS idx_asistencia_capacitacion_inscripcion
    ON asistencia_capacitacion(inscripcion_sesion_capacitacion_id);

CREATE TABLE IF NOT EXISTS certificacion_usuario (
    id BIGSERIAL NOT NULL,
    codigo_curso VARCHAR(100) NOT NULL,
    nombre_curso_snapshot VARCHAR(255),
    facultad_id INT,
    usuario_documento VARCHAR(50) NOT NULL,
    usuario_id INT,
    usuario_nombre VARCHAR(255),
    modalidad VARCHAR(20) NOT NULL,
    fecha_emision TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_vencimiento TIMESTAMPTZ NOT NULL,
    vigencia_meses INT NOT NULL DEFAULT 12,
    sesion_capacitacion_id BIGINT,
    ual_id INT,
    solicitud_prestamo_id INT,
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
    CONSTRAINT fk_certificacion_usuario_cursos FOREIGN KEY (codigo_curso)
        REFERENCES cursos(codigo_curso) ON DELETE RESTRICT,
    CONSTRAINT fk_certificacion_usuario_sesion_capacitacion FOREIGN KEY (sesion_capacitacion_id)
        REFERENCES sesion_capacitacion(id) ON DELETE SET NULL,
    CONSTRAINT fk_certificacion_usuario_ual FOREIGN KEY (ual_id)
        REFERENCES ual(ual_id) ON DELETE SET NULL,
    CONSTRAINT fk_certificacion_usuario_facultad FOREIGN KEY (facultad_id)
        REFERENCES facultad(facultad_id) ON DELETE SET NULL,
    CONSTRAINT fk_certificacion_usuario_usuario FOREIGN KEY (usuario_id)
        REFERENCES usuario(id) ON DELETE SET NULL,
    CONSTRAINT fk_certificacion_usuario_solicitud_prestamo FOREIGN KEY (solicitud_prestamo_id)
        REFERENCES solicitud_prestamo(id) ON DELETE SET NULL,
    CONSTRAINT fk_certificacion_usuario_entrega_equipo FOREIGN KEY (entrega_equipo_id)
        REFERENCES entrega_equipo(id) ON DELETE SET NULL,
    CONSTRAINT ck_modalidad_certificacion_usuario CHECK (
        modalidad IN ('programada','prestamo')
    ),
    CONSTRAINT ck_vigencia_meses_certificacion_usuario CHECK (
        vigencia_meses BETWEEN 1 AND 60
    ),
    CONSTRAINT ck_fecha_emision_certificacion_usuario CHECK (
        fecha_vencimiento > fecha_emision
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_codigo_curso_usuario_documento_certificacion_usuario
    ON certificacion_usuario(codigo_curso, usuario_documento)
    WHERE activo = TRUE;
CREATE INDEX IF NOT EXISTS idx_certificacion_usuario_doc_curso_vig
    ON certificacion_usuario(usuario_documento, codigo_curso, fecha_vencimiento, activo);
CREATE INDEX IF NOT EXISTS idx_certificacion_usuario_sesion_capacitacion
    ON certificacion_usuario(sesion_capacitacion_id);
CREATE INDEX IF NOT EXISTS idx_certificacion_usuario_solicitud_prestamo
    ON certificacion_usuario(solicitud_prestamo_id);
CREATE INDEX IF NOT EXISTS idx_certificacion_usuario_entrega_equipo
    ON certificacion_usuario(entrega_equipo_id);


-- ============================================================
-- TRIGGER: sesion_capacitacion valida que UAL pertenece
-- a la MISMA facultad del curso (igual a curso_laboratorio).
-- ============================================================

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
    WHERE ual_id = NEW.ual_id;

    IF facultad_curso IS DISTINCT FROM facultad_ual THEN
        RAISE EXCEPTION
            'La UAL/Laboratorio % (facultad %) no coincide con la facultad (%) del curso %',
            NEW.ual_id,
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
BEFORE INSERT OR UPDATE OF codigo_curso, ual_id, facultad_id
ON sesion_capacitacion
FOR EACH ROW
EXECUTE FUNCTION validar_facultad_sesion_capacitacion();

COMMIT;
