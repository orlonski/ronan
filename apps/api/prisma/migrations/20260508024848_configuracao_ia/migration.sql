-- CreateTable
CREATE TABLE "configuracao_ia" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "confidenceMinimo" DOUBLE PRECISION NOT NULL DEFAULT 0.85,
    "janelaDias" INTEGER NOT NULL DEFAULT 3,
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    "alteradoPorId" TEXT,

    CONSTRAINT "configuracao_ia_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "configuracao_ia" ADD CONSTRAINT "configuracao_ia_alteradoPorId_fkey" FOREIGN KEY ("alteradoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
