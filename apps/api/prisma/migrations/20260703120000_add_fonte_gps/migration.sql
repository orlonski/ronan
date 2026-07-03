-- Fonte do sinal de GPS (PRECISA/BALANCED/CACHE) no momento da captura.
-- Complementa a precisão (já existente) pra auditar a qualidade do GPS:
-- CACHE = caiu no last-known do sistema (posição pode estar defasada).
-- Aditivo e não-destrutivo: enum novo + colunas nullable, sem default, sem backfill.
CREATE TYPE "FonteGps" AS ENUM ('PRECISA', 'BALANCED', 'CACHE');

ALTER TABLE "viagens" ADD COLUMN "descargaFonte" "FonteGps";

ALTER TABLE "locais" ADD COLUMN "latLngFonte" "FonteGps";
