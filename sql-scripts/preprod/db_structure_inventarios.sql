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
        CHECK (estado IN ('previsualizada', 'pendiente_aprobacion', 'devuelta', 'aprobada', 'rechazada', 'cancelada')),
    declaracion_sin_inventario BOOLEAN NOT NULL DEFAULT FALSE,
    total_filas INT NOT NULL DEFAULT 0 CHECK (total_filas >= 0),
    filas_exitosas INT NOT NULL DEFAULT 0 CHECK (filas_exitosas >= 0),
    filas_fallidas INT NOT NULL DEFAULT 0 CHECK (filas_fallidas >= 0),
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_confirmacion TIMESTAMPTZ,
    fecha_resolucion TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS coordinador_ual_encargado (
    ual_id INT PRIMARY KEY REFERENCES ual(ual_id) ON DELETE RESTRICT,
    coordinador_documento VARCHAR(50) NOT NULL REFERENCES coordinador(documento) ON DELETE RESTRICT,
    carga_id BIGINT NOT NULL REFERENCES inventario_carga(id) ON DELETE RESTRICT,
    fecha_asignacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_coordinador_ual_encargado_documento
    ON coordinador_ual_encargado(coordinador_documento);

COMMENT ON TABLE coordinador_ual_encargado IS
    'Encargado único de cada UAL, fijado por su primera carga de inventario aprobada.';

INSERT INTO coordinador_ual_encargado (ual_id, coordinador_documento, carga_id, fecha_asignacion)
SELECT DISTINCT ON (ual_id)
       ual_id, coordinador_documento, id,
       COALESCE(fecha_resolucion, fecha_confirmacion, fecha_creacion)
FROM inventario_carga
WHERE estado = 'aprobada'
  AND coordinador_documento IS NOT NULL
ORDER BY ual_id, COALESCE(fecha_resolucion, fecha_confirmacion, fecha_creacion), id
ON CONFLICT (ual_id) DO NOTHING;

UPDATE inventario_carga carga
SET coordinador_documento = encargado.coordinador_documento
FROM coordinador_ual_encargado encargado
WHERE carga.ual_id = encargado.ual_id
  AND carga.estado = 'pendiente_aprobacion'
  AND carga.coordinador_documento IS DISTINCT FROM encargado.coordinador_documento;

ALTER TABLE inventario_carga
    DROP CONSTRAINT IF EXISTS inventario_carga_estado_check;

ALTER TABLE inventario_carga
    ADD CONSTRAINT inventario_carga_estado_check
    CHECK (estado IN ('previsualizada', 'pendiente_aprobacion', 'devuelta', 'aprobada', 'rechazada', 'cancelada'));

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

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_inventario_requisitos_por_tipo'
          AND conrelid = 'milab.inventario'::regclass
    ) THEN
        ALTER TABLE inventario
            ADD CONSTRAINT ck_inventario_requisitos_por_tipo
            CHECK (
                tipo_inventario = 'legado'
                OR (
                    BTRIM(nombre_bien) <> ''
                    AND (
                        tipo_inventario <> 'equipo_arka'
                        OR (
                            BTRIM(COALESCE(placa, '')) <> ''
                            AND CHAR_LENGTH(placa) <= 50
                        )
                    )
                    AND (
                        tipo_inventario <> 'reactivo'
                        OR BTRIM(COALESCE(atributos->>'referencia', '')) <> ''
                    )
                )
            ) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_inventario_atributos_longitudes'
          AND conrelid = 'milab.inventario'::regclass
    ) THEN
        ALTER TABLE inventario
            ADD CONSTRAINT ck_inventario_atributos_longitudes
            CHECK (
                tipo_inventario = 'legado'
                OR (
                    CHAR_LENGTH(COALESCE(atributos->>'marca', '')) <= 255
                    AND CHAR_LENGTH(COALESCE(atributos->>'modelo', '')) <= 255
                    AND CHAR_LENGTH(COALESCE(atributos->>'proveedor', '')) <= 255
                    AND CHAR_LENGTH(COALESCE(atributos->>'referencia', '')) <= 255
                    AND CHAR_LENGTH(COALESCE(atributos->>'codigoInterno', '')) <= 255
                    AND CHAR_LENGTH(COALESCE(atributos->>'observaciones', '')) <= 2000
                )
            ) NOT VALID;
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
    etiqueta TEXT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE inventario_identificador
    ADD COLUMN IF NOT EXISTS etiqueta TEXT;

