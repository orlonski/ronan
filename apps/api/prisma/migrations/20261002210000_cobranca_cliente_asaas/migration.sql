-- Cobrança do cliente da transportadora pelo Asaas DELA (boleto/Pix da fatura),
-- com baixa automática pelo webhook. Nada aqui toca a mensalidade da Movatruck
-- (assinaturas / cobrancas_assinatura), que é outro dinheiro e outra conta Asaas.
--
-- baixas_titulo.usuarioId vira opcional: a única baixa sem usuário é a que o
-- banco confirmou pelo gateway (cobrancaClienteId preenchido). A FK continua
-- RESTRICT, como era.

-- CreateEnum
CREATE TYPE "AmbienteAsaas" AS ENUM ('SANDBOX', 'PRODUCAO');

-- CreateEnum
CREATE TYPE "StatusCobrancaCliente" AS ENUM ('PENDENTE', 'VENCIDA', 'PAGA', 'ESTORNADA', 'CANCELADA');

-- AlterTable
ALTER TABLE "baixas_titulo" ADD COLUMN     "cobrancaClienteId" TEXT,
ALTER COLUMN "usuarioId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "conexoes_asaas" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "ambiente" "AmbienteAsaas" NOT NULL,
    "chaveCifrada" TEXT NOT NULL,
    "chaveFinal" TEXT NOT NULL,
    "nomeContaAsaas" TEXT,
    "documentoContaAsaas" TEXT,
    "webhookId" TEXT,
    "webhookTokenHash" TEXT NOT NULL,
    "webhookErro" TEXT,
    "conectadoPorId" TEXT,
    "conectadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conexoes_asaas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cobrancas_cliente" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "tituloReceberId" TEXT NOT NULL,
    "tituloAtivoId" TEXT,
    "status" "StatusCobrancaCliente" NOT NULL DEFAULT 'PENDENTE',
    "ambiente" "AmbienteAsaas" NOT NULL,
    "asaasPaymentId" TEXT,
    "asaasCustomerId" TEXT,
    "valor" DECIMAL(12,2) NOT NULL,
    "vencimento" DATE NOT NULL,
    "linkFatura" TEXT,
    "linhaDigitavel" TEXT,
    "pixCopiaCola" TEXT,
    "pagoEm" DATE,
    "valorRecebido" DECIMAL(12,2),
    "meio" TEXT,
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cobrancas_cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_cobranca_cliente" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "eventoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "asaasPaymentId" TEXT,
    "cobrancaClienteId" TEXT,
    "payload" JSONB NOT NULL,
    "resultado" TEXT,
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_cobranca_cliente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conexoes_asaas_contaId_key" ON "conexoes_asaas"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "cobrancas_cliente_tituloAtivoId_key" ON "cobrancas_cliente"("tituloAtivoId");

-- CreateIndex
CREATE INDEX "cobrancas_cliente_tituloReceberId_idx" ON "cobrancas_cliente"("tituloReceberId");

-- CreateIndex
CREATE INDEX "cobrancas_cliente_contaId_idx" ON "cobrancas_cliente"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "cobrancas_cliente_contaId_asaasPaymentId_key" ON "cobrancas_cliente"("contaId", "asaasPaymentId");

-- CreateIndex
CREATE INDEX "eventos_cobranca_cliente_cobrancaClienteId_idx" ON "eventos_cobranca_cliente"("cobrancaClienteId");

-- CreateIndex
CREATE INDEX "eventos_cobranca_cliente_contaId_idx" ON "eventos_cobranca_cliente"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "eventos_cobranca_cliente_contaId_eventoId_key" ON "eventos_cobranca_cliente"("contaId", "eventoId");

-- CreateIndex
CREATE UNIQUE INDEX "baixas_titulo_cobrancaClienteId_key" ON "baixas_titulo"("cobrancaClienteId");

-- AddForeignKey
ALTER TABLE "baixas_titulo" ADD CONSTRAINT "baixas_titulo_cobrancaClienteId_fkey" FOREIGN KEY ("cobrancaClienteId") REFERENCES "cobrancas_cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conexoes_asaas" ADD CONSTRAINT "conexoes_asaas_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cobrancas_cliente" ADD CONSTRAINT "cobrancas_cliente_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cobrancas_cliente" ADD CONSTRAINT "cobrancas_cliente_tituloReceberId_fkey" FOREIGN KEY ("tituloReceberId") REFERENCES "titulos_receber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_cobranca_cliente" ADD CONSTRAINT "eventos_cobranca_cliente_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_cobranca_cliente" ADD CONSTRAINT "eventos_cobranca_cliente_cobrancaClienteId_fkey" FOREIGN KEY ("cobrancaClienteId") REFERENCES "cobrancas_cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

