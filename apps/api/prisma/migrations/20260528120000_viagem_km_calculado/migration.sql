-- Snapshot do km calculado pelo OSRM no momento do lançamento da viagem.
-- Quando motorista sobrescreve o sugerido, comparamos com viagem.km pra
-- exibir os dois valores e registrar log na timeline.

ALTER TABLE "viagens" ADD COLUMN "kmCalculado" DECIMAL(10,2);
