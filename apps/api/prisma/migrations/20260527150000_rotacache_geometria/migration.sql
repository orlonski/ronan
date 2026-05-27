-- Geometria do trajeto carga→descarga: polyline encoded retornado pelo OSRM
-- com overview=simplified. Frontend (dashboard/motorista-app) decodifica e
-- desenha a polilinha no mapa do detalhe da viagem. NULL pra rotas antigas:
-- frontend mostra reta tracejada como fallback até o cache expirar e re-rodar.

ALTER TABLE "rota_cache" ADD COLUMN "geometria" TEXT;
