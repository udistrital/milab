CREATE SCHEMA IF NOT EXISTS milab;
SET search_path TO milab;
SET TIME ZONE 'America/Bogota';

BEGIN;


CREATE TABLE IF NOT EXISTS hoja_vida (
    id                      BIGSERIAL,
    equipo_id               INT                     NOT NULL,
    dependencia             VARCHAR(255),
    ubicacion               VARCHAR(255),
    nombre_equipo           VARCHAR(255),
    marca                   VARCHAR(150),
    numero_serie            VARCHAR(100),
    codigo_inventario       VARCHAR(100),
    codigo_interno          VARCHAR(100),
    fecha_adquisicion       DATE,
    anio                    VARCHAR(10),
    numero_factura_compra   VARCHAR(100),
    frecuencia_mantenimiento VARCHAR(50),
    tipo_uso                VARCHAR(255),
    proveedor               VARCHAR(200),
    numero_remision_compra  VARCHAR(100),
    valor_compra            NUMERIC(15,2),
    pais_origen             VARCHAR(100),
    referencia_modelo       VARCHAR(150),
    tiempo_garantia         VARCHAR(50),
    tiempo_vida_util        VARCHAR(50),
    potencia_electrica      VARCHAR(50),
    cantidad                INT,
    responsable             VARCHAR(150),
    supervisor              VARCHAR(150),
    funcion                 TEXT,
    descripcion_fisica      TEXT,
    especificaciones_tecnicas TEXT,
    instrucciones_uso       TEXT,
    condiciones_seguridad   TEXT,
    protocolo_limpieza      TEXT,
    cuenta_manual           TEXT,
    accesorios              TEXT,
    foto_descripcion        TEXT,
    estado                  VARCHAR(30),
    activo                  BOOLEAN                 NOT NULL DEFAULT TRUE,
    fecha_creacion          TIMESTAMPTZ             NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion      TIMESTAMPTZ             NOT NULL DEFAULT CURRENT_TIMESTAMP,
    usuario_creacion        VARCHAR(50),
    usuario_modificacion    VARCHAR(50),
    CONSTRAINT pk_hoja_vida PRIMARY KEY (id),
    CONSTRAINT uq_equipo_id_hoja_vida UNIQUE (equipo_id),
    CONSTRAINT ck_estado_hoja_vida CHECK (
        estado IN ('PENDIENTE_CONFIRMACION','ACTIVA')
    ),
    CONSTRAINT fk_hoja_vida_equipo FOREIGN KEY (equipo_id)
        REFERENCES equipo(id) ON DELETE RESTRICT
);


CREATE TABLE IF NOT EXISTS mantenimiento (
    id                              BIGSERIAL,
    hoja_vida_id                    BIGINT                  NOT NULL,
    equipo_id                       INT                     NOT NULL,
    item                            VARCHAR(255),
    tipo_mantenimiento              VARCHAR(50),
    fecha_realizacion               DATE,
    datos_empresa_contratada        TEXT,
    tiempo_garantia                 VARCHAR(50),
    especificaciones_mantenimiento  TEXT,
    responsable                     VARCHAR(150),
    observaciones_repuestos         TEXT,
    costo                           NUMERIC(14,2),
    estado                          VARCHAR(30)             NOT NULL,
    fecha_cierre                    TIMESTAMPTZ,
    usuario_cierre                  VARCHAR(50),
    activo                          BOOLEAN                 NOT NULL DEFAULT TRUE,
    fecha_creacion                  TIMESTAMPTZ             NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion              TIMESTAMPTZ             NOT NULL DEFAULT CURRENT_TIMESTAMP,
    usuario_creacion                VARCHAR(50),
    usuario_modificacion            VARCHAR(50),
    CONSTRAINT pk_mantenimiento PRIMARY KEY (id),
    CONSTRAINT ck_estado_mantenimiento CHECK (
        estado IN ('PENDIENTE','EN_EJECUCION','CUMPLIDO','VENCIDO','CANCELADO')
    ),
    CONSTRAINT ck_costo_mantenimiento CHECK (costo IS NULL OR costo >= 0),
    CONSTRAINT fk_mantenimiento_hoja_vida FOREIGN KEY (hoja_vida_id)
        REFERENCES hoja_vida(id) ON DELETE CASCADE,
    CONSTRAINT fk_mantenimiento_equipo FOREIGN KEY (equipo_id)
        REFERENCES equipo(id) ON DELETE RESTRICT
);

-- Parametrizacion del modulo de mantenimientos (alertas de vencimiento)
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


