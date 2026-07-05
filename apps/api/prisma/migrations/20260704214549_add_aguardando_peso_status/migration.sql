-- Novo status: viagem lançada sem peso/ticket (romaneio no fim do dia).
-- Fica fora de match/fechamento/KPIs até o motorista/admin completar o peso.
ALTER TYPE "StatusViagem" ADD VALUE IF NOT EXISTS 'AGUARDANDO_PESO';
