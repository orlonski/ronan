-- Motivo de divergência por campo do ticket, com a lista de campos apontados.
ALTER TYPE "TipoDivergencia" ADD VALUE 'DADOS_DIVERGENTES' BEFORE 'OUTRO';
ALTER TABLE "viagens" ADD COLUMN "camposDivergentes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
