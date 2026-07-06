-- AlterTable: opt-in do resumo diário do motorista no WhatsApp (default true).
ALTER TABLE "motoristas" ADD COLUMN "receberResumoDiario" BOOLEAN NOT NULL DEFAULT true;
