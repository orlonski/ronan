-- Interruptor do Escritório de Agentes. Nasce desligado: ADD COLUMN com DEFAULT
-- constante não reescreve a tabela (PG11+), então é instantâneo.
ALTER TABLE "configuracao_plataforma" ADD COLUMN IF NOT EXISTS "escritorioAtivo" BOOLEAN NOT NULL DEFAULT false;
