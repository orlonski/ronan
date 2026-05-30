-- Estende enum de tipo de divergencia + nova acao na auditoria pra
-- rastrear quando motorista responde a alerta de foto ilegivel.
ALTER TYPE "TipoDivergencia" ADD VALUE 'FOTO_ILEGIVEL';
ALTER TYPE "AcaoAuditoria" ADD VALUE 'MOTORISTA_SUBSTITUIU_FOTO';
