-- CreateEnum
CREATE TYPE "TipoCombustivel" AS ENUM ('DIESEL_S10', 'DIESEL_S500', 'ARLA_32', 'GASOLINA', 'ETANOL');

-- CreateTable
CREATE TABLE "abastecimentos" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "motoristaId" TEXT NOT NULL,
    "veiculoId" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "tipo" "TipoCombustivel" NOT NULL DEFAULT 'DIESEL_S10',
    "litros" DECIMAL(8,3) NOT NULL,
    "valorTotal" DECIMAL(10,2) NOT NULL,
    "precoLitro" DECIMAL(6,3),
    "odometro" INTEGER NOT NULL,
    "postoNome" TEXT,
    "tanqueCheio" BOOLEAN NOT NULL DEFAULT true,
    "observacao" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "precisao" DOUBLE PRECISION,
    "criadoOfflineEm" TIMESTAMP(3),
    "sincronizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "abastecimentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "abastecimento_fotos" (
    "id" TEXT NOT NULL,
    "abastecimentoId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "capturadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "abastecimento_fotos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "abastecimentos_clientId_key" ON "abastecimentos"("clientId");

-- CreateIndex
CREATE INDEX "abastecimentos_veiculoId_data_idx" ON "abastecimentos"("veiculoId", "data");

-- CreateIndex
CREATE INDEX "abastecimentos_motoristaId_data_idx" ON "abastecimentos"("motoristaId", "data");

-- CreateIndex
CREATE INDEX "abastecimentos_data_idx" ON "abastecimentos"("data");

-- CreateIndex
CREATE INDEX "abastecimento_fotos_abastecimentoId_idx" ON "abastecimento_fotos"("abastecimentoId");

-- AddForeignKey
ALTER TABLE "abastecimentos" ADD CONSTRAINT "abastecimentos_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abastecimentos" ADD CONSTRAINT "abastecimentos_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "veiculos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abastecimento_fotos" ADD CONSTRAINT "abastecimento_fotos_abastecimentoId_fkey" FOREIGN KEY ("abastecimentoId") REFERENCES "abastecimentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
