SET search_path TO milab;
SET TIME ZONE 'America/Bogota';

BEGIN;

-- 1) mantenimiento: columna costo
ALTER TABLE mantenimiento
    ADD COLUMN IF NOT EXISTS costo NUMERIC(14,2);

ALTER TABLE mantenimiento
    DROP CONSTRAINT IF EXISTS ck_costo_mantenimiento;
ALTER TABLE mantenimiento
    ADD CONSTRAINT ck_costo_mantenimiento CHECK (costo IS NULL OR costo >= 0);

-- 2) mantenimiento: estado incluye VENCIDO
ALTER TABLE mantenimiento
    DROP CONSTRAINT IF EXISTS ck_estado_mantenimiento;
ALTER TABLE mantenimiento
    ADD CONSTRAINT ck_estado_mantenimiento CHECK (
        estado IN ('PENDIENTE','EN_EJECUCION','CUMPLIDO','VENCIDO','CANCELADO')
    );

-- 3) hoja_vida.tipo_uso: 50 -> 255 (multiseleccion)
ALTER TABLE hoja_vida
    ALTER COLUMN tipo_uso TYPE VARCHAR(255);

-- 4) Configuracion de alertas de vencimiento de mantenimiento
CREATE TABLE IF NOT EXISTS mantenimiento_config (
    id                      BIGSERIAL,
    dias_alerta_vencimiento INT                     NOT NULL DEFAULT 30,
    activo                  BOOLEAN                 NOT NULL DEFAULT TRUE,
    fecha_creacion          TIMESTAMPTZ             NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion      TIMESTAMPTZ             NOT NULL DEFAULT CURRENT_TIMESTAMP,
    usuario_creacion        VARCHAR(50),
    usuario_modificacion    VARCHAR(50),
    CONSTRAINT pk_mantenimiento_config PRIMARY KEY (id),
    CONSTRAINT ck_dias_alerta_vencimiento CHECK (dias_alerta_vencimiento BETWEEN 1 AND 365)
);

INSERT INTO mantenimiento_config (dias_alerta_vencimiento)
SELECT 30
WHERE NOT EXISTS (SELECT 1 FROM mantenimiento_config);

-- 5) hoja_vida_historial: referencias genericas (documento / fotografia)
ALTER TABLE hoja_vida_historial
    ADD COLUMN IF NOT EXISTS referencia_tipo VARCHAR(50);
ALTER TABLE hoja_vida_historial
    ADD COLUMN IF NOT EXISTS referencia_id BIGINT;

ALTER TABLE hoja_vida_historial
    DROP CONSTRAINT IF EXISTS ck_tipo_evento_hoja_vida_historial;
ALTER TABLE hoja_vida_historial
    ADD CONSTRAINT ck_tipo_evento_hoja_vida_historial CHECK (
        tipo_evento IN (
            'CREACION','CONFIRMACION','EDICION','DOCUMENTO','FOTOGRAFIA','TRASLADO',
            'MANTENIMIENTO','PRESTAMO','INCIDENCIA','BAJA','OBSERVACION'
        )
    );

-- 6) Indices nuevos
CREATE INDEX IF NOT EXISTS idx_mantenimiento_fecha_realizacion
    ON mantenimiento (fecha_realizacion);
CREATE INDEX IF NOT EXISTS idx_mantenimiento_activo
    ON mantenimiento (activo);

COMMIT;
