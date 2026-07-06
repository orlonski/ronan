-- AlterTable: captura do GPS/distância/raio ao escolher o local de carga no
-- "Iniciar viagem" (espelha os campos descarga*). Só ADD COLUMN, tudo nullable.
ALTER TABLE "viagens"
  ADD COLUMN "cargaLat" DOUBLE PRECISION,
  ADD COLUMN "cargaLng" DOUBLE PRECISION,
  ADD COLUMN "cargaPrecisao" DOUBLE PRECISION,
  ADD COLUMN "cargaFonte" "FonteGps",
  ADD COLUMN "cargaDistanciaMetros" INTEGER,
  ADD COLUMN "cargaRaioUsadoM" INTEGER,
  ADD COLUMN "cargaBuscaOffline" BOOLEAN;
