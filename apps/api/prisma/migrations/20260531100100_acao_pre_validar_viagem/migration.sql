-- Nova ação de auditoria: registrada quando admin marca viagem como
-- Validada ou Divergente pelo botão de pré-validação no detalhe da viagem.

ALTER TYPE "AcaoAuditoria" ADD VALUE 'PRE_VALIDAR_VIAGEM';
