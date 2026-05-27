-- Nova ação de auditoria: gravada no create da viagem quando motorista
-- sobrescreveu o km calculado pelo OSRM (Viagem.km != Viagem.kmCalculado).

ALTER TYPE "AcaoAuditoria" ADD VALUE 'MOTORISTA_AJUSTOU_KM';
