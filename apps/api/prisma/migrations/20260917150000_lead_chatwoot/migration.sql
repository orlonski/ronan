-- O lead e a conversa dele no Chatwoot, ligados pelos dois lados.
--
-- O webhook já criava o lead de quem escreve no WhatsApp, mas o caminho de
-- volta não existia: da ficha no painel não dava pra chegar na conversa, e do
-- Chatwoot não dava pra saber que aquele número é uma transportadora com
-- CNPJ, cidade e nota. Guardar os três ids resolve as duas pontas com uma
-- coluna cada.
--
-- Tudo opcional: lead que veio do RNTRC e nunca escreveu não tem conversa
-- nenhuma, e isso é o normal da base.

ALTER TABLE "leads" ADD COLUMN "chatwootContaId" INTEGER;
ALTER TABLE "leads" ADD COLUMN "chatwootContatoId" INTEGER;
ALTER TABLE "leads" ADD COLUMN "chatwootConversaId" INTEGER;
