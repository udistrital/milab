BEGIN;

CREATE TABLE IF NOT EXISTS config_facultad_multas (
    facultad_id INTEGER NOT NULL PRIMARY KEY,
    permite_crear_multas_activas_directas BOOLEAN NOT NULL DEFAULT FALSE,
    permite_saldar_multas_directas BOOLEAN NOT NULL DEFAULT FALSE,
    fecha_ultima_modificacion TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    documento_ultimo_autorizador TEXT,
    accion_ultima TEXT DEFAULT 'inicial',
    CONSTRAINT config_facultad_multas_facultad_fk
        FOREIGN KEY (facultad_id) REFERENCES facultad(facultad_id)
        ON DELETE CASCADE
);

INSERT INTO config_facultad_multas (facultad_id)
SELECT facultad_id
FROM facultad
ON CONFLICT (facultad_id) DO NOTHING;

COMMIT;
