
-- Crea el esquema milab si no existe y lo usa para todas las operaciones
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'milab') THEN
        EXECUTE 'CREATE SCHEMA milab';
    END IF;
END$$;

SET search_path TO milab;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

SET TIME ZONE 'America/Bogota';

BEGIN;

CREATE TABLE usuario (
    id BIGSERIAL PRIMARY KEY,
    correo CHARACTER VARYING(255) NOT NULL UNIQUE,
    documento CHARACTER VARYING(50) NOT NULL UNIQUE,
    nombre CHARACTER VARYING(200) NOT NULL,
    codigo BIGINT,
    estado CHARACTER VARYING(20),
    carrera CHARACTER VARYING(100),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE rol (
    id SERIAL PRIMARY KEY,
    nombre CHARACTER VARYING(40) NOT NULL UNIQUE,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE usuario_rol (
    usuario_id BIGINT NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
    rol_id INT NOT NULL REFERENCES rol(id) ON DELETE CASCADE,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    meta JSONB,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (usuario_id, rol_id)
);

CREATE TABLE perfil_estudiante (
    usuario_id BIGINT PRIMARY KEY REFERENCES usuario(id) ON DELETE CASCADE,
    documento CHARACTER VARYING(50) NOT NULL,
    nombre CHARACTER VARYING(500),
    codigo BIGINT,
    programa CHARACTER VARYING(255),
    estado CHARACTER VARYING(50),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE perfil_docente (
    usuario_id BIGINT PRIMARY KEY REFERENCES usuario(id) ON DELETE CASCADE,
    documento CHARACTER VARYING(50) NOT NULL,
    nombre CHARACTER VARYING(500),
    estado CHARACTER VARYING(50),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE menu_item (
    id SERIAL PRIMARY KEY,
    parent_id INT REFERENCES menu_item(id) ON DELETE CASCADE,
    section CHARACTER VARYING(20) NOT NULL,
    label CHARACTER VARYING(200) NOT NULL,
    route CHARACTER VARYING(200),
    icon CHARACTER VARYING(100),
    order_index INT NOT NULL DEFAULT 0,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_menu_item_unique
    ON menu_item (section, parent_id, label, route) NULLS NOT DISTINCT;

CREATE INDEX idx_menu_item_parent ON menu_item(parent_id);
CREATE INDEX idx_menu_item_section ON menu_item(section);

CREATE TABLE rol_permiso (
    rol_id INT NOT NULL REFERENCES rol(id) ON DELETE CASCADE,
    menu_item_id INT NOT NULL REFERENCES menu_item(id) ON DELETE CASCADE,
    can_view BOOLEAN NOT NULL DEFAULT TRUE,
    can_use BOOLEAN NOT NULL DEFAULT TRUE,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (rol_id, menu_item_id)
);

CREATE TABLE certificado_estudiante (
    id SERIAL PRIMARY KEY,
    usuario_id BIGINT NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_vencimiento TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    certificado_id CHARACTER VARYING(100),
    motivo_expedicion CHARACTER VARYING(500),
    correo CHARACTER VARYING(255),
    motivo_exp CHARACTER VARYING(500),
    multa CHARACTER VARYING(100),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE certificado_docente (
    id SERIAL PRIMARY KEY,
    usuario_id BIGINT NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    certificado_id CHARACTER VARYING(100),
    correo CHARACTER VARYING(255),
    motivo_exp CHARACTER VARYING(500),
    multa INTEGER,
    origen_descarga CHARACTER VARYING(255),
    estado_docente CHARACTER VARYING(50),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Facultades (padre_id NULL) y dependencias (padre_id = facultad).
CREATE TABLE dependencia_facultad (
    dependencia_facultad_id SERIAL PRIMARY KEY,
    nombre CHARACTER VARYING(255) NOT NULL,
    padre_id INTEGER,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_dependencia_facultad_padre FOREIGN KEY (padre_id)
        REFERENCES dependencia_facultad(dependencia_facultad_id) ON DELETE RESTRICT,
    CONSTRAINT chk_dependencia_facultad_padre_distinto
        CHECK (padre_id IS NULL OR padre_id <> dependencia_facultad_id)
);

CREATE INDEX idx_dependencia_facultad_padre_id ON dependencia_facultad(padre_id);

CREATE OR REPLACE FUNCTION validar_jerarquia_dependencia_facultad()
RETURNS TRIGGER AS $$
DECLARE
    padre_del_padre INTEGER;
BEGIN
    IF NEW.padre_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT padre_id INTO padre_del_padre
    FROM milab.dependencia_facultad
    WHERE dependencia_facultad_id = NEW.padre_id
    FOR SHARE;

    IF padre_del_padre IS NOT NULL THEN
        RAISE EXCEPTION 'La dependencia % solo puede pertenecer a una facultad (registro sin padre)', NEW.dependencia_facultad_id
            USING ERRCODE = 'check_violation';
    END IF;

    IF EXISTS (
        SELECT 1 FROM milab.dependencia_facultad
        WHERE padre_id = NEW.dependencia_facultad_id
    ) THEN
        RAISE EXCEPTION 'La facultad % tiene dependencias y no puede asignarse a otra facultad', NEW.dependencia_facultad_id
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validar_jerarquia_dependencia_facultad
BEFORE INSERT OR UPDATE OF padre_id ON dependencia_facultad
FOR EACH ROW
EXECUTE FUNCTION validar_jerarquia_dependencia_facultad();

CREATE TABLE ual (
    ual_id SERIAL PRIMARY KEY,
    nombre CHARACTER VARYING(255) NOT NULL,
    codigo_abreviacion CHARACTER VARYING(30),
    descripcion CHARACTER VARYING(255),
    sal_ocupantes CHARACTER VARYING(30),
    sal_id_espacio CHARACTER VARYING(30),
    facultad_id INT NOT NULL REFERENCES dependencia_facultad(dependencia_facultad_id),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_ual_codigo_abreviacion_formato CHECK (
        codigo_abreviacion IS NULL
        OR codigo_abreviacion ~ '^[A-Z0-9_-]+$'
    )
);

CREATE TABLE laboratorista (
    documento CHARACTER VARYING(50) PRIMARY KEY,
    nombre CHARACTER VARYING(100) NOT NULL,
    n_usuario CHARACTER VARYING(50) UNIQUE,
    correo CHARACTER VARYING(50) UNIQUE NOT NULL,
    contrato CHARACTER VARYING(50),
    usuario_id BIGINT REFERENCES usuario(id) ON DELETE SET NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE monitor (
    documento CHARACTER VARYING(50) PRIMARY KEY,
    nombre CHARACTER VARYING(255) NOT NULL,
    correo CHARACTER VARYING(255) UNIQUE NOT NULL,
    numero_contrato CHARACTER VARYING(100),
    tipo_vinculacion CHARACTER VARYING(100),
    fecha_inicio DATE,
    fecha_fin DATE,
    soporte_contrato CHARACTER VARYING(1000),
    usuario_id BIGINT REFERENCES usuario(id) ON DELETE SET NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE coordinador (
    documento CHARACTER VARYING(50) PRIMARY KEY,
    nombre CHARACTER VARYING(255) NOT NULL,
    correo CHARACTER VARYING(255) UNIQUE,
    numero_resolucion_coordinador CHARACTER VARYING(100),
    soporte_resolucion CHARACTER VARYING(1000),
    nombre_u CHARACTER VARYING(50),
    usuario_id BIGINT REFERENCES usuario(id) ON DELETE SET NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE coordinador_facultad (
    coordinador_documento_id CHARACTER VARYING(50) NOT NULL,
    facultad_id INT NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (coordinador_documento_id, facultad_id),
    CONSTRAINT fk_cf_coordinador FOREIGN KEY (coordinador_documento_id)
        REFERENCES coordinador(documento) ON DELETE CASCADE,
    CONSTRAINT fk_cf_facultad FOREIGN KEY (facultad_id)
        REFERENCES dependencia_facultad(dependencia_facultad_id) ON DELETE CASCADE
);

-- Alcance efectivo del coordinador: asignaciones directas más las
-- dependencias de cada facultad asignada.
CREATE OR REPLACE VIEW coordinador_facultad_alcance AS
SELECT cf.coordinador_documento_id,
       cf.facultad_id,
       cf.facultad_id AS facultad_asignada_id,
       cf.activo,
       cf.fecha_modificacion
FROM coordinador_facultad cf
UNION
SELECT cf.coordinador_documento_id,
       d.dependencia_facultad_id AS facultad_id,
       cf.facultad_id AS facultad_asignada_id,
       cf.activo,
       cf.fecha_modificacion
FROM coordinador_facultad cf
JOIN dependencia_facultad d ON d.padre_id = cf.facultad_id;

CREATE TABLE laboratorista_ual (
    laboratorista_documento_id CHARACTER VARYING(50) NOT NULL,
    ual_id INT NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (laboratorista_documento_id, ual_id),
    CONSTRAINT fk_lu_laboratorista FOREIGN KEY (laboratorista_documento_id)
        REFERENCES laboratorista(documento) ON DELETE CASCADE,
    CONSTRAINT fk_lu_ual FOREIGN KEY (ual_id)
        REFERENCES ual(ual_id) ON DELETE RESTRICT
);

CREATE TABLE usuario_ual_rol_operativo (
    id SERIAL PRIMARY KEY,
    usuario_id BIGINT NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
    rol_id INT NOT NULL REFERENCES rol(id) ON DELETE CASCADE,
    ual_id INT NOT NULL REFERENCES ual(ual_id) ON DELETE CASCADE,
    creado_por_id BIGINT REFERENCES usuario(id) ON DELETE SET NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_usuario_ual_rol_operativo UNIQUE (usuario_id, rol_id, ual_id)
);

CREATE TABLE categoria_sancion (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL CHECK (char_length(btrim(nombre)) BETWEEN 2 AND 150),
    descripcion VARCHAR(500) NOT NULL CHECK (char_length(btrim(descripcion)) BETWEEN 2 AND 500),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX categoria_sancion_nombre_unique
    ON categoria_sancion (lower(btrim(nombre)));
CREATE UNIQUE INDEX categoria_sancion_descripcion_unique
    ON categoria_sancion (lower(btrim(descripcion)));

CREATE TABLE multa (
    id SERIAL PRIMARY KEY,
    cat_multa CHARACTER VARYING(100),
    laboratorista_documento_id CHARACTER VARYING(50) NOT NULL REFERENCES laboratorista(documento) ON DELETE RESTRICT,
    usuario_sancionado_id BIGINT NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
    ual_id INT NOT NULL REFERENCES ual(ual_id) ON DELETE RESTRICT,
    fecha_multa DATE,
    con_estado_multa CHARACTER VARYING(50),
    obs_multa CHARACTER VARYING(500),
    tipo_sancion CHARACTER VARYING(100),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE reclamacion_sancion (
    id SERIAL PRIMARY KEY,
    multa_id INTEGER NOT NULL UNIQUE REFERENCES multa(id) ON DELETE RESTRICT,
    responsable_documento_id VARCHAR(50) NOT NULL REFERENCES laboratorista(documento) ON DELETE RESTRICT,
    texto VARCHAR(500) NOT NULL CHECK (char_length(btrim(texto)) BETWEEN 1 AND 500),
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    respuesta VARCHAR(500),
    decision VARCHAR(20),
    respondido_por_id VARCHAR(50) REFERENCES laboratorista(documento) ON DELETE RESTRICT,
    fecha_respuesta TIMESTAMPTZ,
    fecha_lectura TIMESTAMPTZ,
    CONSTRAINT reclamacion_sancion_respuesta_check CHECK (
        (respuesta IS NULL AND decision IS NULL AND respondido_por_id IS NULL AND fecha_respuesta IS NULL AND fecha_lectura IS NULL)
        OR
        (respuesta IS NOT NULL AND char_length(btrim(respuesta)) BETWEEN 1 AND 500
         AND decision IS NOT NULL AND decision IN ('PROCEDE', 'NO_PROCEDE')
         AND respondido_por_id IS NOT NULL AND fecha_respuesta IS NOT NULL)
    )
);
CREATE INDEX idx_reclamacion_sancion_pendiente
    ON reclamacion_sancion (responsable_documento_id, fecha_creacion)
    WHERE fecha_respuesta IS NULL;
COMMENT ON COLUMN milab.reclamacion_sancion.multa_id IS 'Referencia a milab.multa.id';
COMMENT ON COLUMN milab.reclamacion_sancion.responsable_documento_id IS 'Referencia a milab.laboratorista.documento';
COMMENT ON COLUMN milab.reclamacion_sancion.respondido_por_id IS 'Referencia a milab.laboratorista.documento';

CREATE TABLE log (
    id SERIAL PRIMARY KEY,
    nombre CHARACTER VARYING(500),
    documento NUMERIC(16,0),
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    accion CHARACTER VARYING(500),
    persona CHARACTER VARYING(255),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_coordinador_facultad_coordinador_documento_id ON coordinador_facultad(coordinador_documento_id);
CREATE INDEX idx_coordinador_facultad_facultad_id ON coordinador_facultad(facultad_id);
CREATE INDEX idx_laboratorista_ual_laboratorista_documento_id ON laboratorista_ual(laboratorista_documento_id);
CREATE INDEX idx_laboratorista_ual_ual_id ON laboratorista_ual(ual_id);
CREATE INDEX idx_monitor_usuario_id ON monitor(usuario_id);
CREATE INDEX idx_usuario_ual_rol_operativo_usuario_id ON usuario_ual_rol_operativo(usuario_id);
CREATE INDEX idx_usuario_ual_rol_operativo_rol_id ON usuario_ual_rol_operativo(rol_id);
CREATE INDEX idx_usuario_ual_rol_operativo_ual_id ON usuario_ual_rol_operativo(ual_id);
CREATE UNIQUE INDEX idx_ual_codigo_abreviacion_unique
    ON ual (LOWER(codigo_abreviacion))
    WHERE codigo_abreviacion IS NOT NULL;
CREATE INDEX idx_certificado_estudiante_usuario ON certificado_estudiante(usuario_id);
CREATE INDEX idx_certificado_docente_usuario ON certificado_docente(usuario_id);
CREATE INDEX idx_multa_usuario_sancionado_id ON multa(usuario_sancionado_id);
CREATE INDEX idx_multa_laboratorista_documento_id ON multa(laboratorista_documento_id);
CREATE INDEX idx_multa_ual_id ON multa(ual_id);

COMMENT ON COLUMN milab.usuario_rol.usuario_id IS 'Referencia a milab.usuario.id';
COMMENT ON COLUMN milab.usuario_rol.rol_id IS 'Referencia a milab.rol.id';
COMMENT ON COLUMN milab.perfil_estudiante.usuario_id IS 'Referencia a milab.usuario.id';
COMMENT ON COLUMN milab.perfil_docente.usuario_id IS 'Referencia a milab.usuario.id';
COMMENT ON COLUMN milab.menu_item.parent_id IS 'Referencia a milab.menu_item.id';
COMMENT ON COLUMN milab.rol_permiso.rol_id IS 'Referencia a milab.rol.id';
COMMENT ON COLUMN milab.rol_permiso.menu_item_id IS 'Referencia a milab.menu_item.id';
COMMENT ON COLUMN milab.certificado_estudiante.usuario_id IS 'Referencia a milab.usuario.id';
COMMENT ON COLUMN milab.certificado_docente.usuario_id IS 'Referencia a milab.usuario.id';
COMMENT ON COLUMN milab.dependencia_facultad.padre_id IS 'Referencia a milab.dependencia_facultad.dependencia_facultad_id (facultad padre; NULL = facultad)';
COMMENT ON COLUMN milab.ual.facultad_id IS 'Referencia a milab.dependencia_facultad.dependencia_facultad_id';
COMMENT ON COLUMN milab.ual.codigo_abreviacion IS 'Código abreviado opcional de la UAL';
COMMENT ON COLUMN milab.ual.descripcion IS 'Descripción opcional de la UAL para contexto operativo';
COMMENT ON COLUMN milab.ual.sal_ocupantes IS 'Capacidad u ocupantes reportados del espacio UAL';
COMMENT ON COLUMN milab.ual.sal_id_espacio IS 'Identificador de espacio (SAL_ID_ESPACIO) proveniente de fuente externa';
COMMENT ON COLUMN milab.laboratorista.usuario_id IS 'Referencia a milab.usuario.id';
COMMENT ON COLUMN milab.monitor.usuario_id IS 'Referencia a milab.usuario.id';
COMMENT ON COLUMN milab.coordinador.usuario_id IS 'Referencia a milab.usuario.id';
COMMENT ON COLUMN milab.coordinador_facultad.coordinador_documento_id IS 'Referencia a milab.coordinador.documento';
COMMENT ON COLUMN milab.coordinador_facultad.facultad_id IS 'Referencia a milab.dependencia_facultad.dependencia_facultad_id';
COMMENT ON COLUMN milab.laboratorista_ual.laboratorista_documento_id IS 'Referencia a milab.laboratorista.documento';
COMMENT ON COLUMN milab.laboratorista_ual.ual_id IS 'Referencia a milab.ual.ual_id';
COMMENT ON COLUMN milab.usuario_ual_rol_operativo.usuario_id IS 'Referencia a milab.usuario.id';
COMMENT ON COLUMN milab.usuario_ual_rol_operativo.rol_id IS 'Referencia a milab.rol.id';
COMMENT ON COLUMN milab.usuario_ual_rol_operativo.ual_id IS 'Referencia a milab.ual.ual_id';
COMMENT ON COLUMN milab.usuario_ual_rol_operativo.creado_por_id IS 'Referencia a milab.usuario.id';
COMMENT ON COLUMN milab.multa.laboratorista_documento_id IS 'Referencia a milab.laboratorista.documento';
COMMENT ON COLUMN milab.multa.usuario_sancionado_id IS 'Referencia a milab.usuario.id';
COMMENT ON COLUMN milab.multa.ual_id IS 'Referencia a milab.ual.ual_id';

ALTER TABLE multa
ALTER COLUMN tipo_sancion TYPE CHARACTER VARYING(500);

ALTER TABLE multa
ALTER COLUMN cat_multa TYPE CHARACTER VARYING(500);

CREATE TABLE IF NOT EXISTS config_facultad_multas (
    facultad_id INTEGER NOT NULL PRIMARY KEY,
    permite_crear_multas_activas_directas BOOLEAN NOT NULL DEFAULT FALSE,
    permite_saldar_multas_directas BOOLEAN NOT NULL DEFAULT FALSE,
    fecha_ultima_modificacion TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    documento_ultimo_autorizador TEXT,
    accion_ultima TEXT DEFAULT 'inicial',
    CONSTRAINT config_facultad_multas_facultad_fk
        FOREIGN KEY (facultad_id) REFERENCES milab.dependencia_facultad(dependencia_facultad_id)
        ON DELETE CASCADE
);

INSERT INTO config_facultad_multas (facultad_id)
SELECT dependencia_facultad_id
FROM milab.dependencia_facultad
ON CONFLICT (facultad_id) DO NOTHING;

COMMIT;
