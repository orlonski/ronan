-- Rastro de por onde cada mensagem saiu e quanto custou.
--
-- Até aqui os 8 envios do sistema (códigos, resumos, aviso de peso, link de
-- comprovante) não gravavam NADA: só o inbound e as respostas do agente
-- apareciam. Não dava pra responder "o resumo saiu ontem?".
--
-- Tudo nullable com default seguro: o histórico que já existe continua
-- verdadeiro sem backfill, porque até agosto/2026 só havia um caminho.
ALTER TABLE "whatsapp_mensagens"
    ADD COLUMN "provedor" TEXT NOT NULL DEFAULT 'evolution',
    ADD COLUMN "idExterno" TEXT,
    ADD COLUMN "rota" TEXT,
    ADD COLUMN "categoria" TEXT,
    ADD COLUMN "custoEstimado" DECIMAL(10,4);

-- É por aqui que o callback de entrega da Meta vai achar a mensagem.
CREATE INDEX "whatsapp_mensagens_idExterno_idx" ON "whatsapp_mensagens"("idExterno");

-- Consumo por empresa e por tipo de mensagem, que é a pergunta do painel.
CREATE INDEX "whatsapp_mensagens_contaId_rota_criadoEm_idx"
    ON "whatsapp_mensagens"("contaId", "rota", "criadoEm");
