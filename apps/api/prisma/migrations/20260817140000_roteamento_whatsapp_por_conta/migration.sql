-- Por qual serviço sai cada tipo de mensagem de WhatsApp, por conta.
--
-- Escrita à mão de propósito: `prisma migrate dev` queria resetar o banco de
-- desenvolvimento por causa de drift antigo de @@index (índices declarados no
-- schema que migrations antigas nunca criaram). O reset não tem nada a ver com
-- esta mudança, então aqui vai só a tabela nova.
CREATE TABLE "configuracao_roteamento_whatsapp" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "rotas" JSONB NOT NULL DEFAULT '{}',
    "telefonesTeste" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    "alteradoPorId" TEXT,

    CONSTRAINT "configuracao_roteamento_whatsapp_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "configuracao_roteamento_whatsapp_contaId_key"
    ON "configuracao_roteamento_whatsapp"("contaId");

ALTER TABLE "configuracao_roteamento_whatsapp"
    ADD CONSTRAINT "configuracao_roteamento_whatsapp_contaId_fkey"
    FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "configuracao_roteamento_whatsapp"
    ADD CONSTRAINT "configuracao_roteamento_whatsapp_alteradoPorId_fkey"
    FOREIGN KEY ("alteradoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
