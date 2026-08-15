-- Modalidade do motorista (próprio / agregado / terceiro) e fotos tipadas no
-- abastecimento (cupom, odômetro, bomba).
--
-- Tudo nasce inerte: conta sem modalidade cadastrada e motorista sem modalidade
-- se comportam exatamente como antes — vale só o cupom da conta.

-- CreateEnum
CREATE TYPE "TipoFotoAbastecimento" AS ENUM ('CUPOM', 'ODOMETRO', 'BOMBA');

-- CreateTable
CREATE TABLE "modalidades_motorista" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "exigeFotoCupom" BOOLEAN NOT NULL DEFAULT false,
    "exigeFotoOdometro" BOOLEAN NOT NULL DEFAULT false,
    "exigeFotoBomba" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    "criadoPorId" TEXT,

    CONSTRAINT "modalidades_motorista_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "modalidades_motorista_contaId_slug_key" ON "modalidades_motorista"("contaId", "slug");
CREATE UNIQUE INDEX "modalidades_motorista_contaId_nome_key" ON "modalidades_motorista"("contaId", "nome");
CREATE INDEX "modalidades_motorista_ativo_ordem_idx" ON "modalidades_motorista"("ativo", "ordem");
CREATE INDEX "modalidades_motorista_contaId_idx" ON "modalidades_motorista"("contaId");

-- AlterTable
ALTER TABLE "motoristas" ADD COLUMN "modalidadeId" TEXT;
CREATE INDEX "motoristas_modalidadeId_idx" ON "motoristas"("modalidadeId");

-- AlterTable: DEFAULT 'CUPOM' é o que salva o histórico — toda foto que já
-- existe é o cupom, porque até agora só cabia uma por abastecimento.
ALTER TABLE "abastecimento_fotos"
  ADD COLUMN "tipo" "TipoFotoAbastecimento" NOT NULL DEFAULT 'CUPOM';

-- AddForeignKey
ALTER TABLE "modalidades_motorista" ADD CONSTRAINT "modalidades_motorista_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "modalidades_motorista" ADD CONSTRAINT "modalidades_motorista_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "motoristas" ADD CONSTRAINT "motoristas_modalidadeId_fkey" FOREIGN KEY ("modalidadeId") REFERENCES "modalidades_motorista"("id") ON DELETE SET NULL ON UPDATE CASCADE;
