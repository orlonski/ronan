-- Aviso de problema no caminhão, mandado pelo motorista pelo app (23/09/2026).
DO $$ BEGIN
  CREATE TYPE "StatusProblemaVeiculo" AS ENUM ('ABERTO', 'VIROU_MANUTENCAO', 'DESCARTADO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "problemas_veiculo" (
  "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "motoristaId" TEXT NOT NULL,
  "veiculoId" TEXT,
  "descricao" TEXT NOT NULL,
  "fotos" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "status" "StatusProblemaVeiculo" NOT NULL DEFAULT 'ABERTO',
  "manutencaoId" TEXT,
  "motivoDescarte" TEXT,
  "decididoPorId" TEXT,
  "decididoEm" TIMESTAMP(3),
  "avisadoEm" TIMESTAMP(3) NOT NULL,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "problemas_veiculo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "problemas_veiculo_manutencaoId_key" ON "problemas_veiculo"("manutencaoId");
CREATE UNIQUE INDEX IF NOT EXISTS "problemas_veiculo_contaId_clientId_key" ON "problemas_veiculo"("contaId", "clientId");
CREATE INDEX IF NOT EXISTS "problemas_veiculo_contaId_status_idx" ON "problemas_veiculo"("contaId", "status");

DO $$ BEGIN
  ALTER TABLE "problemas_veiculo" ADD CONSTRAINT "problemas_veiculo_contaId_fkey"
    FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "problemas_veiculo" ADD CONSTRAINT "problemas_veiculo_motoristaId_fkey"
    FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "problemas_veiculo" ADD CONSTRAINT "problemas_veiculo_veiculoId_fkey"
    FOREIGN KEY ("veiculoId") REFERENCES "veiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "problemas_veiculo" ADD CONSTRAINT "problemas_veiculo_manutencaoId_fkey"
    FOREIGN KEY ("manutencaoId") REFERENCES "manutencoes_veiculo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "problemas_veiculo" ADD CONSTRAINT "problemas_veiculo_decididoPorId_fkey"
    FOREIGN KEY ("decididoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Capacidade nova no app. Nasce ligada como as outras capacidades novas; só
-- aparece pra quem tem o módulo Frota (o resolvedor corta o resto).
UPDATE "perfis_acesso_app"
SET "capacidades" = array_append("capacidades", 'app.problema.avisar'),
    "alteradoEm" = CURRENT_TIMESTAMP
WHERE NOT ('app.problema.avisar' = ANY("capacidades"));
