-- Adiciona novos valores aos enums existentes.
-- PostgreSQL exige que ALTER TYPE ADD VALUE seja COMMITADO antes
-- dos novos valores serem usados. Por isso essa migration so adiciona
-- valores; o uso (DEFAULT, etc) fica na migration seguinte.

-- AlterEnum (StatusViagem)
ALTER TYPE "StatusViagem" ADD VALUE 'AJUSTADA';

-- AlterEnum (StatusFechamento)
ALTER TYPE "StatusFechamento" ADD VALUE 'RECEBIDO';
ALTER TYPE "StatusFechamento" ADD VALUE 'EM_PROCESSAMENTO';
ALTER TYPE "StatusFechamento" ADD VALUE 'CONFERIDO';
ALTER TYPE "StatusFechamento" ADD VALUE 'EXPORTADO';
ALTER TYPE "StatusFechamento" ADD VALUE 'SUBSTITUIDO';

-- AlterEnum (StatusLinhaFechamento)
ALTER TYPE "StatusLinhaFechamento" ADD VALUE 'MATCH_IA';
ALTER TYPE "StatusLinhaFechamento" ADD VALUE 'RESOLVIDA_OPERADORA';

-- CreateEnum (StatusEnvio)
CREATE TYPE "StatusEnvio" AS ENUM ('GERADO', 'ENVIADO');

-- CreateEnum (AcaoAuditoria)
CREATE TYPE "AcaoAuditoria" AS ENUM ('UPDATE', 'DELETE', 'RESOLVER', 'SUBSTITUIR', 'EXPORTAR', 'MARCAR_ENVIADO', 'MATCH_AUTOMATICO', 'MATCH_IA');
