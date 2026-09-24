-- V1 da manutenção (24/09/2026): o motorista confirma o conserto, e a OS
-- guarda anexos (nota da oficina, fotos do serviço).
ALTER TABLE "problemas_veiculo" ADD COLUMN IF NOT EXISTS "confirmacao" TEXT;
ALTER TABLE "problemas_veiculo" ADD COLUMN IF NOT EXISTS "confirmadoEm" TIMESTAMP(3);
ALTER TABLE "manutencoes_veiculo" ADD COLUMN IF NOT EXISTS "anexos" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- O telefone que o motorista vê no app pra ligar pro escritório.
ALTER TABLE "contas" ADD COLUMN IF NOT EXISTS "telefoneParaMotoristas" TEXT;
