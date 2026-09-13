-- O que o autônomo precisa e não tinha.
--
-- 1) Eixos. O sistema sabe as praças que a rota cruza e o valor por eixo de
--    cada uma, e ainda assim a tela dizia só "passa por 3 praças". Faltava um
--    número: quantos eixos ele roda. Com ele, pedágio vira R$.
ALTER TABLE "motorista_identidades" ADD COLUMN "eixos" INTEGER;

-- 2) Quem contratou e se já pagou.
--    `valorRecebido` sempre significou "o combinado", não "o que caiu na
--    conta" — e a tela somava tudo como ganho. Para quem vive de frete, a
--    pergunta do mês é outra: quem ainda me deve.
ALTER TABLE "viagens_pessoais" ADD COLUMN "contratante" TEXT;
ALTER TABLE "viagens_pessoais" ADD COLUMN "recebidoEm" DATE;

-- Histórico: frete antigo com valor entra como RECEBIDO. Marcar tudo como em
-- aberto faria a tela de estreia acusar meses de calote que não existe.
UPDATE "viagens_pessoais"
SET "recebidoEm" = "data"
WHERE "valorRecebido" IS NOT NULL AND "valorRecebido" > 0;

CREATE INDEX "viagens_pessoais_identidadeId_recebidoEm_idx"
  ON "viagens_pessoais" ("identidadeId", "recebidoEm");
