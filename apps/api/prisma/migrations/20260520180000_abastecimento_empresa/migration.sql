-- Adiciona FK opcional de Abastecimento -> Empresa.
-- Schema fica nullable (legacy data fica com NULL); app/Zod exige obrigatório.

ALTER TABLE "abastecimentos" ADD COLUMN "empresaId" TEXT;

CREATE INDEX "abastecimentos_empresaId_data_idx" ON "abastecimentos"("empresaId", "data");

ALTER TABLE "abastecimentos"
  ADD CONSTRAINT "abastecimentos_empresaId_fkey"
  FOREIGN KEY ("empresaId") REFERENCES "empresas"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
