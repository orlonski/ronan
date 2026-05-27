-- Nova ação de auditoria: registro do botão "Recalcular trajeto" no detalhe
-- da viagem (admin força re-cálculo OSRM e atualização do RotaCache).

ALTER TYPE "AcaoAuditoria" ADD VALUE 'RECALCULAR_TRAJETO';