ALTER TABLE inventario_identificador
    DROP CONSTRAINT IF EXISTS ck_inventario_identificador_tipo,
    ADD CONSTRAINT ck_inventario_identificador_tipo
        CHECK (
            tipo IN (
                'placa_arka',
                'codigo_interno',
                'identificador_id',
                'codigo_barras',
                'qr',
                'placa_local',
                'etiquetado',
                'serie',
                'nomenclatura_adicional'
            )
            AND (
                tipo <> 'nomenclatura_adicional'
                OR NULLIF(BTRIM(etiqueta), '') IS NOT NULL
            )
        ) NOT VALID;

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

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_inventario_existencia_unidad_no_vacia'
          AND conrelid = 'milab.inventario_existencia'::regclass
    ) THEN
        ALTER TABLE inventario_existencia
            ADD CONSTRAINT ck_inventario_existencia_unidad_no_vacia
            CHECK (BTRIM(unidad) <> '') NOT VALID;
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS inventario_estado_laboratorio (
    ual_id INT NOT NULL REFERENCES ual(ual_id) ON DELETE CASCADE,
    tipo_inventario VARCHAR(30) NOT NULL
        CHECK (tipo_inventario IN ('equipo_arka', 'complementario', 'reactivo')),
    estado VARCHAR(30) NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente', 'pendiente_aprobacion', 'devuelta', 'aprobado', 'rechazado')),
    sin_inventario BOOLEAN NOT NULL DEFAULT FALSE,
    carga_id BIGINT REFERENCES inventario_carga(id) ON DELETE SET NULL,
    aprobado_por_documento VARCHAR(50) REFERENCES coordinador(documento) ON DELETE SET NULL,
    fecha_aprobacion TIMESTAMPTZ,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (ual_id, tipo_inventario)
);

ALTER TABLE inventario_estado_laboratorio
    DROP CONSTRAINT IF EXISTS inventario_estado_laboratorio_estado_check,
    DROP CONSTRAINT IF EXISTS ck_inventario_estado_laboratorio_estado;

ALTER TABLE inventario_estado_laboratorio
    ADD CONSTRAINT ck_inventario_estado_laboratorio_estado
    CHECK (estado IN ('pendiente', 'pendiente_aprobacion', 'devuelta', 'aprobado', 'rechazado'));

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

DROP VIEW IF EXISTS equipo_catalogo;

ALTER TABLE inventario
    ALTER COLUMN nombre_bien TYPE VARCHAR(1000),
    ALTER COLUMN espacio_fisico TYPE VARCHAR(255);

ALTER TABLE equipo
    ADD COLUMN IF NOT EXISTS inventario_id INT;

ALTER TABLE equipo
    DROP CONSTRAINT IF EXISTS equipo_inventario_id_fkey,
    DROP CONSTRAINT IF EXISTS fk_equipo_inventario;

ALTER TABLE equipo
    ADD CONSTRAINT fk_equipo_inventario
    FOREIGN KEY (inventario_id) REFERENCES inventario(id) ON DELETE CASCADE;

