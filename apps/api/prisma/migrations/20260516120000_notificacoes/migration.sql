-- Tabela `notificacoes`: histórico de pushes enviadas pro motorista.
-- Persistida antes do envio pro Expo. Push carrega o id no payload pra
-- fechar o loop "tap → marcar lida".

-- CreateEnum
CREATE TYPE "NotificacaoEntregaStatus" AS ENUM ('PENDENTE', 'ENTREGUE', 'ERRO');

-- CreateTable
CREATE TABLE "notificacoes" (
    "id" TEXT NOT NULL,
    "motoristaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "corpo" TEXT NOT NULL,
    "dados" JSONB,
    "lida" BOOLEAN NOT NULL DEFAULT false,
    "lidaEm" TIMESTAMP(3),
    "entregaStatus" "NotificacaoEntregaStatus" NOT NULL DEFAULT 'PENDENTE',
    "entregaErro" TEXT,
    "expoTicketId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notificacoes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notificacoes_motoristaId_criadoEm_idx" ON "notificacoes"("motoristaId", "criadoEm" DESC);
CREATE INDEX "notificacoes_motoristaId_lida_idx" ON "notificacoes"("motoristaId", "lida");

ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_motoristaId_fkey"
  FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
