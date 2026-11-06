CREATE TABLE IF NOT EXISTS milab.hoja_vida_baja (
  id BIGSERIAL PRIMARY KEY,
  hoja_vida_id BIGINT NOT NULL,
  equipo_id INT NOT NULL,
  motivo TEXT NOT NULL,
  fecha_baja DATE NOT NULL,
  responsable VARCHAR(150) NOT NULL,
  estado VARCHAR(30) NOT NULL,
  observaciones TEXT,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_modificacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_creacion VARCHAR(50),
  usuario_modificacion VARCHAR(50),
  CONSTRAINT ck_estado_hoja_vida_baja CHECK (estado IN ('REGISTRADA', 'APLICADA', 'REVERTIDA')),
  CONSTRAINT fk_hoja_vida_baja_hoja_vida FOREIGN KEY (hoja_vida_id)
    REFERENCES milab.hoja_vida (id) ON DELETE CASCADE,
  CONSTRAINT fk_hoja_vida_baja_equipo FOREIGN KEY (equipo_id)
    REFERENCES milab.equipo (id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_hoja_vida_baja_hoja_vida_id
  ON milab.hoja_vida_baja (hoja_vida_id);

CREATE INDEX IF NOT EXISTS idx_hoja_vida_baja_equipo_id
  ON milab.hoja_vida_baja (equipo_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_hoja_vida_baja_activa_hoja_vida
  ON milab.hoja_vida_baja (hoja_vida_id)
  WHERE activo = TRUE;