DO $$
DECLARE
    has_legacy_equipment_columns BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'equipo'
          AND column_name = 'codigo'
    ) INTO has_legacy_equipment_columns;

    IF has_legacy_equipment_columns THEN
        IF EXISTS (
            SELECT e.id
            FROM equipo e
            JOIN inventario i
              ON UPPER(REGEXP_REPLACE(BTRIM(CASE
                    WHEN i.tipo_inventario = 'equipo_arka' THEN i.placa
                    ELSE COALESCE(NULLIF(i.atributos->>'codigoEquipo', ''), i.placa)
                 END), '[[:space:]]', '', 'g'))
               = UPPER(REGEXP_REPLACE(BTRIM(e.codigo), '[[:space:]]', '', 'g'))
             AND i.tipo_inventario IN ('legado', 'equipo_arka')
             AND i.estado_aprobacion <> 'rechazado'
            WHERE e.inventario_id IS NULL
            GROUP BY e.id
            HAVING COUNT(*) > 1
        ) THEN
            RAISE EXCEPTION
                'No se puede normalizar equipo: hay códigos asociados a varios registros de inventario.';
        END IF;

        IF EXISTS (
            SELECT i.id
            FROM equipo e
            JOIN inventario i
              ON UPPER(REGEXP_REPLACE(BTRIM(CASE
                    WHEN i.tipo_inventario = 'equipo_arka' THEN i.placa
                    ELSE COALESCE(NULLIF(i.atributos->>'codigoEquipo', ''), i.placa)
                 END), '[[:space:]]', '', 'g'))
               = UPPER(REGEXP_REPLACE(BTRIM(e.codigo), '[[:space:]]', '', 'g'))
             AND i.tipo_inventario IN ('legado', 'equipo_arka')
             AND i.estado_aprobacion <> 'rechazado'
            WHERE e.inventario_id IS NULL
            GROUP BY i.id
            HAVING COUNT(*) > 1
        ) THEN
            RAISE EXCEPTION
                'No se puede normalizar equipo: un registro de inventario coincide con varios equipos.';
        END IF;

        WITH matches AS (
            SELECT e.id AS equipo_id, MIN(i.id) AS inventario_id
            FROM equipo e
            JOIN inventario i
              ON UPPER(REGEXP_REPLACE(BTRIM(CASE
                    WHEN i.tipo_inventario = 'equipo_arka' THEN i.placa
                    ELSE COALESCE(NULLIF(i.atributos->>'codigoEquipo', ''), i.placa)
                 END), '[[:space:]]', '', 'g'))
               = UPPER(REGEXP_REPLACE(BTRIM(e.codigo), '[[:space:]]', '', 'g'))
             AND i.tipo_inventario IN ('legado', 'equipo_arka')
             AND i.estado_aprobacion <> 'rechazado'
            WHERE e.inventario_id IS NULL
            GROUP BY e.id
            HAVING COUNT(*) = 1
        )
        UPDATE equipo e
        SET inventario_id = matches.inventario_id
        FROM matches
        WHERE e.id = matches.equipo_id;

        UPDATE inventario i
        SET espacio_fisico = COALESCE(i.espacio_fisico, e.ubicacion),
            laboratorio_ual_id = COALESCE(i.laboratorio_ual_id, laboratorio.laboratorio_ual_id),
            activo = i.activo AND e.activo,
            atributos = (
                CASE
                    WHEN i.tipo_inventario = 'equipo_arka'
                    THEN COALESCE(i.atributos, '{}'::jsonb) - 'codigoEquipo'
                    ELSE COALESCE(i.atributos, '{}'::jsonb)
                END
            )
            || jsonb_strip_nulls(jsonb_build_object(
                'codigoEquipo',
                    CASE
                        WHEN i.tipo_inventario <> 'equipo_arka'
                        THEN COALESCE(i.atributos->'codigoEquipo', to_jsonb(e.codigo))
                    END,
                'descripcionEquipo',
                    COALESCE(i.atributos->'descripcionEquipo', to_jsonb(e.descripcion)),
                'especificaciones',
                    COALESCE(
                        i.atributos->'especificaciones',
                        NULLIF(COALESCE(e.especificaciones, '{}'::jsonb)
                            - ARRAY['marca', 'modelo', 'proveedor', 'observaciones'], '{}'::jsonb)
                    ),
                'categoria', COALESCE(i.atributos->'categoria', to_jsonb(e.categoria)),
                'laboratorioLegacy',
                    COALESCE(i.atributos->'laboratorioLegacy', to_jsonb(e.laboratorio)),
                'facultadLegacy',
                    COALESCE(i.atributos->'facultadLegacy', to_jsonb(e.facultad)),
                'area_conocimiento',
                    COALESCE(i.atributos->'area_conocimiento', to_jsonb(e.area_conocimiento)),
                'marca', COALESCE(i.atributos->'marca', e.especificaciones->'marca'),
                'modelo', COALESCE(i.atributos->'modelo', e.especificaciones->'modelo'),
                'proveedor', COALESCE(i.atributos->'proveedor', e.especificaciones->'proveedor'),
                'observaciones',
                    COALESCE(i.atributos->'observaciones', e.especificaciones->'observaciones')
            ))
        FROM equipo e
        LEFT JOIN LATERAL (
            SELECT MIN(u.ual_id) AS laboratorio_ual_id
            FROM ual u
            WHERE UPPER(BTRIM(u.nombre)) = UPPER(BTRIM(e.laboratorio))
            HAVING COUNT(*) = 1
        ) laboratorio ON TRUE
        WHERE e.inventario_id = i.id;

        WITH legacy_inventory AS (
            INSERT INTO inventario (
                serie,
                placa,
                nombre_bien,
                fecha_registro,
                dependencia,
                espacio_fisico,
                disponible_prestamo,
                activo,
                fecha_creacion,
                fecha_modificacion,
                tipo_inventario,
                laboratorio_ual_id,
                estado_aprobacion,
                modo_control,
                atributos
            )
            SELECT
                NULL,
                NULL,
                e.nombre,
                COALESCE(e.fecha_creacion::date, CURRENT_DATE),
                NULL,
                e.ubicacion,
                e.estado IN ('disponible', 'prestado'),
                e.activo,
                COALESCE(e.fecha_creacion, CURRENT_TIMESTAMP),
                COALESCE(e.fecha_modificacion, e.fecha_creacion, CURRENT_TIMESTAMP),
                'legado',
                laboratorio.laboratorio_ual_id,
                'aprobado',
                'individual',
                jsonb_strip_nulls(jsonb_build_object(
                    'codigoEquipo', e.codigo,
                    'descripcionEquipo', e.descripcion,
                    'especificaciones',
                        NULLIF(COALESCE(e.especificaciones, '{}'::jsonb)
                            - ARRAY['marca', 'modelo', 'proveedor', 'observaciones'], '{}'::jsonb),
                    'categoria', e.categoria,
                    'laboratorioLegacy', e.laboratorio,
                    'facultadLegacy', e.facultad,
                    'area_conocimiento', e.area_conocimiento,
                    'marca', e.especificaciones->'marca',
                    'modelo', e.especificaciones->'modelo',
                    'proveedor', e.especificaciones->'proveedor',
                    'observaciones', e.especificaciones->'observaciones'
                ))
            FROM equipo e
            LEFT JOIN LATERAL (
                SELECT MIN(u.ual_id) AS laboratorio_ual_id
                FROM ual u
                WHERE UPPER(BTRIM(u.nombre)) = UPPER(BTRIM(e.laboratorio))
                HAVING COUNT(*) = 1
            ) laboratorio ON TRUE
            WHERE e.inventario_id IS NULL
            RETURNING id, atributos->>'codigoEquipo' AS codigo_equipo
        )
        UPDATE equipo e
        SET inventario_id = legacy_inventory.id
        FROM legacy_inventory
        WHERE e.codigo = legacy_inventory.codigo_equipo;
    END IF;
