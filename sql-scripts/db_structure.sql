-- Esquema canonico de MiLab.
-- Este archivo describe el estado final esperado de la base y aplica
-- ajustes idempotentes para bases antiguas antes de sembrar catalogos o datos.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

SET TIME ZONE 'America/Bogota';

CREATE TABLE IF NOT EXISTS logs (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(500),
    documento NUMERIC(16,0),
    fecha_hora TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    accion TEXT,
    persona VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS usuarios (
    id BIGSERIAL PRIMARY KEY,
    correo TEXT NOT NULL UNIQUE,
    documento VARCHAR(50) NOT NULL UNIQUE,
    nombre TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(40) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS usuario_roles (
    usuario_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    role_id INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    meta JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (usuario_id, role_id)
);

CREATE TABLE IF NOT EXISTS perfil_estudiante (
    usuario_id BIGINT PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
    documento VARCHAR(50) NOT NULL,
    codigo BIGINT,
    programa TEXT,
    estado TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS perfil_docente (
    usuario_id BIGINT PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
    documento VARCHAR(50) NOT NULL,
    estado TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS menu_items (
    id SERIAL PRIMARY KEY,
    parent_id INT REFERENCES menu_items(id) ON DELETE CASCADE,
    section VARCHAR(20) NOT NULL,
    label TEXT NOT NULL,
    route TEXT,
    icon TEXT,
    order_index INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

DROP INDEX IF EXISTS idx_menu_items_unique;

CREATE UNIQUE INDEX idx_menu_items_unique
    ON menu_items (section, parent_id, label, route) NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_menu_items_parent ON menu_items(parent_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_section ON menu_items(section);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    menu_item_id INT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    can_view BOOLEAN NOT NULL DEFAULT TRUE,
    can_use BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (role_id, menu_item_id)
);

CREATE TABLE IF NOT EXISTS estudiante (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(500),
    cc NUMERIC(16,0),
    codigo NUMERIC(20,0),
    programa TEXT,
    estado_estudiante TEXT,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_vencimiento TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    id_certificado TEXT,
    motivo_expedicion TEXT,
    correo TEXT,
    motivo_exp TEXT,
    multa TEXT
);

CREATE TABLE IF NOT EXISTS docente (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(500),
    cc NUMERIC(16,0),
    estado_docente TEXT,
    fecha_creacion DATE,
    id_certificado TEXT,
    correo TEXT,
    motivo_exp TEXT,
    multa INTEGER,
    origen_descarga TEXT
);

CREATE TABLE IF NOT EXISTS multas (
    id SERIAL PRIMARY KEY,
    cat_multa TEXT,
    nombre_laboratorista VARCHAR(500),
    cc_laboratorista NUMERIC(16,0),
    cod_multado NUMERIC(20,0),
    ual TEXT,
    fecha_multa DATE,
    con_estado_multa TEXT,
    obs_multa TEXT,
    n_usuario VARCHAR(50),
    tipo_sancion TEXT
);

CREATE TABLE IF NOT EXISTS usuario (
    documento VARCHAR(50) PRIMARY KEY,
    codigo BIGINT,
    nombre VARCHAR(100) NOT NULL,
    correo VARCHAR(50) UNIQUE NOT NULL,
    estado VARCHAR(20),
    carrera VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS auth (
    documento VARCHAR(50) PRIMARY KEY,
    password VARCHAR(200) NOT NULL,
    tipo VARCHAR(20) NOT NULL,
    password_cambiado BOOLEAN DEFAULT FALSE,
    correo VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS facultad (
    id_facultad SERIAL PRIMARY KEY,
    nombre TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ual (
    id_ual SERIAL PRIMARY KEY,
    nombre TEXT NOT NULL,
    id_facultad INT NOT NULL
);

CREATE TABLE IF NOT EXISTS laboratorista (
    documento VARCHAR(50) PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    n_usuario VARCHAR(50) UNIQUE,
    correo VARCHAR(50) UNIQUE NOT NULL,
    id_ual INT,
    id_facultad INT,
    contrato VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS coordinador_laboratorio (
    documento VARCHAR(50) PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    correo VARCHAR(255) UNIQUE,
    id_facultad INT,
    numero_resolucion_coordinador VARCHAR(100),
    soporte_resolucion TEXT,
    nombre_u VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS coordinador_facultad (
    documento VARCHAR(50) NOT NULL,
    id_facultad INT NOT NULL,
    PRIMARY KEY (documento, id_facultad),
    CONSTRAINT fk_cf_coordinador FOREIGN KEY (documento)
        REFERENCES coordinador_laboratorio(documento) ON DELETE CASCADE,
    CONSTRAINT fk_cf_facultad FOREIGN KEY (id_facultad)
        REFERENCES facultad(id_facultad) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS laboratorista_ual (
    documento VARCHAR(50) NOT NULL,
    id_ual INT NOT NULL,
    PRIMARY KEY (documento, id_ual),
    CONSTRAINT fk_lu_laboratorista FOREIGN KEY (documento)
        REFERENCES laboratorista(documento) ON DELETE CASCADE,
    CONSTRAINT fk_lu_ual FOREIGN KEY (id_ual)
        REFERENCES ual(id_ual) ON DELETE RESTRICT
);

ALTER TABLE logs
  ALTER COLUMN fecha_hora TYPE TIMESTAMPTZ
  USING fecha_hora::timestamptz;

ALTER TABLE logs
  ALTER COLUMN fecha_hora SET DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'docente'
          AND column_name = 'estado_estudiante'
    ) AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'docente'
          AND column_name = 'estado_docente'
    ) THEN
        ALTER TABLE docente RENAME COLUMN estado_estudiante TO estado_docente;
    END IF;
END $$;

ALTER TABLE docente
    ADD COLUMN IF NOT EXISTS estado_docente TEXT,
    ADD COLUMN IF NOT EXISTS motivo_exp TEXT,
    ADD COLUMN IF NOT EXISTS origen_descarga TEXT;

ALTER TABLE multas
    ADD COLUMN IF NOT EXISTS n_usuario VARCHAR(50);

ALTER TABLE auth
    ALTER COLUMN documento TYPE VARCHAR(50);

ALTER TABLE usuario
    ALTER COLUMN documento TYPE VARCHAR(50);

ALTER TABLE laboratorista
    ALTER COLUMN documento TYPE VARCHAR(50);

ALTER TABLE coordinador_laboratorio
    ALTER COLUMN documento TYPE VARCHAR(50);

ALTER TABLE usuario
    ALTER COLUMN codigo DROP NOT NULL;

ALTER TABLE usuario
    ALTER COLUMN codigo SET DEFAULT 0;

ALTER TABLE auth
    ALTER COLUMN tipo SET DEFAULT 'estudiante';

ALTER TABLE auth
    ADD COLUMN IF NOT EXISTS password_cambiado BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS correo VARCHAR(255);

ALTER TABLE laboratorista
    ADD COLUMN IF NOT EXISTS n_usuario VARCHAR(50),
    ADD COLUMN IF NOT EXISTS contrato VARCHAR(50),
    ADD COLUMN IF NOT EXISTS usuario_id BIGINT;

ALTER TABLE coordinador_laboratorio
    ADD COLUMN IF NOT EXISTS numero_resolucion_coordinador VARCHAR(100),
    ADD COLUMN IF NOT EXISTS soporte_resolucion TEXT,
    ADD COLUMN IF NOT EXISTS nombre_u VARCHAR(50),
    ADD COLUMN IF NOT EXISTS usuario_id BIGINT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name = 'coordinador_laboratorio'
          AND constraint_name = 'fk_facultad_coord'
    ) THEN
        ALTER TABLE coordinador_laboratorio
        ADD CONSTRAINT fk_facultad_coord
        FOREIGN KEY (id_facultad) REFERENCES facultad(id_facultad);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name = 'coordinador_laboratorio'
          AND constraint_name = 'fk_coord_usuario'
    ) THEN
        ALTER TABLE coordinador_laboratorio
        ADD CONSTRAINT fk_coord_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name = 'ual'
          AND constraint_name = 'fac_id_fk'
    ) THEN
        ALTER TABLE ual
        ADD CONSTRAINT fac_id_fk
        FOREIGN KEY (id_facultad) REFERENCES facultad(id_facultad);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name = 'laboratorista'
          AND constraint_name = 'fac_id_fk'
    ) THEN
        ALTER TABLE laboratorista
        ADD CONSTRAINT fac_id_fk
        FOREIGN KEY (id_facultad) REFERENCES facultad(id_facultad);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name = 'laboratorista'
          AND constraint_name = 'lab_id_fk'
    ) THEN
        ALTER TABLE laboratorista
        ADD CONSTRAINT lab_id_fk
        FOREIGN KEY (id_ual) REFERENCES ual(id_ual);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name = 'laboratorista'
          AND constraint_name = 'fk_lab_usuario'
    ) THEN
        ALTER TABLE laboratorista
        ADD CONSTRAINT fk_lab_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cf_documento ON coordinador_facultad(documento);
CREATE INDEX IF NOT EXISTS idx_cf_id_facultad ON coordinador_facultad(id_facultad);
CREATE INDEX IF NOT EXISTS idx_lu_documento ON laboratorista_ual(documento);
CREATE INDEX IF NOT EXISTS idx_lu_id_ual ON laboratorista_ual(id_ual);
CREATE INDEX IF NOT EXISTS idx_auth_correo ON auth(correo);

INSERT INTO coordinador_facultad (documento, id_facultad)
SELECT documento, id_facultad
FROM coordinador_laboratorio
WHERE id_facultad IS NOT NULL
ON CONFLICT (documento, id_facultad) DO NOTHING;

INSERT INTO laboratorista_ual (documento, id_ual)
SELECT documento, id_ual
FROM laboratorista
WHERE id_ual IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE auth a
SET correo = u.correo
FROM usuario u
WHERE a.documento = u.documento
  AND (a.correo IS NULL OR a.correo = '');

UPDATE auth a
SET correo = l.correo
FROM laboratorista l
WHERE a.documento = COALESCE(l.n_usuario, l.documento)
  AND (a.correo IS NULL OR a.correo = '');

UPDATE auth a
SET correo = c.correo
FROM coordinador_laboratorio c
WHERE a.documento = COALESCE(c.nombre_u, c.documento)
  AND (a.correo IS NULL OR a.correo = '');

UPDATE auth a
SET correo = d.correo
FROM docente d
WHERE a.documento = d.cc::VARCHAR(50)
  AND (a.correo IS NULL OR a.correo = '');