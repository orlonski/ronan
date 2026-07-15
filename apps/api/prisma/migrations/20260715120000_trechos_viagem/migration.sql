-- CreateEnum
CREATE TYPE "TipoTrecho" AS ENUM ('RETORNO_BOTA_FORA', 'ENTREGA');

-- CreateTable
CREATE TABLE "trechos_viagem" (
    "id" TEXT NOT NULL,
    "viagemId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "tipo" "TipoTrecho" NOT NULL,
    "localId" TEXT NOT NULL,
    "km" DECIMAL(10,2) NOT NULL,
    "toneladas" DECIMAL(10,3),
    "ticket" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trechos_viagem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trechos_viagem_viagemId_ordem_idx" ON "trechos_viagem"("viagemId", "ordem");

-- AddForeignKey
ALTER TABLE "trechos_viagem" ADD CONSTRAINT "trechos_viagem_viagemId_fkey" FOREIGN KEY ("viagemId") REFERENCES "viagens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trechos_viagem" ADD CONSTRAINT "trechos_viagem_localId_fkey" FOREIGN KEY ("localId") REFERENCES "locais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Data migration: viagens com bota-fora viram 1 trecho RETORNO_BOTA_FORA (local de carga).
INSERT INTO "trechos_viagem" ("id", "viagemId", "ordem", "tipo", "localId", "km", "criadoEm")
SELECT gen_random_uuid()::text, v."id", 1, 'RETORNO_BOTA_FORA', v."localCargaId", COALESCE(v."kmBotaFora", 0), CURRENT_TIMESTAMP
FROM "viagens" v
WHERE v."teveBotaFora" = true AND v."localCargaId" IS NOT NULL;

-- DropColumn
ALTER TABLE "viagens" DROP COLUMN "teveBotaFora",
DROP COLUMN "kmBotaFora";
