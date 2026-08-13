-- Logo própria por empresa.
--
-- Duas colunas em vez de uma: `logoUrl` é o que o painel usa no <img> (com um
-- `v` no fim pra furar o cache do navegador quando a logo troca), e `logoKey`
-- é a chave do objeto no MinIO — guardada à parte justamente pra dar pra apagar
-- a logo antiga em vez de acumular arquivo órfão no bucket.
ALTER TABLE "contas" ADD COLUMN "logoKey" TEXT;
