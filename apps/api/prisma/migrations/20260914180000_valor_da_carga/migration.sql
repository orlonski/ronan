-- O CT-e exige o valor da carga no modal rodoviário (rejeição 581), e o sistema
-- não tinha onde guardar isso: a TabelaPreco é o preço do FRETE, não da
-- mercadoria.
--
-- Dois níveis, porque são duas verdades diferentes:
--   materiais.valorReferenciaTonelada — a referência do contador, por material
--   viagens.valorCarga                — o valor REAL, quando se sabe (NF-e)
-- A viagem vence a referência: aproximação não passa por cima de número sabido.
ALTER TABLE "materiais" ADD COLUMN "valorReferenciaTonelada" DECIMAL(12,2);
ALTER TABLE "viagens" ADD COLUMN "valorCarga" DECIMAL(12,2);
