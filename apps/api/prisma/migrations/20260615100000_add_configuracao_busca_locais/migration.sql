-- CreateTable
CREATE TABLE "configuracao_busca_locais" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "raioInicialM" INTEGER NOT NULL DEFAULT 50,
    "raioAmpliadoM" INTEGER NOT NULL DEFAULT 500,
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    "alteradoPorId" TEXT,

    CONSTRAINT "configuracao_busca_locais_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "configuracao_busca_locais" ADD CONSTRAINT "configuracao_busca_locais_alteradoPorId_fkey" FOREIGN KEY ("alteradoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

