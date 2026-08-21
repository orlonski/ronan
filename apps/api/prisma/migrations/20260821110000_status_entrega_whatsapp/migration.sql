-- Status de entrega reportado pela Meta no webhook.
--
-- Escrita à mão em vez de gerada: o `migrate dev` quis reescrever índices de
-- outras tabelas que o schema declara e migrations antigas nunca criaram
-- (drift conhecido). Arrastar aquilo pra cá misturaria uma correção de índices
-- não relacionada com esta mudança.
ALTER TABLE "whatsapp_mensagens" ADD COLUMN "statusEntrega" TEXT;
ALTER TABLE "whatsapp_mensagens" ADD COLUMN "erroCodigo" TEXT;

-- Serve a pergunta "o que falhou nas últimas 24h", que é a razão da coluna
-- existir. Sem o índice, isso vira varredura da tabela inteira de mensagens.
CREATE INDEX "whatsapp_mensagens_statusEntrega_criadoEm_idx"
  ON "whatsapp_mensagens" ("statusEntrega", "criadoEm");