END
$$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM equipo WHERE inventario_id IS NULL) THEN
        RAISE EXCEPTION
            'No se puede normalizar equipo: hay extensiones operativas sin registro de inventario.';
    END IF;
END
$$;

ALTER TABLE equipo
    ALTER COLUMN inventario_id SET NOT NULL,
    DROP COLUMN IF EXISTS codigo,
    DROP COLUMN IF EXISTS nombre,
    DROP COLUMN IF EXISTS descripcion,
    DROP COLUMN IF EXISTS especificaciones,
    DROP COLUMN IF EXISTS categoria,
    DROP COLUMN IF EXISTS laboratorio,
    DROP COLUMN IF EXISTS facultad,
    DROP COLUMN IF EXISTS area_conocimiento,
    DROP COLUMN IF EXISTS ubicacion,
    DROP COLUMN IF EXISTS activo;

CREATE UNIQUE INDEX IF NOT EXISTS uq_equipo_inventario_id
    ON equipo(inventario_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventario_codigo_equipo_activo
    ON inventario ((
        CASE
            WHEN tipo_inventario = 'equipo_arka' THEN placa
            ELSE COALESCE(NULLIF(atributos->>'codigoEquipo', ''), placa)
        END
    ))
    WHERE tipo_inventario IN ('legado', 'equipo_arka')
      AND estado_aprobacion <> 'rechazado'
      AND activo = TRUE
      AND CASE
            WHEN tipo_inventario = 'equipo_arka' THEN placa
            ELSE COALESCE(NULLIF(atributos->>'codigoEquipo', ''), placa)
          END IS NOT NULL;

CREATE OR REPLACE VIEW equipo_catalogo AS
SELECT
    e.id,
    CASE
        WHEN i.tipo_inventario = 'equipo_arka' THEN i.placa
        ELSE COALESCE(NULLIF(i.atributos->>'codigoEquipo', ''), i.placa)
    END AS codigo,
    i.nombre_bien AS nombre,
    COALESCE(
        NULLIF(i.atributos->>'descripcionEquipo', ''),
        NULLIF(BTRIM(CONCAT_WS(
            ' ',
            NULLIF(i.atributos->>'marca', ''),
            NULLIF(i.atributos->>'modelo', '')
        )), '')
    ) AS descripcion,
    COALESCE(i.atributos->'especificaciones', '{}'::jsonb)
        || jsonb_strip_nulls(jsonb_build_object(
            'marca', i.atributos->'marca',
            'modelo', i.atributos->'modelo',
            'proveedor', i.atributos->'proveedor',
            'observaciones', i.atributos->'observaciones'
        )) AS especificaciones,
    COALESCE(
        i.atributos->>'categoria',
        CASE WHEN i.tipo_inventario = 'equipo_arka' THEN 'Equipo oficial ARKA' ELSE 'Inventario' END
    ) AS categoria,
    COALESCE(u.nombre, i.atributos->>'laboratorioLegacy') AS laboratorio,
    COALESCE(df.nombre, i.atributos->>'facultadLegacy') AS facultad,
    i.atributos->>'area_conocimiento' AS area_conocimiento,
    e.estado,
    i.espacio_fisico AS ubicacion,
    e.ubicacion_prestamo,
    i.activo,
    i.fecha_creacion,
    GREATEST(i.fecha_modificacion, e.fecha_modificacion) AS fecha_modificacion,
    e.inventario_id
FROM equipo e
JOIN inventario i ON i.id = e.inventario_id
LEFT JOIN ual u ON u.ual_id = i.laboratorio_ual_id
LEFT JOIN dependencia_facultad df ON df.dependencia_facultad_id = u.facultad_id;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_inventario_equipo_atributos_longitudes'
          AND conrelid = 'milab.inventario'::regclass
    ) THEN
        ALTER TABLE inventario
            ADD CONSTRAINT ck_inventario_equipo_atributos_longitudes
            CHECK (
                tipo_inventario <> 'legado'
                OR (
                    CHAR_LENGTH(COALESCE(atributos->>'codigoEquipo', '')) <= 50
                    AND CHAR_LENGTH(COALESCE(atributos->>'categoria', '')) <= 100
                    AND CHAR_LENGTH(COALESCE(atributos->>'area_conocimiento', '')) <= 100
                    AND CHAR_LENGTH(COALESCE(atributos->>'laboratorioLegacy', '')) <= 255
                    AND CHAR_LENGTH(COALESCE(atributos->>'facultadLegacy', '')) <= 255
                )
            ) NOT VALID;
    END IF;
