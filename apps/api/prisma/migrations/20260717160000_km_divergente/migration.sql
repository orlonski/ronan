-- Novo tipo de divergência KM_DIVERGENTE (admin marca; motorista corrige o km
-- e/ou justifica, a justificativa vai pra observação) + ação de auditoria pra
-- rastrear a resposta do motorista. Molde de 20260613100000_tipo_divergencia_foto.
ALTER TYPE "TipoDivergencia" ADD VALUE 'KM_DIVERGENTE';
ALTER TYPE "AcaoAuditoria" ADD VALUE 'MOTORISTA_JUSTIFICOU_KM';
