-- Odômetro conferido no painel do caminhão: âncora do km estimado (24/09/2026).
CREATE TABLE IF NOT EXISTS "leituras_odometro" (
  "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
  "id" TEXT NOT NULL,
  "veiculoId" TEXT NOT NULL,
  "odometro" INTEGER NOT NULL,
  "lidoEm" DATE NOT NULL,
  "observacao" TEXT,
  "criadoPorId" TEXT,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leituras_odometro_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "leituras_odometro_contaId_veiculoId_idx" ON "leituras_odometro"("contaId", "veiculoId");
DO $$ BEGIN
  ALTER TABLE "leituras_odometro" ADD CONSTRAINT "leituras_odometro_contaId_fkey"
    FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "leituras_odometro" ADD CONSTRAINT "leituras_odometro_veiculoId_fkey"
    FOREIGN KEY ("veiculoId") REFERENCES "veiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "leituras_odometro" ADD CONSTRAINT "leituras_odometro_criadoPorId_fkey"
    FOREIGN KEY ("criadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
