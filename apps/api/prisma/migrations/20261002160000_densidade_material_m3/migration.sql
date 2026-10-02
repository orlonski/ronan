-- Conversão tonelada <-> m³ pela densidade do material.
--
-- Os valores novos de enum só são CRIADOS aqui; nenhum comando desta migration
-- os usa (um valor adicionado por ADD VALUE não pode ser usado na mesma
-- transação em que nasce).
ALTER TYPE "UnidadePedido" ADD VALUE IF NOT EXISTS 'M3';
ALTER TYPE "BasePreco" ADD VALUE IF NOT EXISTS 'M3';

-- Densidade a granel do material, em t/m³. Null = não informada: a conversão
-- recusa em vez de chutar. A faixa espelha a validação do painel (shared-types)
-- e barra o "1450" digitado em kg/m³, que dividiria o volume por mil.
ALTER TABLE "materiais" ADD COLUMN "densidadeTonM3" DECIMAL(6,3);
ALTER TABLE "materiais" ADD CONSTRAINT "materiais_densidadeTonM3_faixa"
  CHECK ("densidadeTonM3" IS NULL OR ("densidadeTonM3" >= 0.3 AND "densidadeTonM3" <= 3.5));

-- Valor congelado da viagem na base M3: guarda a densidade usada e as toneladas
-- convertidas, pra que corrigir a densidade depois não mexa em valor calculado.
ALTER TABLE "viagem_valores" ADD COLUMN "densidadeTonM3" DECIMAL(6,3);
ALTER TABLE "viagem_valores" ADD COLUMN "toneladasConvertidas" DECIMAL(12,3);
