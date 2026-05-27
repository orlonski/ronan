-- Pré-validação manual da viagem pelo admin no dashboard. revisadoEm
-- preenchido bloqueia o FechamentoProcessor de sobrescrever o status no
-- match automático/IA. motivoStatus é exigido quando status=DIVERGENTE.

ALTER TABLE "viagens"
  ADD COLUMN "revisadoEm"    TIMESTAMP(3),
  ADD COLUMN "revisadoPorId" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN "motivoStatus"  TEXT;
