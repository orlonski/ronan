-- CreateTable
CREATE TABLE "geocoding_cache" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "resposta" JSONB NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 1,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoHit" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geocoding_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "geocoding_cache_query_key" ON "geocoding_cache"("query");

-- CreateIndex
CREATE INDEX "geocoding_cache_query_idx" ON "geocoding_cache"("query");

