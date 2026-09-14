-- CreateEnum
CREATE TYPE "FormaCobranca" AS ENUM ('PIX_AUTOMATICO', 'CARTAO', 'PIX', 'BOLETO');

-- CreateEnum
CREATE TYPE "StatusAssinatura" AS ENUM ('RASCUNHO', 'AGUARDANDO', 'ATIVA', 'INADIMPLENTE', 'CANCELADA');

-- CreateEnum
CREATE TYPE "StatusCobrancaAssinatura" AS ENUM ('PENDENTE', 'CONFIRMADA', 'RECEBIDA', 'VENCIDA', 'ESTORNADA', 'CANCELADA');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AcaoAuditoria" ADD VALUE 'CANCELAR_ASSINATURA';
ALTER TYPE "AcaoAuditoria" ADD VALUE 'BAIXA_MANUAL_COBRANCA';

-- CreateTable
CREATE TABLE "assinaturas" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "status" "StatusAssinatura" NOT NULL DEFAULT 'RASCUNHO',
    "forma" "FormaCobranca" NOT NULL,
    "ciclo" TEXT NOT NULL DEFAULT 'MENSAL',
    "valorCentavos" INTEGER NOT NULL,
    "diaVencimento" INTEGER NOT NULL DEFAULT 10,
    "nomeResponsavel" TEXT NOT NULL,
    "emailCobranca" TEXT NOT NULL,
    "telefoneCobranca" TEXT NOT NULL,
    "documento" TEXT NOT NULL,
    "gateway" TEXT NOT NULL DEFAULT 'asaas',
    "gatewayClienteId" TEXT,
    "gatewayAssinaturaId" TEXT,
    "gatewayAutorizacaoId" TEXT,
    "qrCodePayload" TEXT,
    "qrCodeExpiraEm" TIMESTAMP(3),
    "cartaoBandeira" TEXT,
    "cartaoUltimos4" TEXT,
    "inicioEm" TIMESTAMP(3),
    "proximoVencimento" DATE,
    "canceladaEm" TIMESTAMP(3),
    "motivoCancelamento" TEXT,
    "observacao" TEXT,
    "criadoPorId" TEXT,
    "canceladaPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assinaturas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cobrancas_assinatura" (
    "id" TEXT NOT NULL,
    "assinaturaId" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "competencia" DATE NOT NULL,
    "vencimento" DATE NOT NULL,
    "status" "StatusCobrancaAssinatura" NOT NULL DEFAULT 'PENDENTE',
    "valorCentavos" INTEGER NOT NULL,
    "valorPagoCentavos" INTEGER,
    "pagoEm" TIMESTAMP(3),
    "formaPaga" "FormaCobranca",
    "gatewayCobrancaId" TEXT,
    "linkPagamento" TEXT,
    "pixCopiaCola" TEXT,
    "linhaDigitavel" TEXT,
    "nfseId" TEXT,
    "nfseUrl" TEXT,
    "avisoAbertaEm" TIMESTAMP(3),
    "avisoAtrasoEm" TIMESTAMP(3),
    "avisosAtraso" INTEGER NOT NULL DEFAULT 0,
    "baixadaPorId" TEXT,
    "motivoBaixa" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cobrancas_assinatura_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_gateway_pagamento" (
    "id" TEXT NOT NULL,
    "gateway" TEXT NOT NULL DEFAULT 'asaas',
    "eventoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processadoEm" TIMESTAMP(3),
    "erro" TEXT,

    CONSTRAINT "eventos_gateway_pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assinaturas_contaId_status_idx" ON "assinaturas"("contaId", "status");

-- CreateIndex
CREATE INDEX "assinaturas_status_proximoVencimento_idx" ON "assinaturas"("status", "proximoVencimento");

-- CreateIndex
CREATE INDEX "assinaturas_gatewayAssinaturaId_idx" ON "assinaturas"("gatewayAssinaturaId");

-- CreateIndex
CREATE INDEX "assinaturas_gatewayAutorizacaoId_idx" ON "assinaturas"("gatewayAutorizacaoId");

-- CreateIndex
CREATE UNIQUE INDEX "cobrancas_assinatura_gatewayCobrancaId_key" ON "cobrancas_assinatura"("gatewayCobrancaId");

-- CreateIndex
CREATE INDEX "cobrancas_assinatura_contaId_competencia_idx" ON "cobrancas_assinatura"("contaId", "competencia" DESC);

-- CreateIndex
CREATE INDEX "cobrancas_assinatura_status_vencimento_idx" ON "cobrancas_assinatura"("status", "vencimento");

-- CreateIndex
CREATE UNIQUE INDEX "cobrancas_assinatura_assinaturaId_competencia_key" ON "cobrancas_assinatura"("assinaturaId", "competencia");

-- CreateIndex
CREATE UNIQUE INDEX "eventos_gateway_pagamento_eventoId_key" ON "eventos_gateway_pagamento"("eventoId");

-- CreateIndex
CREATE INDEX "eventos_gateway_pagamento_processadoEm_idx" ON "eventos_gateway_pagamento"("processadoEm");

-- CreateIndex
CREATE INDEX "eventos_gateway_pagamento_tipo_recebidoEm_idx" ON "eventos_gateway_pagamento"("tipo", "recebidoEm" DESC);

-- AddForeignKey
ALTER TABLE "assinaturas" ADD CONSTRAINT "assinaturas_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assinaturas" ADD CONSTRAINT "assinaturas_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assinaturas" ADD CONSTRAINT "assinaturas_canceladaPorId_fkey" FOREIGN KEY ("canceladaPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cobrancas_assinatura" ADD CONSTRAINT "cobrancas_assinatura_assinaturaId_fkey" FOREIGN KEY ("assinaturaId") REFERENCES "assinaturas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cobrancas_assinatura" ADD CONSTRAINT "cobrancas_assinatura_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cobrancas_assinatura" ADD CONSTRAINT "cobrancas_assinatura_baixadaPorId_fkey" FOREIGN KEY ("baixadaPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

