-- CreateEnum: tipo de bloco de fechamento
CREATE TYPE "TipoBlocoFechamento" AS ENUM ('VIAGEM', 'PEDAGIO', 'COMBUSTIVEL');

-- CreateTable: layout import por tipo de bloco
CREATE TABLE "layout_import_blocos" (
    "id" TEXT NOT NULL,
    "empresaClienteId" TEXT NOT NULL,
    "tipo" "TipoBlocoFechamento" NOT NULL,
    "abaPreferida" TEXT,
    "linhaCabecalho" INTEGER,
    "linhaInicioDados" INTEGER,
    "colunas" JSONB NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "layout_import_blocos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "layout_import_blocos_empresaClienteId_idx" ON "layout_import_blocos"("empresaClienteId");
CREATE UNIQUE INDEX "layout_import_blocos_empresaClienteId_tipo_key" ON "layout_import_blocos"("empresaClienteId", "tipo");

-- AddForeignKey
ALTER TABLE "layout_import_blocos" ADD CONSTRAINT "layout_import_blocos_empresaClienteId_fkey" FOREIGN KEY ("empresaClienteId") REFERENCES "empresas_cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migra dados antigos: pra cada empresa que tem layoutImport não-null, cria
-- um bloco do tipo VIAGEM com o conteúdo. Idempotente — se já existe pra
-- (empresa, VIAGEM), pula.
INSERT INTO "layout_import_blocos" (id, "empresaClienteId", tipo, "abaPreferida", "linhaCabecalho", "linhaInicioDados", colunas, ativo, "alteradoEm", "criadoEm")
SELECT
  gen_random_uuid()::text,
  ec.id,
  'VIAGEM'::"TipoBlocoFechamento",
  ec."layoutImport"->>'abaPreferida',
  NULLIF(ec."layoutImport"->>'linhaCabecalho', '')::int,
  NULLIF(ec."layoutImport"->>'linhaInicioDados', '')::int,
  COALESCE(ec."layoutImport"->'colunas', '[]'::jsonb),
  true,
  now(),
  now()
FROM "empresas_cliente" ec
WHERE ec."layoutImport" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "layout_import_blocos" b
    WHERE b."empresaClienteId" = ec.id AND b.tipo = 'VIAGEM'::"TipoBlocoFechamento"
  );

-- AlterTable: adiciona tipo + matchIds em FechamentoLinha
ALTER TABLE "fechamento_linhas" ADD COLUMN "tipo" "TipoBlocoFechamento" NOT NULL DEFAULT 'VIAGEM';
ALTER TABLE "fechamento_linhas" ADD COLUMN "pedagioMatchId" TEXT;
ALTER TABLE "fechamento_linhas" ADD COLUMN "abastecimentoMatchId" TEXT;

-- CreateIndex
CREATE INDEX "fechamento_linhas_fechamentoId_tipo_idx" ON "fechamento_linhas"("fechamentoId", "tipo");
CREATE INDEX "fechamento_linhas_pedagioMatchId_idx" ON "fechamento_linhas"("pedagioMatchId");
CREATE INDEX "fechamento_linhas_abastecimentoMatchId_idx" ON "fechamento_linhas"("abastecimentoMatchId");

-- AddForeignKey
ALTER TABLE "fechamento_linhas" ADD CONSTRAINT "fechamento_linhas_pedagioMatchId_fkey" FOREIGN KEY ("pedagioMatchId") REFERENCES "pedagios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fechamento_linhas" ADD CONSTRAINT "fechamento_linhas_abastecimentoMatchId_fkey" FOREIGN KEY ("abastecimentoMatchId") REFERENCES "abastecimentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
