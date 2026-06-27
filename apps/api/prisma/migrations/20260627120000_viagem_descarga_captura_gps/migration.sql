-- AlterTable
ALTER TABLE "viagens" ADD COLUMN "descargaLat" DOUBLE PRECISION;
ALTER TABLE "viagens" ADD COLUMN "descargaLng" DOUBLE PRECISION;
ALTER TABLE "viagens" ADD COLUMN "descargaPrecisao" DOUBLE PRECISION;
ALTER TABLE "viagens" ADD COLUMN "descargaDistanciaMetros" INTEGER;
