
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

CREATE TABLE facultad (
    facultad_id SERIAL PRIMARY KEY,
    nombre CHARACTER VARYING(255) NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ual (
    ual_id SERIAL PRIMARY KEY,
    nombre CHARACTER VARYING(255) NOT NULL,
    facultad_id INT NOT NULL REFERENCES facultad(facultad_id),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE laboratorista (
    documento CHARACTER VARYING(50) PRIMARY KEY,
    nombre CHARACTER VARYING(100) NOT NULL,
    n_usuario CHARACTER VARYING(50) UNIQUE,
    correo CHARACTER VARYING(50) UNIQUE NOT NULL,
    ual_id INT REFERENCES ual(ual_id),
    facultad_id INT REFERENCES facultad(facultad_id),
    contrato CHARACTER VARYING(50),
    usuario_id BIGINT REFERENCES usuario(id) ON DELETE SET NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE coordinador (
    documento CHARACTER VARYING(50) PRIMARY KEY,
    nombre CHARACTER VARYING(255) NOT NULL,
    correo CHARACTER VARYING(255) UNIQUE,
    facultad_id INT REFERENCES facultad(facultad_id),
    numero_resolucion_coordinador CHARACTER VARYING(100),
    soporte_resolucion CHARACTER VARYING(1000),
    nombre_u CHARACTER VARYING(50),
    usuario_id BIGINT REFERENCES usuario(id) ON DELETE SET NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE coordinador_facultad (
    documento CHARACTER VARYING(50) NOT NULL,
    facultad_id INT NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (documento, facultad_id),
    CONSTRAINT fk_cf_coordinador FOREIGN KEY (documento)
        REFERENCES coordinador(documento) ON DELETE CASCADE,
    CONSTRAINT fk_cf_facultad FOREIGN KEY (facultad_id)
        REFERENCES facultad(facultad_id) ON DELETE CASCADE
);

CREATE TABLE laboratorista_ual (
    documento CHARACTER VARYING(50) NOT NULL,
    ual_id INT NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (documento, ual_id),
    CONSTRAINT fk_lu_laboratorista FOREIGN KEY (documento)
        REFERENCES laboratorista(documento) ON DELETE CASCADE,
    CONSTRAINT fk_lu_ual FOREIGN KEY (ual_id)
        REFERENCES ual(ual_id) ON DELETE RESTRICT
);

CREATE TABLE multa (
    id SERIAL PRIMARY KEY,
    cat_multa CHARACTER VARYING(100),
    documento_laboratorista CHARACTER VARYING(50) NOT NULL REFERENCES laboratorista(documento) ON DELETE RESTRICT,
    usuario_id_sancionado BIGINT NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
    ual_id INT NOT NULL REFERENCES ual(ual_id) ON DELETE RESTRICT,
    fecha_multa DATE,
    con_estado_multa CHARACTER VARYING(50),
    obs_multa CHARACTER VARYING(500),
    tipo_sancion CHARACTER VARYING(100),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

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

CREATE INDEX idx_coordinador_facultad_documento ON coordinador_facultad(documento);
CREATE INDEX idx_coordinador_facultad_facultad_id ON coordinador_facultad(facultad_id);
CREATE INDEX idx_laboratorista_ual_documento ON laboratorista_ual(documento);
CREATE INDEX idx_laboratorista_ual_ual_id ON laboratorista_ual(ual_id);
CREATE INDEX idx_certificado_estudiante_usuario ON certificado_estudiante(usuario_id);
CREATE INDEX idx_certificado_docente_usuario ON certificado_docente(usuario_id);
CREATE INDEX idx_multa_usuario_sancionado ON multa(usuario_id_sancionado);
CREATE INDEX idx_multa_documento_laboratorista ON multa(documento_laboratorista);
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
COMMENT ON COLUMN milab.ual.facultad_id IS 'Referencia a milab.facultad.facultad_id';
COMMENT ON COLUMN milab.laboratorista.ual_id IS 'Referencia a milab.ual.ual_id';
COMMENT ON COLUMN milab.laboratorista.facultad_id IS 'Referencia a milab.facultad.facultad_id';
COMMENT ON COLUMN milab.laboratorista.usuario_id IS 'Referencia a milab.usuario.id';
COMMENT ON COLUMN milab.coordinador.facultad_id IS 'Referencia a milab.facultad.facultad_id';
COMMENT ON COLUMN milab.coordinador.usuario_id IS 'Referencia a milab.usuario.id';
COMMENT ON COLUMN milab.coordinador_facultad.documento IS 'Referencia a milab.coordinador.documento';
COMMENT ON COLUMN milab.coordinador_facultad.facultad_id IS 'Referencia a milab.facultad.facultad_id';
COMMENT ON COLUMN milab.laboratorista_ual.documento IS 'Referencia a milab.laboratorista.documento';
COMMENT ON COLUMN milab.laboratorista_ual.ual_id IS 'Referencia a milab.ual.ual_id';
COMMENT ON COLUMN milab.multa.documento_laboratorista IS 'Referencia a milab.laboratorista.documento';
COMMENT ON COLUMN milab.multa.usuario_id_sancionado IS 'Referencia a milab.usuario.id';
COMMENT ON COLUMN milab.multa.ual_id IS 'Referencia a milab.ual.ual_id';

COMMIT;
