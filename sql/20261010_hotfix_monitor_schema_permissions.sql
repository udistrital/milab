BEGIN;

CREATE TABLE IF NOT EXISTS milab.monitor (
    documento CHARACTER VARYING(50) PRIMARY KEY,
    nombre CHARACTER VARYING(255) NOT NULL,
    correo CHARACTER VARYING(255) UNIQUE NOT NULL,
    numero_contrato CHARACTER VARYING(100),
    tipo_vinculacion CHARACTER VARYING(100),
    fecha_inicio DATE,
    fecha_fin DATE,
    soporte_contrato CHARACTER VARYING(1000),
    usuario_id BIGINT REFERENCES milab.usuario(id) ON DELETE SET NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_monitor_usuario_id ON milab.monitor(usuario_id);

CREATE TABLE IF NOT EXISTS milab.usuario_ual_rol_operativo (
    id SERIAL NOT NULL,
    usuario_id BIGINT NOT NULL,
    rol_id INT NOT NULL,
    ual_id INT NOT NULL,
    creado_por_id BIGINT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_usuario_ual_rol_operativo PRIMARY KEY (id),
    CONSTRAINT uq_usuario_ual_rol_operativo UNIQUE (usuario_id, rol_id, ual_id),
    CONSTRAINT fk_usuario_ual_rol_operativo_usuario FOREIGN KEY (usuario_id) REFERENCES milab.usuario(id) ON DELETE CASCADE,
    CONSTRAINT fk_usuario_ual_rol_operativo_rol FOREIGN KEY (rol_id) REFERENCES milab.rol(id) ON DELETE CASCADE,
    CONSTRAINT fk_usuario_ual_rol_operativo_ual FOREIGN KEY (ual_id) REFERENCES milab.ual(ual_id) ON DELETE CASCADE,
    CONSTRAINT fk_usuario_ual_rol_operativo_creado_por FOREIGN KEY (creado_por_id) REFERENCES milab.usuario(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_usuario_ual_rol_operativo_usuario ON milab.usuario_ual_rol_operativo(usuario_id);
CREATE INDEX IF NOT EXISTS idx_usuario_ual_rol_operativo_rol ON milab.usuario_ual_rol_operativo(rol_id);
CREATE INDEX IF NOT EXISTS idx_usuario_ual_rol_operativo_ual ON milab.usuario_ual_rol_operativo(ual_id);

-- Otorga a los mismos roles que tienen acceso a milab.multa (y al dueño) los privilegios sobre las tablas nuevas y su secuencia SERIAL.
DO $$
DECLARE
    tabla TEXT;
    secuencia TEXT := pg_get_serial_sequence('milab.usuario_ual_rol_operativo', 'id');
    acceso RECORD;
BEGIN
    FOR acceso IN
        SELECT pg_get_userbyid(c.relowner) AS usuario, 'ALL' AS privilegios
        FROM pg_class c
        WHERE c.oid = 'milab.multa'::regclass
        UNION
        SELECT pg_get_userbyid(a.grantee),
               string_agg(DISTINCT a.privilege_type, ', ')
        FROM pg_class c
        CROSS JOIN LATERAL aclexplode(c.relacl) a
        WHERE c.oid = 'milab.multa'::regclass
          AND a.grantee <> 0
          AND a.grantee <> c.relowner
        GROUP BY a.grantee
    LOOP
        EXECUTE format('GRANT USAGE ON SCHEMA milab TO %I', acceso.usuario);
        FOREACH tabla IN ARRAY ARRAY['monitor', 'usuario_ual_rol_operativo'] LOOP
            EXECUTE format('GRANT %s ON TABLE milab.%I TO %I', acceso.privilegios, tabla, acceso.usuario);
        END LOOP;
        EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO %I', secuencia, acceso.usuario);
    END LOOP;
END $$;

COMMIT;
