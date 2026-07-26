-- Fila de execuções do agente sobre tasks do ClickUp (webhook de Automation).
--
-- Persistida no banco de propósito: reinício do serviço não pode perder item, e
-- dedupe/concorrência precisam valer entre réplicas. A unicidade de "taskAtiva"
-- é o que garante UMA execução ativa por task mesmo com dois webhooks chegando
-- ao mesmo tempo (NULL não colide no Postgres, então execuções já finalizadas
-- não atrapalham as próximas da mesma task).
--
-- ESCRITA À MÃO: o banco de dev tem drift antigo de `db push` nas FKs de
-- `viagens` (mesma observação da migration 20260717120000). Um `migrate dev`
-- arrastaria esse drift pra cá; esta migration contém APENAS a feature.

-- CreateEnum
CREATE TYPE "StatusExecucaoAgente" AS ENUM ('PENDENTE', 'EXECUTANDO', 'CONCLUIDA', 'FALHOU', 'EXCEDEU_LIMITE');

-- CreateTable
CREATE TABLE "execucoes_agente" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "taskAtiva" TEXT,
    "status" "StatusExecucaoAgente" NOT NULL DEFAULT 'PENDENTE',
    "payload" JSONB NOT NULL,
    "origemIp" TEXT,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proximaTentativaEm" TIMESTAMP(3),
    "workerId" TEXT,
    "reivindicadoEm" TIMESTAMP(3),
    "iniciadoEm" TIMESTAMP(3),
    "finalizadoEm" TIMESTAMP(3),
    "duracaoMs" INTEGER,
    "custoUsd" DECIMAL(10,4),
    "exitCode" INTEGER,
    "branch" TEXT,
    "arquivosAlterados" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resumo" TEXT,
    "erro" TEXT,
    "comentadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "execucoes_agente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "execucoes_agente_taskAtiva_key" ON "execucoes_agente"("taskAtiva");

-- CreateIndex
CREATE INDEX "execucoes_agente_status_proximaTentativaEm_idx" ON "execucoes_agente"("status", "proximaTentativaEm");

-- CreateIndex
CREATE INDEX "execucoes_agente_taskId_criadoEm_idx" ON "execucoes_agente"("taskId", "criadoEm" DESC);