CREATE TABLE IF NOT EXISTS hoja_vida_documento (
    id                  BIGSERIAL,
    hoja_vida_id        BIGINT                  NOT NULL,
    tipo_documento      VARCHAR(50)             NOT NULL,
    nombre_archivo      VARCHAR(255),
    tipo_mime           VARCHAR(100),
    archivo             BYTEA,
    fecha_carga         TIMESTAMPTZ,
    usuario_carga       VARCHAR(50),
    activo              BOOLEAN                 NOT NULL DEFAULT TRUE,
    fecha_creacion      TIMESTAMPTZ             NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion  TIMESTAMPTZ             NOT NULL DEFAULT CURRENT_TIMESTAMP,
    usuario_creacion    VARCHAR(50),
    usuario_modificacion VARCHAR(50),
    CONSTRAINT pk_hoja_vida_documento PRIMARY KEY (id),
    CONSTRAINT ck_tipo_documento_hoja_vida_documento CHECK (
        tipo_documento IN ('EXCEL_ORIGEN','PDF_ORIGEN','FOTOGRAFIA_EQUIPO')
    ),
    CONSTRAINT fk_hoja_vida_documento_hoja_vida FOREIGN KEY (hoja_vida_id)
        REFERENCES hoja_vida(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS hoja_vida_historial (
    id                  BIGSERIAL,
    hoja_vida_id        BIGINT                  NOT NULL,
    equipo_id           INT                     NOT NULL,
    tipo_evento         VARCHAR(50)             NOT NULL,
    campo_modificado    VARCHAR(100),
    valor_anterior      TEXT,
    valor_nuevo         TEXT,
    referencia_tipo     VARCHAR(50),
    referencia_id       BIGINT,
    descripcion         TEXT,
    usuario             VARCHAR(50),
    fecha               TIMESTAMPTZ             NOT NULL DEFAULT CURRENT_TIMESTAMP,
    activo              BOOLEAN                 NOT NULL DEFAULT TRUE,
    fecha_creacion      TIMESTAMPTZ             NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion  TIMESTAMPTZ             NOT NULL DEFAULT CURRENT_TIMESTAMP,
    usuario_creacion    VARCHAR(50),
    usuario_modificacion VARCHAR(50),
    CONSTRAINT pk_hoja_vida_historial PRIMARY KEY (id),
    CONSTRAINT ck_tipo_evento_hoja_vida_historial CHECK (
        tipo_evento IN (
            'CREACION','CONFIRMACION','EDICION','DOCUMENTO','FOTOGRAFIA','TRASLADO',
            'MANTENIMIENTO','PRESTAMO','INCIDENCIA','BAJA','OBSERVACION'
        )
    ),
    CONSTRAINT fk_hoja_vida_historial_hoja_vida FOREIGN KEY (hoja_vida_id)
        REFERENCES hoja_vida(id) ON DELETE CASCADE,
    CONSTRAINT fk_hoja_vida_historial_equipo FOREIGN KEY (equipo_id)
        REFERENCES equipo(id) ON DELETE RESTRICT
);


CREATE TABLE IF NOT EXISTS hoja_vida_config_campos (
    id                  BIGSERIAL,
    nombre_campo        VARCHAR(100)            NOT NULL,
    seccion             VARCHAR(100)            NOT NULL,
    obligatorio         BOOLEAN                 NOT NULL DEFAULT FALSE,
    activo              BOOLEAN                 NOT NULL DEFAULT TRUE,
    fecha_creacion      TIMESTAMPTZ             NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion  TIMESTAMPTZ             NOT NULL DEFAULT CURRENT_TIMESTAMP,
    usuario_creacion    VARCHAR(50),
    usuario_modificacion VARCHAR(50),
    CONSTRAINT pk_hoja_vida_config_campos PRIMARY KEY (id),
    CONSTRAINT uq_nombre_campo_hoja_vida_config_campos UNIQUE (nombre_campo)
);
CREATE INDEX IF NOT EXISTS idx_hoja_vida_equipo_id
    ON hoja_vida (equipo_id);

CREATE INDEX IF NOT EXISTS idx_hoja_vida_estado
    ON hoja_vida (estado);

CREATE INDEX IF NOT EXISTS idx_mantenimiento_hoja_vida_id
    ON mantenimiento (hoja_vida_id);

CREATE INDEX IF NOT EXISTS idx_mantenimiento_equipo_id
    ON mantenimiento (equipo_id);

CREATE INDEX IF NOT EXISTS idx_mantenimiento_estado
    ON mantenimiento (estado);

CREATE INDEX IF NOT EXISTS idx_mantenimiento_fecha_realizacion
    ON mantenimiento (fecha_realizacion);

CREATE INDEX IF NOT EXISTS idx_mantenimiento_activo
    ON mantenimiento (activo);

CREATE INDEX IF NOT EXISTS idx_hoja_vida_documento_hoja_vida_id
    ON hoja_vida_documento (hoja_vida_id);

CREATE INDEX IF NOT EXISTS idx_hoja_vida_historial_hoja_vida_id
    ON hoja_vida_historial (hoja_vida_id);

CREATE INDEX IF NOT EXISTS idx_hoja_vida_historial_equipo_id
    ON hoja_vida_historial (equipo_id);

CREATE INDEX IF NOT EXISTS idx_hoja_vida_config_campos_seccion
    ON hoja_vida_config_campos (seccion);


CREATE OR REPLACE FUNCTION validar_mantenimiento_equipo_hv()
RETURNS TRIGGER AS $$
DECLARE
    hv_equipo_id INT;
BEGIN
    SELECT equipo_id INTO hv_equipo_id
    FROM milab.hoja_vida
    WHERE id = NEW.hoja_vida_id
    FOR SHARE;

    IF hv_equipo_id IS NULL THEN
        RAISE EXCEPTION 'hoja_vida_id=% no existe en hoja_vida', NEW.hoja_vida_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF NEW.equipo_id IS DISTINCT FROM hv_equipo_id THEN
        RAISE EXCEPTION
            'Inconsistencia de equipo: mantenimiento.equipo_id=% no coincide con hoja_vida.equipo_id=% (hoja_vida_id=%)',
            NEW.equipo_id, hv_equipo_id, NEW.hoja_vida_id
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validar_mantenimiento_equipo_hv ON mantenimiento;
CREATE TRIGGER trg_validar_mantenimiento_equipo_hv
BEFORE INSERT OR UPDATE OF hoja_vida_id, equipo_id ON mantenimiento
FOR EACH ROW
EXECUTE FUNCTION validar_mantenimiento_equipo_hv();

COMMIT;
