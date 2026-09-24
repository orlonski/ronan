-- Duplicatas geográficas (self-join por faixa de lat/lng) e "local mais próximo"
-- filtram por latitude dentro da conta. Sem índice, o self-join comparava cada
-- local com todos os outros: ~930ms com 3.600 locais no teste; com ele, ~26ms.
CREATE INDEX IF NOT EXISTS "locais_contaId_lat_idx" ON "locais"("contaId", "lat");
