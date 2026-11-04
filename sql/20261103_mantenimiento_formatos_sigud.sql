ALTER TABLE milab.mantenimiento
  ADD COLUMN IF NOT EXISTS formato_registro VARCHAR(20),
  ADD COLUMN IF NOT EXISTS descripcion_falla TEXT,
  ADD COLUMN IF NOT EXISTS responsable_verificar VARCHAR(150),
  ADD COLUMN IF NOT EXISTS firma_responsable_verificar VARCHAR(150),
  ADD COLUMN IF NOT EXISTS firma_proveedor VARCHAR(150),
  ADD COLUMN IF NOT EXISTS diligenciado_por VARCHAR(150),
  ADD COLUMN IF NOT EXISTS cargo_diligenciado_por VARCHAR(150),
  ADD COLUMN IF NOT EXISTS sede VARCHAR(150),
  ADD COLUMN IF NOT EXISTS area_especifica VARCHAR(255),
  ADD COLUMN IF NOT EXISTS descripcion_accion_verificacion TEXT,
  ADD COLUMN IF NOT EXISTS registro_mantenimiento JSONB,
  ADD COLUMN IF NOT EXISTS cumple_mantenimiento BOOLEAN,
  ADD COLUMN IF NOT EXISTS justificacion_ausencia_mantenimiento TEXT,
  ADD COLUMN IF NOT EXISTS firma_responsable VARCHAR(150),
  ADD COLUMN IF NOT EXISTS encargado_elaboracion VARCHAR(150),
  ADD COLUMN IF NOT EXISTS descripcion_actividad TEXT,
  ADD COLUMN IF NOT EXISTS meses_programados JSONB,
  ADD COLUMN IF NOT EXISTS verificado_por VARCHAR(150),
  ADD COLUMN IF NOT EXISTS firma_verificacion VARCHAR(150),
  ADD COLUMN IF NOT EXISTS observaciones_generales TEXT;

ALTER TABLE milab.mantenimiento
  DROP CONSTRAINT IF EXISTS ck_formato_registro_mantenimiento;

ALTER TABLE milab.mantenimiento
  ADD CONSTRAINT ck_formato_registro_mantenimiento
  CHECK (
    formato_registro IS NULL
    OR formato_registro IN ('FR-026', 'FR-028', 'FR-029')
  );
