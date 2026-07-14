-- AlterTable
ALTER TABLE "motoristas" ADD COLUMN "appPlatform" TEXT;

-- CreateTable
CREATE TABLE "configuracao_forca_atualizacao" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "modo" TEXT NOT NULL DEFAULT 'observar',
    "versaoMinimaIos" TEXT,
    "versaoMinimaAndroid" TEXT,
    "motoristasAlvo" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    "alteradoPorId" TEXT,

    CONSTRAINT "configuracao_forca_atualizacao_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "configuracao_forca_atualizacao" ADD CONSTRAINT "configuracao_forca_atualizacao_alteradoPorId_fkey" FOREIGN KEY ("alteradoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
