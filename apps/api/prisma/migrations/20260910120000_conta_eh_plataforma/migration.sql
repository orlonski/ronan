-- A conta da plataforma (a casa) deixa de ser descoberta por "a mais antiga por
-- criadaEm" e passa a ser uma flag explícita.
--
-- O predicado decide quem pode conceder as chaves de plataforma — e estava
-- apoiado no dado mais frágil do banco: um restore, um backfill que mexesse em
-- criadaEm, ou apagar a conta 1 transferia a autoridade pra uma empresa
-- cliente, que no boot seguinte recebia o catálogo inteiro de permissões.
ALTER TABLE "contas" ADD COLUMN "ehPlataforma" BOOLEAN NOT NULL DEFAULT false;

-- Congela o comportamento vigente: quem é a plataforma hoje é a conta mais
-- antiga. Depois desta linha a ordem de criação não decide mais nada.
UPDATE "contas"
   SET "ehPlataforma" = true
 WHERE "id" = (SELECT "id" FROM "contas" ORDER BY "criadaEm" ASC LIMIT 1);
