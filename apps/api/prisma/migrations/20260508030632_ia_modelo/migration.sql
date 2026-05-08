-- AlterTable: adiciona campo modelo na ConfiguracaoIa
ALTER TABLE "configuracao_ia" ADD COLUMN "modelo" TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001';
