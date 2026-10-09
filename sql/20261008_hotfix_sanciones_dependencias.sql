-- MILab: catálogo de sanciones, reclamaciones de sanciones y jerarquía
-- facultad -> dependencias (renombra facultad a dependencia_facultad).
-- Script único para producción. Es transaccional e idempotente.
-- Ejecutar con: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/20261008_hotfix_sanciones_dependencias.sql

BEGIN;
SET LOCAL search_path TO milab;

-- 1. Catálogo de categorías de sanción (antes era una lista fija en el código).

CREATE TABLE IF NOT EXISTS categoria_sancion (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL CHECK (char_length(btrim(nombre)) BETWEEN 2 AND 150),
    descripcion VARCHAR(500) NOT NULL CHECK (char_length(btrim(descripcion)) BETWEEN 2 AND 500),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS categoria_sancion_nombre_unique
    ON categoria_sancion (lower(btrim(nombre)));
CREATE UNIQUE INDEX IF NOT EXISTS categoria_sancion_descripcion_unique
    ON categoria_sancion (lower(btrim(descripcion)));

-- El catálogo no tiene eliminación física. Sembrar solo cuando esté vacío evita
-- restaurar categorías renombradas o inactivadas al ejecutar de nuevo el script.
INSERT INTO categoria_sancion (nombre, descripcion)
SELECT seed.nombre, seed.descripcion
FROM (VALUES
    ('Abandono o no devolución de equipos', 'Abandono de los equipos prestados o no devolución en los plazos establecidos'),
    ('Agresión al personal o usuarios', 'Agredir física o verbalmente al personal de las unidades académicas de laboratorio, docentes, compañeros o cualquier usuario'),
    ('Alteración de equipos o elementos', 'Cambiar o alterar el estado físico de los diferentes equipos, herramientas y demás elementos que se encuentren en las unidades académicas de las unidades académicas de laboratorios'),
    ('Consumo de alimentos o bebidas', 'Consumir alimentos o bebidas dentro de las unidades académicas los laboratorios'),
    ('Actividades o equipos no autorizados', 'Desarrollar actividades diferentes a las prácticas o ensayos de laboratorio y operar equipos diferentes a los asignados en cada trabajo experimental, sin previa autorización'),
    ('Uso de elementos de distracción', 'Emplear dispositivos o elementos de distracción que pueda afectar el desarrollo de la práctica'),
    ('Fumar en laboratorios', 'Fumar dentro de las unidades académicas de los laboratorios'),
    ('Uso no autorizado de equipos', 'Hacer uso de los equipos y herramientas sin autorización y/o sin conocer su adecuado manejo'),
    ('Ingreso bajo efectos de sustancias', 'Ingresar a las unidades académicas de laboratorios en estado de embriaguez o bajo el efecto de sustancias psicoactivas o alucinógenas, que afecten el estado consciente de una persona y su adecuado comportamiento durante la práctica'),
    ('Sin elementos de seguridad', 'Ingresar y/o realizar cualquier tipo de prueba sin los elementos de seguridad que la actividad requiera y la indumentaria adecuada'),
    ('Ingreso de niños o mascotas', 'Ingreso de niños y mascotas en las unidades académicas de laboratorios'),
    ('Traslado no autorizado de equipos', 'Movilizar equipos, máquinas, implementos, mobiliario o sus componentes, de un lugar a otro, sin previa autorización del Coordinador del Laboratorio o Personal de apoyo de las unidades académicas de laboratorio'),
    ('Documentos falsos o suplantación', 'Utilizar documentos falsos, adulterados o que pretendan suplantación')
) AS seed(nombre, descripcion)
WHERE NOT EXISTS (SELECT 1 FROM categoria_sancion)
ON CONFLICT DO NOTHING;

INSERT INTO menu_item (section, label, icon, order_index)
SELECT 'secondary', 'Configuración', 'bi-gear', 6
WHERE NOT EXISTS (
    SELECT 1 FROM menu_item
    WHERE section = 'secondary' AND label = 'Configuración' AND parent_id IS NULL
);

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Catálogo de sanciones', '/milab/api/admin/sanciones', 'bi-shield-exclamation', 3
FROM menu_item parent
WHERE parent.section = 'secondary' AND parent.label = 'Configuración' AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;

UPDATE menu_item
SET activo = TRUE
WHERE route = '/milab/api/admin/sanciones';

UPDATE menu_item
SET activo = TRUE
WHERE section = 'secondary' AND label = 'Configuración' AND parent_id IS NULL;

INSERT INTO rol_permiso (rol_id, menu_item_id, can_view, can_use)
SELECT r.id, mi.id, TRUE, TRUE
FROM rol r
CROSS JOIN menu_item mi
WHERE r.nombre = 'admin'
  AND ((mi.section = 'secondary' AND mi.label = 'Configuración' AND mi.parent_id IS NULL)
       OR mi.route = '/milab/api/admin/sanciones')
ON CONFLICT (rol_id, menu_item_id) DO UPDATE
SET can_view = TRUE, can_use = TRUE;

DELETE FROM rol_permiso rp
USING rol r, menu_item mi
WHERE rp.rol_id = r.id
  AND rp.menu_item_id = mi.id
  AND r.nombre <> 'admin'
  AND mi.route = '/milab/api/admin/sanciones';

-- 2. Reclamaciones de sanciones: una reclamación y una respuesta por sanción.

CREATE TABLE IF NOT EXISTS reclamacion_sancion (
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
CREATE INDEX IF NOT EXISTS idx_reclamacion_sancion_pendiente
    ON reclamacion_sancion (responsable_documento_id, fecha_creacion)
    WHERE fecha_respuesta IS NULL;

COMMENT ON COLUMN milab.reclamacion_sancion.multa_id IS 'Referencia a milab.multa.id';
COMMENT ON COLUMN milab.reclamacion_sancion.responsable_documento_id IS 'Referencia a milab.laboratorista.documento';
COMMENT ON COLUMN milab.reclamacion_sancion.respondido_por_id IS 'Referencia a milab.laboratorista.documento';

INSERT INTO menu_item (section, label, route, icon, order_index)
VALUES ('account', 'Mis sanciones', '/milab/api/sanciones/mis-sanciones', 'bi-shield-exclamation', 3)
ON CONFLICT DO NOTHING;

INSERT INTO menu_item (section, label, icon, order_index)
SELECT 'secondary', 'Sanciones', 'bi-shield-exclamation', 5
WHERE NOT EXISTS (
    SELECT 1 FROM menu_item WHERE section = 'secondary' AND label = 'Sanciones' AND parent_id IS NULL
);

INSERT INTO menu_item (section, parent_id, label, route, icon, order_index)
SELECT 'secondary', parent.id, 'Reclamaciones', '/milab/api/sanciones/reclamaciones', 'bi-chat-left-text', 4
FROM menu_item parent
WHERE parent.section = 'secondary' AND parent.label = 'Sanciones' AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO rol_permiso (rol_id, menu_item_id, can_view, can_use)
SELECT r.id, mi.id, TRUE, r.nombre <> 'coordinador_general'
FROM rol r CROSS JOIN menu_item mi
WHERE (r.nombre = 'estudiante' AND mi.route = '/milab/api/sanciones/mis-sanciones')
   OR (r.nombre IN ('admin', 'laboratorista', 'coordinador_general')
       AND (mi.route = '/milab/api/sanciones/reclamaciones'
            OR (mi.section = 'secondary' AND mi.label = 'Sanciones' AND mi.parent_id IS NULL)))
ON CONFLICT (rol_id, menu_item_id) DO UPDATE SET can_view = TRUE, can_use = EXCLUDED.can_use;

-- 3. Facultades y dependencias: la tabla facultad pasa a dependencia_facultad.
-- Los registros sin padre (padre_id NULL) son facultades; los demás son
-- dependencias de la facultad indicada en padre_id. Las tablas hijas conservan
-- su columna facultad_id; sus llaves foráneas siguen la tabla renombrada.
DO $$
DECLARE
    seq_name TEXT;
BEGIN
    IF to_regclass('milab.dependencia_facultad') IS NULL THEN
        ALTER TABLE milab.facultad RENAME TO dependencia_facultad;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'milab' AND table_name = 'dependencia_facultad'
          AND column_name = 'facultad_id'
    ) THEN
        ALTER TABLE milab.dependencia_facultad RENAME COLUMN facultad_id TO dependencia_facultad_id;
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'milab.dependencia_facultad'::regclass AND conname = 'facultad_pkey'
    ) THEN
        ALTER TABLE milab.dependencia_facultad RENAME CONSTRAINT facultad_pkey TO dependencia_facultad_pkey;
    END IF;

    seq_name := pg_get_serial_sequence('milab.dependencia_facultad', 'dependencia_facultad_id');
    IF seq_name IS NOT NULL
       AND seq_name <> 'milab.dependencia_facultad_dependencia_facultad_id_seq' THEN
        EXECUTE format(
            'ALTER SEQUENCE %s RENAME TO dependencia_facultad_dependencia_facultad_id_seq',
            seq_name
        );
    END IF;
