-- Esquema canonico de MILab.
-- Este archivo describe el estado final esperado de la base.

CREATE EXTENSION pgcrypto;

SET TIME ZONE 'America/Bogota';

BEGIN;

CREATE TABLE usuario (
    id BIGSERIAL PRIMARY KEY,
    correo VARCHAR(255) NOT NULL UNIQUE,
    documento VARCHAR(50) NOT NULL UNIQUE,
    nombre VARCHAR(200) NOT NULL,
    codigo BIGINT,
    estado VARCHAR(20),
    carrera VARCHAR(100),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE rol (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(40) NOT NULL UNIQUE,
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
    documento VARCHAR(50) NOT NULL,
    nombre VARCHAR(500),
    codigo BIGINT,
    programa TEXT,
    estado TEXT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE perfil_docente (
    usuario_id BIGINT PRIMARY KEY REFERENCES usuario(id) ON DELETE CASCADE,
    documento VARCHAR(50) NOT NULL,
    nombre VARCHAR(500),
    estado TEXT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE menu_item (
    id SERIAL PRIMARY KEY,
    parent_id INT REFERENCES menu_item(id) ON DELETE CASCADE,
    section VARCHAR(20) NOT NULL,
    label TEXT NOT NULL,
    route TEXT,
    icon TEXT,
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
    id_certificado TEXT,
    motivo_expedicion TEXT,
    correo TEXT,
    motivo_exp TEXT,
    multa TEXT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE certificado_docente (
    id SERIAL PRIMARY KEY,
    usuario_id BIGINT NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    id_certificado TEXT,
    correo TEXT,
    motivo_exp TEXT,
    multa INTEGER,
    origen_descarga TEXT,
    estado_docente TEXT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE facultad (
    id_facultad SERIAL PRIMARY KEY,
    nombre TEXT NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ual (
    id_ual SERIAL PRIMARY KEY,
    nombre TEXT NOT NULL,
    id_facultad INT NOT NULL REFERENCES facultad(id_facultad),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE laboratorista (
    documento VARCHAR(50) PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    n_usuario VARCHAR(50) UNIQUE,
    correo VARCHAR(50) UNIQUE NOT NULL,
    id_ual INT REFERENCES ual(id_ual),
    id_facultad INT REFERENCES facultad(id_facultad),
    contrato VARCHAR(50),
    usuario_id BIGINT REFERENCES usuario(id) ON DELETE SET NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE coordinador (
    documento VARCHAR(50) PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    correo VARCHAR(255) UNIQUE,
    id_facultad INT REFERENCES facultad(id_facultad),
    numero_resolucion_coordinador VARCHAR(100),
    soporte_resolucion TEXT,
    nombre_u VARCHAR(50),
    usuario_id BIGINT REFERENCES usuario(id) ON DELETE SET NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE coordinador_facultad (
    documento VARCHAR(50) NOT NULL,
    id_facultad INT NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (documento, id_facultad),
    CONSTRAINT fk_cf_coordinador FOREIGN KEY (documento)
        REFERENCES coordinador(documento) ON DELETE CASCADE,
    CONSTRAINT fk_cf_facultad FOREIGN KEY (id_facultad)
        REFERENCES facultad(id_facultad) ON DELETE CASCADE
);

CREATE TABLE laboratorista_ual (
    documento VARCHAR(50) NOT NULL,
    id_ual INT NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (documento, id_ual),
    CONSTRAINT fk_lu_laboratorista FOREIGN KEY (documento)
        REFERENCES laboratorista(documento) ON DELETE CASCADE,
    CONSTRAINT fk_lu_ual FOREIGN KEY (id_ual)
        REFERENCES ual(id_ual) ON DELETE RESTRICT
);

CREATE TABLE multa (
    id SERIAL PRIMARY KEY,
    cat_multa TEXT,
    documento_laboratorista VARCHAR(50) NOT NULL REFERENCES laboratorista(documento) ON DELETE RESTRICT,
    usuario_id_sancionado BIGINT NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
    id_ual INT NOT NULL REFERENCES ual(id_ual) ON DELETE RESTRICT,
    fecha_multa DATE,
    con_estado_multa TEXT,
    obs_multa TEXT,
    tipo_sancion TEXT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE log (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(500),
    documento NUMERIC(16,0),
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    accion TEXT,
    persona VARCHAR(255),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_coordinador_facultad_documento ON coordinador_facultad(documento);
CREATE INDEX idx_coordinador_facultad_id_facultad ON coordinador_facultad(id_facultad);
CREATE INDEX idx_laboratorista_ual_documento ON laboratorista_ual(documento);
CREATE INDEX idx_laboratorista_ual_id_ual ON laboratorista_ual(id_ual);
CREATE INDEX idx_certificado_estudiante_usuario ON certificado_estudiante(usuario_id);
CREATE INDEX idx_certificado_docente_usuario ON certificado_docente(usuario_id);
CREATE INDEX idx_multa_usuario_sancionado ON multa(usuario_id_sancionado);
CREATE INDEX idx_multa_documento_laboratorista ON multa(documento_laboratorista);
CREATE INDEX idx_multa_id_ual ON multa(id_ual);

COMMIT;
