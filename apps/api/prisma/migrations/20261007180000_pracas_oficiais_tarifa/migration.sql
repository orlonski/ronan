-- AlterTable
ALTER TABLE "pedagios_rodovia" ADD COLUMN     "valorBaseEm" TIMESTAMP(3),
ADD COLUMN     "valorBaseFonte" TEXT;

-- CreateTable
CREATE TABLE "pracas_oficiais" (
    "id" TEXT NOT NULL,
    "fonte" TEXT NOT NULL,
    "concessionaria" TEXT NOT NULL,
    "praca" TEXT NOT NULL,
    "rodovia" TEXT NOT NULL,
    "uf" TEXT NOT NULL,
    "km" DOUBLE PRECISION NOT NULL,
    "municipio" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "sincronizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pracas_oficiais_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pracas_oficiais_fonte_rodovia_uf_idx" ON "pracas_oficiais"("fonte", "rodovia", "uf");

