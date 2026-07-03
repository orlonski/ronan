-- Reprocessamento automático de km pra viagem criada sem sinal (km estimado por
-- haversine → recalculado pelo trajeto real OSRM quando sincroniza).
-- Aditivo e não-destrutivo: colunas nullable, sem default, sem backfill.
--   kmEditadoManual  = motorista digitou o km na mão (reprocesso respeita)
--   kmRecalculadoEm  = quando o servidor recalculou (trava re-processo/re-aviso)
--   kmAntesRecalculo = km anterior, pra mostrar "de X → Y" pro motorista
ALTER TABLE "viagens" ADD COLUMN "kmEditadoManual" BOOLEAN;

ALTER TABLE "viagens" ADD COLUMN "kmRecalculadoEm" TIMESTAMP(3);

ALTER TABLE "viagens" ADD COLUMN "kmAntesRecalculo" DECIMAL(10,2);
