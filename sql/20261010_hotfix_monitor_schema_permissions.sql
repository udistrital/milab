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

DO $$
DECLARE
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
        EXECUTE format('GRANT %s ON TABLE milab.monitor TO %I', acceso.privilegios, acceso.usuario);
    END LOOP;
END $$;

COMMIT;
