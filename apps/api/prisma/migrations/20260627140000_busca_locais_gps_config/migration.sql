-- AlterTable
ALTER TABLE "configuracao_busca_locais" ADD COLUMN "gpsAlvoMetros" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "configuracao_busca_locais" ADD COLUMN "gpsMaxSegundos" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "configuracao_busca_locais" ADD COLUMN "gpsLimiteSinalFracoM" INTEGER NOT NULL DEFAULT 50;
