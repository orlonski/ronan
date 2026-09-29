-- CreateEnum
CREATE TYPE "LembreteAppParaQuem" AS ENUM ('SO_QUEM_SAIU', 'TODOS_QUE_ATRASARAM');

-- AlterTable
ALTER TABLE "configuracao_conferencia_diaria"
  ADD COLUMN "lembreteNoApp" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lembreteParaQuem" "LembreteAppParaQuem" NOT NULL DEFAULT 'SO_QUEM_SAIU',
  ADD COLUMN "diasParaLembreteNoApp" INTEGER NOT NULL DEFAULT 3;
