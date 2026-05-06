-- AlterTable
ALTER TABLE "viagens"
    ADD COLUMN "iniciadoEm" TIMESTAMP(3),
    ADD COLUMN "kmReal" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "viagem_pontos" (
    "id" TEXT NOT NULL,
    "viagemId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "capturadoEm" TIMESTAMP(3) NOT NULL,
    "velocidade" DOUBLE PRECISION,
    "precisao" DOUBLE PRECISION,

    CONSTRAINT "viagem_pontos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "viagem_pontos_viagemId_capturadoEm_idx" ON "viagem_pontos"("viagemId", "capturadoEm");

-- AddForeignKey
ALTER TABLE "viagem_pontos" ADD CONSTRAINT "viagem_pontos_viagemId_fkey" FOREIGN KEY ("viagemId") REFERENCES "viagens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
