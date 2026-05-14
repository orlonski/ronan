-- Acrescenta 3 tipos de documento de motorista: comodato, laudo técnico
-- e plano de manutenção. ALTER TYPE ADD VALUE é idempotente com IF NOT
-- EXISTS, e cada um precisa ir num statement separado pra rodar fora de
-- transação (limitação do Postgres pra enums).

ALTER TYPE "TipoDocumentoMotorista" ADD VALUE IF NOT EXISTS 'COMODATO';
ALTER TYPE "TipoDocumentoMotorista" ADD VALUE IF NOT EXISTS 'LAUDO_TECNICO';
ALTER TYPE "TipoDocumentoMotorista" ADD VALUE IF NOT EXISTS 'PLANO_MANUTENCAO';
