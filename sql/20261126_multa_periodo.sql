-- Período académico al que pertenece la sanción (1, 2 o 3).
-- Se usa como DEU_PER al generar el bloqueo de recibo de pago en SGA.
ALTER TABLE milab.multa
  ADD COLUMN IF NOT EXISTS periodo INT;

COMMENT ON COLUMN milab.multa.periodo IS
  'Período académico de la sanción (1, 2 o 3). Se envía como DEU_PER al crear la deuda en SGA.';
