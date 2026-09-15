-- Um lead inbound por telefone.
--
-- Duas mensagens em sequência ("oi" e, dois segundos depois, "quanto custa?")
-- chegam em webhooks paralelos do Chatwoot e disputam a criação do mesmo lead.
-- Sem esta trava nascem dois cadastros pro mesmo número, cada um com metade da
-- conversa — e o SDR, que lê o histórico pelo lead, repete pergunta que já fez.
--
-- Parcial de propósito: telefone repetido é NORMAL na prospecção ativa (o
-- contador de três transportadoras atende pelo mesmo número), e uma unique
-- cheia quebraria a carga do RNTRC. Índice parcial não é representável no
-- schema.prisma — está anotado em `model Lead` pra não virar drift silencioso.
CREATE UNIQUE INDEX IF NOT EXISTS "leads_telefone_inbound_key"
  ON "leads" ("telefone")
  WHERE "origem" = 'WHATSAPP_INBOUND' AND "telefone" IS NOT NULL;