END
$$;

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
    'Vínculo obligatorio 1:1 con inventario; equipo conserva únicamente identidad y estado operativo.';
COMMENT ON VIEW equipo_catalogo IS
    'Proyección de compatibilidad de equipos; los datos descriptivos provienen exclusivamente de inventario.';
COMMENT ON COLUMN inventario_identificador.etiqueta IS
    'Encabezado de Excel asociado a un identificador de nomenclatura adicional, cuando aplica.';

CREATE TABLE IF NOT EXISTS arka_conciliacion_corrida (
    id BIGSERIAL PRIMARY KEY,
    coordinador_documento VARCHAR(50) NOT NULL
        REFERENCES coordinador(documento) ON DELETE RESTRICT,
    tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('manual', 'mensual')),
    periodo_mensual DATE,
    estado VARCHAR(20) NOT NULL DEFAULT 'en_cola'
        CHECK (estado IN ('en_cola', 'procesando', 'completado', 'fallido')),
    solicitada_por_documento VARCHAR(50),
    fecha_solicitud TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_inicio TIMESTAMPTZ,
    fecha_fin TIMESTAMPTZ,
    lease_token UUID,
    lease_hasta TIMESTAMPTZ,
    total_arka INT NOT NULL DEFAULT 0 CHECK (total_arka >= 0),
    total_alertas INT NOT NULL DEFAULT 0 CHECK (total_alertas >= 0),
    codigo_error VARCHAR(80),
    mensaje_error TEXT,
    error_correo TEXT,
    CONSTRAINT ck_arka_conciliacion_periodo_mensual
        CHECK ((tipo = 'mensual' AND periodo_mensual IS NOT NULL)
            OR (tipo = 'manual' AND periodo_mensual IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_arka_conciliacion_corrida_activa_coordinador
    ON arka_conciliacion_corrida(coordinador_documento)
    WHERE estado IN ('en_cola', 'procesando');
CREATE UNIQUE INDEX IF NOT EXISTS uq_arka_conciliacion_corrida_periodo_mensual
    ON arka_conciliacion_corrida(coordinador_documento, periodo_mensual)
    WHERE tipo = 'mensual';
CREATE INDEX IF NOT EXISTS idx_arka_conciliacion_corrida_ultima
    ON arka_conciliacion_corrida(coordinador_documento, estado, fecha_fin DESC);
CREATE INDEX IF NOT EXISTS idx_arka_conciliacion_corrida_cola
    ON arka_conciliacion_corrida(estado, fecha_solicitud, id);

CREATE TABLE IF NOT EXISTS arka_conciliacion_ual (
    corrida_id BIGINT NOT NULL
        REFERENCES arka_conciliacion_corrida(id) ON DELETE CASCADE,
    ual_id INT NOT NULL REFERENCES ual(ual_id) ON DELETE RESTRICT,
    total_milab INT NOT NULL DEFAULT 0 CHECK (total_milab >= 0),
    total_coincidencias INT NOT NULL DEFAULT 0 CHECK (total_coincidencias >= 0),
    total_no_coincidentes INT NOT NULL DEFAULT 0 CHECK (total_no_coincidentes >= 0),
    PRIMARY KEY (corrida_id, ual_id)
);

CREATE TABLE IF NOT EXISTS arka_conciliacion_detalle (
    id BIGSERIAL PRIMARY KEY,
    corrida_id BIGINT NOT NULL
        REFERENCES arka_conciliacion_corrida(id) ON DELETE CASCADE,
    indice_arka INT,
    arka_id BIGINT,
    arka_elemento_acta_id BIGINT,
    arka_placa VARCHAR(255),
    arka_serie VARCHAR(255),
    arka_nombre TEXT,
    arka_marca VARCHAR(255),
    inventario_id INT,
    ual_id INT REFERENCES ual(ual_id) ON DELETE SET NULL,
    inventario_placa VARCHAR(255),
    inventario_serie VARCHAR(255),
    inventario_nombre TEXT,
    tipo_coincidencia VARCHAR(20),
    estado VARCHAR(20) NOT NULL
        CHECK (estado IN ('coincide', 'solo_arka', 'solo_milab', 'ambiguo')),
    clave_alerta VARCHAR(700),
    CONSTRAINT uq_arka_conciliacion_detalle_indice
        UNIQUE (corrida_id, indice_arka),
    CONSTRAINT ck_arka_conciliacion_detalle_coincidencia
        CHECK (tipo_coincidencia IS NULL OR tipo_coincidencia IN ('id_arka', 'placa', 'serie'))
);

CREATE INDEX IF NOT EXISTS idx_arka_conciliacion_detalle_ual_estado
    ON arka_conciliacion_detalle(corrida_id, ual_id, estado);
CREATE INDEX IF NOT EXISTS idx_arka_conciliacion_detalle_alertas
    ON arka_conciliacion_detalle(corrida_id, estado)
    WHERE estado <> 'coincide';

CREATE TABLE IF NOT EXISTS arka_conciliacion_alerta (
    id BIGSERIAL PRIMARY KEY,
    coordinador_documento VARCHAR(50) NOT NULL
        REFERENCES coordinador(documento) ON DELETE RESTRICT,
    clave_alerta VARCHAR(700) NOT NULL,
    corrida_id BIGINT NOT NULL
        REFERENCES arka_conciliacion_corrida(id) ON DELETE RESTRICT,
    ual_id INT REFERENCES ual(ual_id) ON DELETE SET NULL,
    estado VARCHAR(20) NOT NULL CHECK (estado IN ('activa', 'resuelta')),
    primera_aparicion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ultima_aparicion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_resolucion TIMESTAMPTZ,
    UNIQUE (coordinador_documento, clave_alerta)
);

CREATE INDEX IF NOT EXISTS idx_arka_conciliacion_alerta_activa
    ON arka_conciliacion_alerta(coordinador_documento, ual_id, ultima_aparicion DESC)
    WHERE estado = 'activa';

COMMIT;
