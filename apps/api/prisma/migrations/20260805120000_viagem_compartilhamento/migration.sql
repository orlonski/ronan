-- Link público (sem login) do comprovante de uma viagem: o painel gera, o
-- cliente/embarcador abre pelo WhatsApp. Capability URL — o controle é entropia
-- do token + validade + revogação, não sessão.
--
-- `revogadoEm` é soft-revoke de propósito: a linha nunca é apagada, senão o
-- registro de quem expôs o quê some junto com a evidência.
--
-- ESCRITA À MÃO: o banco de dev tem drift antigo de `db push` em índices e nas
-- FKs de `viagens` (mesma observação das migrations 20260717120000 e
-- 20260726210000). Um `migrate dev` arrastaria esse drift pra cá; esta
-- migration contém APENAS a feature.

-- AlterEnum
ALTER TYPE "AcaoAuditoria" ADD VALUE IF NOT EXISTS 'COMPARTILHAR_VIAGEM';
ALTER TYPE "AcaoAuditoria" ADD VALUE IF NOT EXISTS 'REVOGAR_COMPARTILHAMENTO';
ALTER TYPE "AcaoAuditoria" ADD VALUE IF NOT EXISTS 'ENVIAR_COMPARTILHAMENTO';

-- CreateTable
CREATE TABLE "viagem_compartilhamentos" (
    "id" TEXT NOT NULL,
    "viagemId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "criadoPorId" TEXT,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "revogadoEm" TIMESTAMP(3),
    "revogadoPorId" TEXT,
    "visualizacoes" INTEGER NOT NULL DEFAULT 0,
    "primeiroAcessoEm" TIMESTAMP(3),
    "ultimoAcessoEm" TIMESTAMP(3),
    "ultimoAcessoIp" TEXT,
    "destinatarioTelefone" TEXT,
    "enviadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "viagem_compartilhamentos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "viagem_compartilhamentos_token_key" ON "viagem_compartilhamentos"("token");

-- CreateIndex
CREATE INDEX "viagem_compartilhamentos_viagemId_criadoEm_idx" ON "viagem_compartilhamentos"("viagemId", "criadoEm");

-- CreateIndex
CREATE INDEX "viagem_compartilhamentos_expiraEm_idx" ON "viagem_compartilhamentos"("expiraEm");

-- AddForeignKey
ALTER TABLE "viagem_compartilhamentos" ADD CONSTRAINT "viagem_compartilhamentos_viagemId_fkey" FOREIGN KEY ("viagemId") REFERENCES "viagens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viagem_compartilhamentos" ADD CONSTRAINT "viagem_compartilhamentos_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viagem_compartilhamentos" ADD CONSTRAINT "viagem_compartilhamentos_revogadoPorId_fkey" FOREIGN KEY ("revogadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
