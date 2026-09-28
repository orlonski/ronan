-- CreateEnum
CREATE TYPE "RegraConferenciaDiaria" AS ENUM ('SEM_VIAGEM_NO_DIA_ANTERIOR', 'SEM_VIAGEM_HA_N_DIAS');

-- CreateEnum
CREATE TYPE "ModoConferenciaDiaria" AS ENUM ('SOMBRA', 'ENVIANDO');

-- CreateEnum
CREATE TYPE "QuemEntraConferenciaDiaria" AS ENUM ('TODOS_APROVADOS', 'SO_MODALIDADES');

-- CreateEnum
CREATE TYPE "EstadoConferenciaDiaria" AS ENUM ('SOMBRA', 'SUPRIMIDA');

-- AlterEnum
ALTER TYPE "AcaoAuditoria" ADD VALUE 'CONFERENCIA_CONFIG_ALTERADA';

-- AlterTable
ALTER TABLE "motoristas" ADD COLUMN     "receberConferenciaDiaria" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "configuracao_conferencia_diaria" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "modo" "ModoConferenciaDiaria" NOT NULL DEFAULT 'SOMBRA',
    "horaEnvio" INTEGER NOT NULL DEFAULT 8,
    "diasDoJob" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "regra" "RegraConferenciaDiaria" NOT NULL DEFAULT 'SEM_VIAGEM_NO_DIA_ANTERIOR',
    "diasSemViagem" INTEGER NOT NULL DEFAULT 2,
    "diasConsiderados" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "ignorarFeriados" BOOLEAN NOT NULL DEFAULT true,
    "incluirQueNuncaLancou" BOOLEAN NOT NULL DEFAULT true,
    "intervaloMinimoDias" INTEGER NOT NULL DEFAULT 3,
    "maxPerguntasPorSemana" INTEGER NOT NULL DEFAULT 3,
    "quemEntra" "QuemEntraConferenciaDiaria" NOT NULL DEFAULT 'TODOS_APROVADOS',
    "modalidadeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "transportadoraIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    "alteradoPorId" TEXT,

    CONSTRAINT "configuracao_conferencia_diaria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conferencia_diaria" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "motoristaId" TEXT NOT NULL,
    "dia" DATE NOT NULL,
    "estado" "EstadoConferenciaDiaria" NOT NULL,
    "motivo" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conferencia_diaria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "configuracao_conferencia_diaria_contaId_key" ON "configuracao_conferencia_diaria"("contaId");

-- CreateIndex
CREATE INDEX "conferencia_diaria_contaId_dia_idx" ON "conferencia_diaria"("contaId", "dia");

-- CreateIndex
CREATE UNIQUE INDEX "conferencia_diaria_contaId_motoristaId_dia_key" ON "conferencia_diaria"("contaId", "motoristaId", "dia");

-- AddForeignKey
ALTER TABLE "configuracao_conferencia_diaria" ADD CONSTRAINT "configuracao_conferencia_diaria_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracao_conferencia_diaria" ADD CONSTRAINT "configuracao_conferencia_diaria_alteradoPorId_fkey" FOREIGN KEY ("alteradoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conferencia_diaria" ADD CONSTRAINT "conferencia_diaria_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conferencia_diaria" ADD CONSTRAINT "conferencia_diaria_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

