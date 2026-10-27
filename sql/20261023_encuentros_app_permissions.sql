-- Garantiza los permisos de escritura necesarios para Encuentros al usuario de
-- conexión de producción. Ejecutar como DBA o propietario de los objetos:
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/20261023_encuentros_app_permissions.sql

BEGIN;

DO $$
DECLARE
    tabla TEXT;
    secuencia TEXT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'milab_app') THEN
        RAISE EXCEPTION 'No existe el rol PostgreSQL milab_app';
    END IF;

    FOREACH tabla IN ARRAY ARRAY[
        'encuentro_evento',
        'encuentro_participante',
        'encuentro_asistencia',
        'encuentro_asistencia_correccion',
        'encuentro_certificado',
        'encuentro_certificado_version',
        'encuentro_envio_certificado',
        'encuentro_logro'
    ] LOOP
        IF to_regclass(format('%I.%I', 'milab', tabla)) IS NULL THEN
            RAISE EXCEPTION 'No existe milab.%; aplique primero db_structure_certificacion.sql', tabla;
        END IF;

        EXECUTE format(
            'GRANT USAGE ON SCHEMA %I TO %I',
            'milab',
            'milab_app'
        );
        EXECUTE format(
            'GRANT SELECT, INSERT, UPDATE ON TABLE %I.%I TO %I',
            'milab',
            tabla,
            'milab_app'
        );

        secuencia := pg_get_serial_sequence(format('%I.%I', 'milab', tabla), 'id');
        IF secuencia IS NOT NULL THEN
            EXECUTE format(
                'GRANT USAGE, SELECT ON SEQUENCE %s TO %I',
                secuencia,
                'milab_app'
            );
        END IF;
    END LOOP;
END $$;

COMMIT;
