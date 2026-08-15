-- Modo de serviço da viagem: como ela é MEDIDA (peso x período/diária).
-- "Diária" não é um material — cadastrar como material contamina RegraMinimo,
-- ranking de tonelagem e layout de fechamento.
--
-- Compat total: tudo que existe hoje continua com tipoServicoId NULL e cai no
-- tipo `padrao` (PESO) da conta. Nenhuma linha existente é reescrita.

-- CreateEnum
CREATE TYPE "MedicaoViagem" AS ENUM ('PESO', 'PERIODO');

-- AlterEnum: viagem de diária com entrada marcada e saída pendente.
-- Mesma natureza do AGUARDANDO_PESO (incompleta, fora de fechamento/KPI).
ALTER TYPE "StatusViagem" ADD VALUE IF NOT EXISTS 'AGUARDANDO_SAIDA';

-- CreateTable
CREATE TABLE "tipos_servico" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "medicao" "MedicaoViagem" NOT NULL DEFAULT 'PESO',
    "exigeMaterial" BOOLEAN NOT NULL DEFAULT true,
    "exigeTicket" BOOLEAN NOT NULL DEFAULT true,
    "exigeLocalDescarga" BOOLEAN NOT NULL DEFAULT true,
    "exigeKm" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    "criadoPorId" TEXT,

    CONSTRAINT "tipos_servico_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tipos_servico_contaId_slug_key" ON "tipos_servico"("contaId", "slug");
CREATE UNIQUE INDEX "tipos_servico_contaId_nome_key" ON "tipos_servico"("contaId", "nome");
CREATE INDEX "tipos_servico_ativo_ordem_idx" ON "tipos_servico"("ativo", "ordem");
CREATE INDEX "tipos_servico_contaId_idx" ON "tipos_servico"("contaId");

-- Só UM tipo padrão por conta. Índice PARCIAL: o Prisma não expressa isso no
-- schema (mesmo caso do uq_viagem_em_andamento_por_motorista), então mora aqui.
CREATE UNIQUE INDEX "uq_tipo_servico_padrao_por_conta"
    ON "tipos_servico"("contaId") WHERE "padrao";

-- AlterTable
ALTER TABLE "viagens" ADD COLUMN "tipoServicoId" TEXT,
                      ADD COLUMN "entradaEm" TIMESTAMP(3),
                      ADD COLUMN "saidaEm" TIMESTAMP(3),
                      ADD COLUMN "duracaoMinutos" INTEGER;

-- CreateIndex
CREATE INDEX "viagens_tipoServicoId_data_idx" ON "viagens"("tipoServicoId", "data");

-- AlterTable
ALTER TABLE "motoristas" ADD COLUMN "podeDiaria" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "tipos_servico" ADD CONSTRAINT "tipos_servico_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tipos_servico" ADD CONSTRAINT "tipos_servico_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "viagens" ADD CONSTRAINT "viagens_tipoServicoId_fkey" FOREIGN KEY ("tipoServicoId") REFERENCES "tipos_servico"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
