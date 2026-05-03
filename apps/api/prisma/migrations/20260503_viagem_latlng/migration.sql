-- Add GPS coordinates to viagem (captured by mobile app on save)
ALTER TABLE "viagens" ADD COLUMN "lat" DOUBLE PRECISION;
ALTER TABLE "viagens" ADD COLUMN "lng" DOUBLE PRECISION;
