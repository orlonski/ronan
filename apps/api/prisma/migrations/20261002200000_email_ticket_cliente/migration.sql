-- Envio de e-mail (base) + ticket enviado sozinho ao cliente.
--
-- Tudo nasce DESLIGADO: ticketEnvioModo = NENHUM no cliente pagador e NULL
-- (segue o pagador) na obra. Subir esta migration não faz e-mail nenhum sair.
-- emails_enviados registra cada tentativa; "chave" unique é a idempotência
-- (o mesmo ticket nunca sai duas vezes).

-- CreateEnum
CREATE TYPE "ModoEnvioTicket" AS ENUM ('NENHUM', 'A_CADA_VIAGEM', 'RESUMO_DIARIO');

-- CreateEnum
CREATE TYPE "StatusEmailEnviado" AS ENUM ('ENVIANDO', 'ENVIADO', 'FALHOU');

-- AlterTable
ALTER TABLE "empresas" ADD COLUMN     "ticketEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "ticketEnvioDesde" TIMESTAMP(3),
ADD COLUMN     "ticketEnvioModo" "ModoEnvioTicket" NOT NULL DEFAULT 'NENHUM';

-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "ticketEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "ticketEnvioDesde" TIMESTAMP(3),
ADD COLUMN     "ticketEnvioModo" "ModoEnvioTicket";

-- CreateTable
CREATE TABLE "emails_enviados" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "para" TEXT[],
    "assunto" TEXT NOT NULL,
    "status" "StatusEmailEnviado" NOT NULL DEFAULT 'ENVIANDO',
    "erro" TEXT,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "chave" TEXT,
    "referenciaTipo" TEXT,
    "referenciaId" TEXT,
    "messageId" TEXT,
    "empresaId" TEXT,
    "clienteId" TEXT,
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimaTentativaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviadoEm" TIMESTAMP(3),

    CONSTRAINT "emails_enviados_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "emails_enviados_chave_key" ON "emails_enviados"("chave");

-- CreateIndex
CREATE INDEX "emails_enviados_contaId_criadoEm_idx" ON "emails_enviados"("contaId", "criadoEm");

-- CreateIndex
CREATE INDEX "emails_enviados_empresaId_criadoEm_idx" ON "emails_enviados"("empresaId", "criadoEm");

-- CreateIndex
CREATE INDEX "emails_enviados_clienteId_criadoEm_idx" ON "emails_enviados"("clienteId", "criadoEm");

-- CreateIndex
CREATE INDEX "emails_enviados_status_criadoEm_idx" ON "emails_enviados"("status", "criadoEm");

-- AddForeignKey
ALTER TABLE "emails_enviados" ADD CONSTRAINT "emails_enviados_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emails_enviados" ADD CONSTRAINT "emails_enviados_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emails_enviados" ADD CONSTRAINT "emails_enviados_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emails_enviados" ADD CONSTRAINT "emails_enviados_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

