-- Enriquecimento do lead com os dados públicos da Receita.
--
-- O RNTRC dá quem existe, mas não dá como falar com a pessoa. Estes campos vêm
-- da consulta por CNPJ (BrasilAPI, que serve os dados abertos da Receita).
--
-- "cnae" é o campo mais valioso da leva: confirma o ramo de verdade, onde a
-- heurística por razão social erra — "COMERCIO DE ALIMENTOS LTDA" pode ter
-- tirado RNTRC só pra levar a própria carga.
--
-- "socio" é dado pessoal (nome de pessoa natural). Entra no mesmo regime de
-- legítimo interesse do resto e sai junto no opt-out.

ALTER TABLE "leads" ADD COLUMN "nomeFantasia" TEXT;
ALTER TABLE "leads" ADD COLUMN "cnae" TEXT;
ALTER TABLE "leads" ADD COLUMN "cnaeDescricao" TEXT;
ALTER TABLE "leads" ADD COLUMN "porte" TEXT;
ALTER TABLE "leads" ADD COLUMN "capitalSocial" DECIMAL(15,2);
ALTER TABLE "leads" ADD COLUMN "situacaoCadastral" TEXT;
ALTER TABLE "leads" ADD COLUMN "socio" TEXT;
ALTER TABLE "leads" ADD COLUMN "enriquecidoEm" TIMESTAMP(3);
ALTER TABLE "leads" ADD COLUMN "enriquecimentoTentativas" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "leads" ADD COLUMN "enriquecimentoErro" TEXT;

CREATE INDEX "leads_enriquecidoEm_idx" ON "leads"("enriquecidoEm");
