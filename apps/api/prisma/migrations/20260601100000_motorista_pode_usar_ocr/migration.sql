-- Feature flag por motorista: liga/desliga o OCR via IA da foto do ticket
-- no app. Default true. Admin desliga seletivamente em /motoristas/:id.

ALTER TABLE "motoristas" ADD COLUMN "podeUsarOcrTicket" BOOLEAN NOT NULL DEFAULT true;
