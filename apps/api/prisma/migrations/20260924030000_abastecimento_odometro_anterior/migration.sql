-- Odômetro menor que o anterior deixa de ser recusado (24/09/2026): entra e
-- fica carimbado com o anterior pro escritório conferir.
ALTER TABLE "abastecimentos" ADD COLUMN IF NOT EXISTS "odometroAnterior" INTEGER;
