-- A OS guarda o plano que cumpre, pra zerar o plano na CONCLUSÃO (24/09/2026).
ALTER TABLE "manutencoes_veiculo" ADD COLUMN IF NOT EXISTS "planoId" TEXT;
CREATE INDEX IF NOT EXISTS "manutencoes_veiculo_planoId_idx" ON "manutencoes_veiculo"("planoId");
DO $$ BEGIN
  ALTER TABLE "manutencoes_veiculo" ADD CONSTRAINT "manutencoes_veiculo_planoId_fkey"
    FOREIGN KEY ("planoId") REFERENCES "planos_manutencao"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
