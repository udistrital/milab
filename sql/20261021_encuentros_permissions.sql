-- Concede permisos de lectura y escritura de Encuentros a los roles de aplicación
-- identificados por su acceso a milab.multa y al propietario de esa tabla.
-- Ejecutar como DBA o propietario de los objetos, con:
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/20261021_encuentros_permissions.sql

BEGIN;

DO $$
DECLARE
    acceso RECORD;
    objeto TEXT;
    secuencia TEXT;
BEGIN
    IF to_regclass('milab.multa') IS NULL THEN
        RAISE EXCEPTION 'No existe milab.multa para determinar los roles de aplicación';
    END IF;

    FOR acceso IN
        SELECT pg_get_userbyid(c.relowner) AS usuario, 'ALL' AS privilegios
        FROM pg_class c
        WHERE c.oid = 'milab.multa'::regclass
        UNION
        SELECT pg_get_userbyid(a.grantee),
               'SELECT, INSERT, UPDATE'
        FROM pg_class c
        CROSS JOIN LATERAL aclexplode(c.relacl) a
        WHERE c.oid = 'milab.multa'::regclass
          AND a.grantee <> 0
          AND a.grantee <> c.relowner
        GROUP BY a.grantee
    LOOP
        EXECUTE format('GRANT USAGE ON SCHEMA milab TO %I', acceso.usuario);
        FOREACH objeto IN ARRAY ARRAY[
            'encuentro_evento',
            'encuentro_participante',
            'encuentro_asistencia',
            'encuentro_asistencia_correccion',
            'encuentro_certificado',
            'encuentro_certificado_version',
            'encuentro_envio_certificado',
            'encuentro_logro'
        ] LOOP
            IF to_regclass(format('milab.%I', objeto)) IS NULL THEN
                RAISE EXCEPTION 'No existe milab.%; aplique primero db_structure_certificacion.sql', objeto;
            END IF;

            EXECUTE format('GRANT %s ON TABLE milab.%I TO %I', acceso.privilegios, objeto, acceso.usuario);
            secuencia := pg_get_serial_sequence(format('milab.%I', objeto), 'id');
            IF secuencia IS NOT NULL THEN
                EXECUTE format(
                    'GRANT USAGE, SELECT ON SEQUENCE %s TO %I',
                    secuencia,
                    acceso.usuario
                );
            END IF;
        END LOOP;
    END LOOP;
END $$;

COMMIT;
