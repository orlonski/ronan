-- Rota escolhida pelo motorista no seletor de mapa (polyline encoded).
-- Aditivo e não-destrutivo: coluna nullable, sem default, sem backfill.
ALTER TABLE "viagens" ADD COLUMN "rotaGeometria" TEXT;
