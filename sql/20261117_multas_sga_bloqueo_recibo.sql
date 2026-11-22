ALTER TABLE milab.multa
  ADD COLUMN IF NOT EXISTS sga_deuda_id VARCHAR(50);

COMMENT ON COLUMN milab.multa.sga_deuda_id IS
  'Identificador de la deuda creada en SGA (P_RESULTADO_SECUENCIA). NULL = sin bloqueo de recibo de pago.';
