-- CreateTable
CREATE TABLE "rota_cache" (
    "id" TEXT NOT NULL,
    "localOrigemId" TEXT NOT NULL,
    "localDestinoId" TEXT NOT NULL,
    "km" DECIMAL(10,2) NOT NULL,
    "duracaoSegundos" INTEGER NOT NULL,
    "calculadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rota_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rota_cache_localOrigemId_localDestinoId_key" ON "rota_cache"("localOrigemId", "localDestinoId");

-- AddForeignKey
ALTER TABLE "rota_cache" ADD CONSTRAINT "rota_cache_localOrigemId_fkey" FOREIGN KEY ("localOrigemId") REFERENCES "locais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rota_cache" ADD CONSTRAINT "rota_cache_localDestinoId_fkey" FOREIGN KEY ("localDestinoId") REFERENCES "locais"("id") ON DELETE CASCADE ON UPDATE CASCADE;
