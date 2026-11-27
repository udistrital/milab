ALTER TABLE milab.multa
  ADD COLUMN IF NOT EXISTS sga_deuda_estado VARCHAR(1);

COMMENT ON COLUMN milab.multa.sga_deuda_estado IS
  'Estado de la deuda en SGA: 1 = activa (bloqueo vigente), 3 = saldada (bloqueo retirado). NULL = sin bloqueo.';
