-- Chat liberado pra todo mundo depois de validado em campo.
--
-- Duas coisas, e as duas são necessárias: mudar o DEFAULT só afeta motorista
-- novo, então o UPDATE é o que liga a aba pra quem já está cadastrado. Sem ele
-- a feature continuaria invisível pra base inteira.
ALTER TABLE "motoristas" ALTER COLUMN "podeChat" SET DEFAULT true;

UPDATE "motoristas" SET "podeChat" = true WHERE "podeChat" = false;
