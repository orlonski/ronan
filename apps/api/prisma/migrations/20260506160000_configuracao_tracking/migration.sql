-- CreateTable
CREATE TABLE "configuracao_tracking" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "distanciaMinMetros" INTEGER NOT NULL DEFAULT 50,
    "intervaloMaxSegundos" INTEGER NOT NULL DEFAULT 30,
    "precisaoAlta" BOOLEAN NOT NULL DEFAULT false,
    "accuracyMaxMetros" INTEGER NOT NULL DEFAULT 100,
    "velocidadeMaxKmh" INTEGER NOT NULL DEFAULT 200,
    "autoFinalizarHoras" INTEGER NOT NULL DEFAULT 6,
    "detectorAtivado" BOOLEAN NOT NULL DEFAULT true,
    "detectorVelocidadeKmh" INTEGER NOT NULL DEFAULT 30,
    "detectorLeituras" INTEGER NOT NULL DEFAULT 3,
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    "alteradoPorId" TEXT,

    CONSTRAINT "configuracao_tracking_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "configuracao_tracking" ADD CONSTRAINT "configuracao_tracking_alteradoPorId_fkey" FOREIGN KEY ("alteradoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Cria a linha singleton com defaults
INSERT INTO "configuracao_tracking" ("id", "alteradoEm") VALUES ('default', CURRENT_TIMESTAMP);
