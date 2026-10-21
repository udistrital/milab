SET search_path TO milab;

BEGIN;

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

COMMIT;
