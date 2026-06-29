-- AlterTable
ALTER TABLE "users" ADD COLUMN "resumoAssuntos" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill: usuários existentes que já recebiam recebem TODOS os assuntos
-- (preserva o comportamento atual; não re-aplica em boots futuros).
UPDATE "users" SET "resumoAssuntos" = ARRAY[
  'motoristas','locais','viagens','producao','abastecimentos',
  'custos','pendencias','conferencia','saude','ranking'
];