END $$;

ALTER TABLE dependencia_facultad ADD COLUMN IF NOT EXISTS padre_id INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'milab.dependencia_facultad'::regclass
          AND conname = 'fk_dependencia_facultad_padre'
    ) THEN
        ALTER TABLE milab.dependencia_facultad
            ADD CONSTRAINT fk_dependencia_facultad_padre FOREIGN KEY (padre_id)
            REFERENCES milab.dependencia_facultad(dependencia_facultad_id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'milab.dependencia_facultad'::regclass
          AND conname = 'chk_dependencia_facultad_padre_distinto'
    ) THEN
        ALTER TABLE milab.dependencia_facultad
            ADD CONSTRAINT chk_dependencia_facultad_padre_distinto
            CHECK (padre_id IS NULL OR padre_id <> dependencia_facultad_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dependencia_facultad_padre_id ON dependencia_facultad(padre_id);

-- Solo dos niveles: el padre debe ser una facultad y una facultad con
-- dependencias no puede convertirse en dependencia.
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

DROP TRIGGER IF EXISTS trg_validar_jerarquia_dependencia_facultad ON dependencia_facultad;
CREATE TRIGGER trg_validar_jerarquia_dependencia_facultad
BEFORE INSERT OR UPDATE OF padre_id ON dependencia_facultad
FOR EACH ROW
EXECUTE FUNCTION validar_jerarquia_dependencia_facultad();

-- Alcance efectivo del coordinador: sus asignaciones directas más las
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

COMMENT ON TABLE milab.dependencia_facultad IS 'Facultades (padre_id NULL) y sus dependencias';
COMMENT ON VIEW milab.coordinador_facultad_alcance IS 'Asignaciones de coordinador con herencia de facultad a dependencias';
COMMENT ON COLUMN milab.dependencia_facultad.padre_id IS 'Referencia a milab.dependencia_facultad.dependencia_facultad_id (facultad padre; NULL = facultad)';
COMMENT ON COLUMN milab.ual.facultad_id IS 'Referencia a milab.dependencia_facultad.dependencia_facultad_id';
COMMENT ON COLUMN milab.coordinador_facultad.facultad_id IS 'Referencia a milab.dependencia_facultad.dependencia_facultad_id';

DO $$
BEGIN
    IF to_regclass('milab.config_facultad_multas') IS NOT NULL THEN
        COMMENT ON COLUMN milab.config_facultad_multas.facultad_id IS 'Referencia a milab.dependencia_facultad.dependencia_facultad_id';
    END IF;
    IF to_regclass('milab.parametro_practica_facultad') IS NOT NULL THEN
        COMMENT ON COLUMN milab.parametro_practica_facultad.facultad_id IS 'Referencia a milab.dependencia_facultad.dependencia_facultad_id';
    END IF;
    IF to_regclass('milab.facultad_modulo_acceso') IS NOT NULL THEN
        COMMENT ON COLUMN milab.facultad_modulo_acceso.facultad_id IS 'Referencia a milab.dependencia_facultad.dependencia_facultad_id';
    END IF;
    IF to_regclass('milab.cursos') IS NOT NULL THEN
        COMMENT ON COLUMN milab.cursos.id_facultad IS 'Referencia a milab.dependencia_facultad.dependencia_facultad_id';
    END IF;
END $$;

COMMIT;
