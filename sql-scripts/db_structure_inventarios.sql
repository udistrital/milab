SET search_path TO milab;

BEGIN;

CREATE TABLE IF NOT EXISTS inventario_carga (
    id BIGSERIAL PRIMARY KEY,
    ual_id INT NOT NULL REFERENCES ual(ual_id) ON DELETE RESTRICT,
    tipo_inventario VARCHAR(30) NOT NULL
        CHECK (tipo_inventario IN ('equipo_arka', 'complementario', 'reactivo')),
    archivo_nombre VARCHAR(255) NOT NULL,
    creada_por_documento VARCHAR(50) NOT NULL,
    coordinador_documento VARCHAR(50) REFERENCES coordinador(documento) ON DELETE RESTRICT,
    estado VARCHAR(30) NOT NULL DEFAULT 'previsualizada'
        CHECK (estado IN ('previsualizada', 'pendiente_aprobacion', 'aprobada', 'rechazada')),
    declaracion_sin_inventario BOOLEAN NOT NULL DEFAULT FALSE,
    total_filas INT NOT NULL DEFAULT 0 CHECK (total_filas >= 0),
    filas_exitosas INT NOT NULL DEFAULT 0 CHECK (filas_exitosas >= 0),
    filas_fallidas INT NOT NULL DEFAULT 0 CHECK (filas_fallidas >= 0),
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_confirmacion TIMESTAMPTZ,
    fecha_resolucion TIMESTAMPTZ
);

