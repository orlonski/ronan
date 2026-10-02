-- Revisão vencida abre OS sozinha (opção da empresa, desligada por padrão).
ALTER TABLE "contas" ADD COLUMN "abreOsPreventiva" BOOLEAN NOT NULL DEFAULT false;
