-- Conferência diária: três regras que estavam fixas no código passam a ser da empresa.
-- Os DEFAULTs são os valores de antes (3h, 7h-21h, 5): nenhuma empresa muda de comportamento sem escolher.
ALTER TABLE "configuracao_conferencia_diaria" ADD COLUMN "horasToleranciaEnvio" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "configuracao_conferencia_diaria" ADD COLUMN "lembreteHoraMin" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "configuracao_conferencia_diaria" ADD COLUMN "lembreteHoraMax" INTEGER NOT NULL DEFAULT 21;
ALTER TABLE "configuracao_conferencia_diaria" ADD COLUMN "maxReenviosPorPergunta" INTEGER NOT NULL DEFAULT 5;
