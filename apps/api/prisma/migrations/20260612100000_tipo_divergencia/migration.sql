-- CreateEnum
CREATE TYPE "TipoDivergencia" AS ENUM ('PEDAGIO_SEM_VALOR', 'OUTRO');

-- AlterTable
ALTER TABLE "viagens" ADD COLUMN "tipoDivergencia" "TipoDivergencia";

-- AlterEnum: nova ação na auditoria pra rastrear quando motorista responde
-- ao alerta de pedágio sem valor.
ALTER TYPE "AcaoAuditoria" ADD VALUE 'MOTORISTA_INFORMOU_PEDAGIO';
