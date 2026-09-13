-- AlterTable
ALTER TABLE "posts_instagram" ADD COLUMN     "alcance" INTEGER,
ADD COLUMN     "comentarios" INTEGER,
ADD COLUMN     "compartilhamentos" INTEGER,
ADD COLUMN     "curtidas" INTEGER,
ADD COLUMN     "metricasEm" TIMESTAMP(3),
ADD COLUMN     "salvos" INTEGER,
ADD COLUMN     "visualizacoes" INTEGER;

-- CreateTable
CREATE TABLE "seguidores_instagram" (
    "id" TEXT NOT NULL,
    "dia" DATE NOT NULL,
    "total" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seguidores_instagram_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "seguidores_instagram_dia_key" ON "seguidores_instagram"("dia");