ALTER TABLE inventario
    ADD COLUMN IF NOT EXISTS tipo_inventario VARCHAR(30) NOT NULL DEFAULT 'legado',
    ADD COLUMN IF NOT EXISTS laboratorio_ual_id INT REFERENCES ual(ual_id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS estado_aprobacion VARCHAR(30) NOT NULL DEFAULT 'aprobado',
    ADD COLUMN IF NOT EXISTS modo_control VARCHAR(30) NOT NULL DEFAULT 'individual',
    ADD COLUMN IF NOT EXISTS atributos JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS carga_id BIGINT REFERENCES inventario_carga(id) ON DELETE SET NULL;

ALTER TABLE inventario
    DROP CONSTRAINT IF EXISTS uq_serie_inventario,
    DROP CONSTRAINT IF EXISTS uq_placa_inventario;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventario_serie_activo
    ON inventario(serie)
    WHERE serie IS NOT NULL AND estado_aprobacion <> 'rechazado';
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventario_placa_activa
    ON inventario(placa)
    WHERE placa IS NOT NULL AND estado_aprobacion <> 'rechazado';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_inventario_tipo_inventario'
          AND conrelid = 'milab.inventario'::regclass
    ) THEN
        ALTER TABLE inventario
            ADD CONSTRAINT ck_inventario_tipo_inventario
            CHECK (tipo_inventario IN ('legado', 'equipo_arka', 'complementario', 'reactivo'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_inventario_estado_aprobacion'
          AND conrelid = 'milab.inventario'::regclass
    ) THEN
        ALTER TABLE inventario
            ADD CONSTRAINT ck_inventario_estado_aprobacion
            CHECK (estado_aprobacion IN ('pendiente', 'aprobado', 'rechazado'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_inventario_modo_control'
          AND conrelid = 'milab.inventario'::regclass
    ) THEN
        ALTER TABLE inventario
            ADD CONSTRAINT ck_inventario_modo_control
            CHECK (modo_control IN ('individual', 'cantidad'));
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS inventario_carga_fila (
    id BIGSERIAL PRIMARY KEY,
    carga_id BIGINT NOT NULL REFERENCES inventario_carga(id) ON DELETE CASCADE,
    numero_fila INT NOT NULL CHECK (numero_fila > 0),
    estado VARCHAR(30) NOT NULL
        CHECK (estado IN ('exitosa', 'fallida', 'pendiente_aprobacion', 'aprobada', 'rechazada')),
    payload JSONB NOT NULL,
    datos_originales JSONB NOT NULL DEFAULT '{}'::jsonb,
    errores JSONB NOT NULL DEFAULT '[]'::jsonb,
    inventario_id INT REFERENCES inventario(id) ON DELETE SET NULL,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (carga_id, numero_fila)
);

CREATE TABLE IF NOT EXISTS inventario_identificador (
    id BIGSERIAL PRIMARY KEY,
    inventario_id INT NOT NULL REFERENCES inventario(id) ON DELETE CASCADE,
    ual_id INT NOT NULL REFERENCES ual(ual_id) ON DELETE RESTRICT,
    tipo VARCHAR(40) NOT NULL,
    valor VARCHAR(255) NOT NULL,
    valor_normalizado VARCHAR(255) NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_inventario_identificador_tipo
        CHECK (tipo IN ('placa_arka', 'codigo_interno', 'identificador_id', 'codigo_barras', 'qr', 'placa_local', 'etiquetado', 'serie'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventario_identificador_ual_valor
    ON inventario_identificador(ual_id, valor_normalizado)
    WHERE activo = TRUE;

CREATE TABLE IF NOT EXISTS inventario_existencia (
    id BIGSERIAL PRIMARY KEY,
    inventario_id INT NOT NULL REFERENCES inventario(id) ON DELETE CASCADE,
    grado VARCHAR(10) NOT NULL,
    ubicacion VARCHAR(20) NOT NULL,
    cantidad NUMERIC(14, 3) NOT NULL CHECK (cantidad >= 0),
    unidad VARCHAR(50) NOT NULL,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_inventario_existencia UNIQUE (inventario_id, grado, ubicacion),
    CONSTRAINT ck_inventario_existencia_grado CHECK (grado IN ('GT', 'RA', 'NA')),
    CONSTRAINT ck_inventario_existencia_ubicacion
        CHECK (ubicacion IN ('STOCK', 'CIRCULACION', 'EXISTENCIA'))
);

CREATE TABLE IF NOT EXISTS inventario_estado_laboratorio (
    ual_id INT NOT NULL REFERENCES ual(ual_id) ON DELETE CASCADE,
    tipo_inventario VARCHAR(30) NOT NULL
        CHECK (tipo_inventario IN ('equipo_arka', 'complementario', 'reactivo')),
    estado VARCHAR(30) NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente', 'pendiente_aprobacion', 'aprobado', 'rechazado')),
    sin_inventario BOOLEAN NOT NULL DEFAULT FALSE,
    carga_id BIGINT REFERENCES inventario_carga(id) ON DELETE SET NULL,
    aprobado_por_documento VARCHAR(50) REFERENCES coordinador(documento) ON DELETE SET NULL,
    fecha_aprobacion TIMESTAMPTZ,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (ual_id, tipo_inventario)
);

CREATE TABLE IF NOT EXISTS inventario_auditoria (
    id BIGSERIAL PRIMARY KEY,
    carga_id BIGINT REFERENCES inventario_carga(id) ON DELETE SET NULL,
    inventario_id INT REFERENCES inventario(id) ON DELETE SET NULL,
    ual_id INT REFERENCES ual(ual_id) ON DELETE SET NULL,
    actor_documento VARCHAR(50),
    actor_rol VARCHAR(50),
    accion VARCHAR(80) NOT NULL,
    detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE equipo
    ADD COLUMN IF NOT EXISTS inventario_id INT REFERENCES inventario(id) ON DELETE SET NULL;

ALTER TABLE equipo
    ALTER COLUMN laboratorio TYPE VARCHAR(255),
    ALTER COLUMN facultad TYPE VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS uq_equipo_inventario_id
    ON equipo(inventario_id)
    WHERE inventario_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventario_laboratorio_estado
    ON inventario(laboratorio_ual_id, tipo_inventario, estado_aprobacion);
CREATE INDEX IF NOT EXISTS idx_inventario_carga_estado
    ON inventario_carga(ual_id, estado, fecha_creacion DESC);
CREATE INDEX IF NOT EXISTS idx_inventario_carga_fila_estado
    ON inventario_carga_fila(carga_id, estado);
CREATE INDEX IF NOT EXISTS idx_inventario_identificador_inventario
    ON inventario_identificador(inventario_id);
CREATE INDEX IF NOT EXISTS idx_inventario_existencia_inventario
    ON inventario_existencia(inventario_id);
CREATE INDEX IF NOT EXISTS idx_inventario_auditoria_laboratorio_fecha
    ON inventario_auditoria(ual_id, fecha_creacion DESC);

COMMENT ON TABLE inventario_auditoria IS
    'Auditoría detallada de cargas, cambios y aprobaciones del módulo de inventarios.';
COMMENT ON COLUMN equipo.inventario_id IS
    'Vínculo opcional 1:1 con el registro maestro de inventario; conserva el ID técnico de equipo para los flujos existentes.';

COMMIT;
