-- Suporte a abastecimento em comboio: motorista informa litros mas pode não
-- saber o valor na hora. valorTotal vira nullable e ganha flag emComboio
-- pra distinguir "ainda não foi cobrado" de "esqueceu de preencher".

ALTER TABLE "abastecimentos" ALTER COLUMN "valorTotal" DROP NOT NULL;
ALTER TABLE "abastecimentos" ADD COLUMN "emComboio" BOOLEAN NOT NULL DEFAULT false;
