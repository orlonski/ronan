-- Conferência diária: regra de atividade. 0 = desligada (comportamento anterior).
ALTER TABLE "configuracao_conferencia_diaria" ADD COLUMN "janelaAtividadeDias" INTEGER NOT NULL DEFAULT 0;
