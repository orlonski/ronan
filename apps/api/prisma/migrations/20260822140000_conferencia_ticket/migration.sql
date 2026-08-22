-- Fila da conferência automática de ticket.
--
-- Mesma mecânica da fila do agente (`execucoes_agente`), com duas diferenças
-- que importam:
--
--   1. tem `contaId`. Isto é dado de negócio de uma empresa, então o model NÃO
--      entra em MODELS_GLOBAIS da trava de conta — o worker abre
--      `comConta(job.contaId, ...)` antes de tocar em viagem, foto ou catálogo.
--   2. o mutex é por VIAGEM (`viagemAtiva` único), não por task. Se fosse por
--      foto, duas fotos da mesma viagem virariam dois jobs concorrentes
--      escrevendo o mesmo status.
--
-- `custoUsd` é DECIMAL(12,6) pelo mesmo motivo de `usos_ia`: uma leitura de
-- Haiku custa ~US$ 0,0047 e sumiria no arredondamento de 4 casas.
--
-- ESCRITA À MÃO: o banco de dev tem drift antigo de `db push` nas FKs de
-- `viagens` (ver migrations 20260717120000 e 20260726210000). Um `migrate dev`
-- arrastaria esse drift junto e pediria reset do banco.

-- CreateEnum
CREATE TYPE "StatusConferenciaTicket" AS ENUM ('PENDENTE', 'EXECUTANDO', 'CONCLUIDA', 'FALHOU', 'DESCARTADA');

-- CreateEnum
CREATE TYPE "VereditoConferencia" AS ENUM ('BATE', 'DIVERGE', 'INCERTO', 'NAO_APLICAVEL');

-- CreateTable
CREATE TABLE "conferencias_ticket" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "viagemId" TEXT NOT NULL,
    "ticketFotoId" TEXT,
    "storageKey" TEXT NOT NULL,
    "viagemAtiva" TEXT,
    "status" "StatusConferenciaTicket" NOT NULL DEFAULT 'PENDENTE',
    "origem" TEXT NOT NULL,
    "declarado" JSONB NOT NULL,
    "leitura" JSONB,
    "divergencias" JSONB,
    "incertezas" JSONB,
    "veredito" "VereditoConferencia",
    "confianca" DOUBLE PRECISION,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proximaTentativaEm" TIMESTAMP(3),
    "workerId" TEXT,
    "reivindicadoEm" TIMESTAMP(3),
    "iniciadoEm" TIMESTAMP(3),
    "finalizadoEm" TIMESTAMP(3),
    "duracaoMs" INTEGER,
    "modelo" TEXT,
    "custoUsd" DECIMAL(12,6),
    "passadas" INTEGER NOT NULL DEFAULT 0,
    "escalouEm" TIMESTAMP(3),
    "acao" TEXT,
    "aplicadoEm" TIMESTAMP(3),
    "erro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conferencias_ticket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- O mutex: uma conferência ativa por viagem. NULL não colide no Postgres, então
-- job finalizado não bloqueia a próxima conferência da mesma viagem.
CREATE UNIQUE INDEX "conferencias_ticket_viagemAtiva_key" ON "conferencias_ticket"("viagemAtiva");

-- CreateIndex
-- Serve exatamente o WHERE do reivindicar.
CREATE INDEX "conferencias_ticket_status_proximaTentativaEm_idx" ON "conferencias_ticket"("status", "proximaTentativaEm");

-- CreateIndex
CREATE INDEX "conferencias_ticket_viagemId_criadoEm_idx" ON "conferencias_ticket"("viagemId", "criadoEm" DESC);

-- CreateIndex
CREATE INDEX "conferencias_ticket_contaId_criadoEm_idx" ON "conferencias_ticket"("contaId", "criadoEm" DESC);

-- AddForeignKey
ALTER TABLE "conferencias_ticket" ADD CONSTRAINT "conferencias_ticket_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conferencias_ticket" ADD CONSTRAINT "conferencias_ticket_viagemId_fkey" FOREIGN KEY ("viagemId") REFERENCES "viagens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- SetNull: apagar a foto no painel não pode apagar o histórico do que foi lido.
ALTER TABLE "conferencias_ticket" ADD CONSTRAINT "conferencias_ticket_ticketFotoId_fkey" FOREIGN KEY ("ticketFotoId") REFERENCES "ticket_fotos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
