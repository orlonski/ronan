-- Adiciona novos valores aos enums existentes.
-- PostgreSQL exige que ALTER TYPE ADD VALUE seja COMMITADO antes
-- dos novos valores serem usados. Por isso essa migration so adiciona
-- valores; o uso (DEFAULT, etc) fica na migration seguinte.
--
-- Usamos IF NOT EXISTS pra ser idempotente: em prod uma tentativa
-- anterior de migration falhou parcialmente e alguns valores podem
-- ter persistido. ADD VALUE em Postgres 12+ nao e rolled-back.

-- AlterEnum (StatusViagem)
ALTER TYPE "StatusViagem" ADD VALUE IF NOT EXISTS 'AJUSTADA';

-- AlterEnum (StatusFechamento)
ALTER TYPE "StatusFechamento" ADD VALUE IF NOT EXISTS 'RECEBIDO';
ALTER TYPE "StatusFechamento" ADD VALUE IF NOT EXISTS 'EM_PROCESSAMENTO';
ALTER TYPE "StatusFechamento" ADD VALUE IF NOT EXISTS 'CONFERIDO';
ALTER TYPE "StatusFechamento" ADD VALUE IF NOT EXISTS 'EXPORTADO';
ALTER TYPE "StatusFechamento" ADD VALUE IF NOT EXISTS 'SUBSTITUIDO';

-- AlterEnum (StatusLinhaFechamento)
ALTER TYPE "StatusLinhaFechamento" ADD VALUE IF NOT EXISTS 'MATCH_IA';
ALTER TYPE "StatusLinhaFechamento" ADD VALUE IF NOT EXISTS 'RESOLVIDA_OPERADORA';

-- CreateEnum (StatusEnvio)
DO $$ BEGIN
  CREATE TYPE "StatusEnvio" AS ENUM ('GERADO', 'ENVIADO');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum (AcaoAuditoria)
DO $$ BEGIN
  CREATE TYPE "AcaoAuditoria" AS ENUM ('UPDATE', 'DELETE', 'RESOLVER', 'SUBSTITUIR', 'EXPORTAR', 'MARCAR_ENVIADO', 'MATCH_AUTOMATICO', 'MATCH_IA');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
