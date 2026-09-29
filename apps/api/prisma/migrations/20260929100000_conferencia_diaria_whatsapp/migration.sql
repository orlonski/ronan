-- CreateEnum
CREATE TYPE "OpcaoConferenciaDiaria" AS ENUM ('NAO_TIVE', 'TIVE_NAO_LANCEI', 'SAI_DA_EMPRESA', 'PARAR', 'AMBIGUA');

-- CreateEnum
CREATE TYPE "TipoSugestaoGestor" AS ENUM ('INATIVAR_VINCULO', 'LANCAR_VIAGEM_FALTANTE', 'RESPOSTA_AMBIGUA', 'MOTORISTA_PAROU_WHATSAPP', 'WHATSAPP_INALCANCAVEL');

-- CreateEnum
CREATE TYPE "StatusSugestaoGestor" AS ENUM ('ABERTA', 'APROVADA', 'RECUSADA', 'RESOLVIDA_SOZINHA', 'EXPIRADA');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AcaoAuditoria" ADD VALUE 'CONFERENCIA_OPTOUT';
ALTER TYPE "AcaoAuditoria" ADD VALUE 'CONFERENCIA_SUGESTAO_DECIDIDA';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EstadoConferenciaDiaria" ADD VALUE 'PENDENTE';
ALTER TYPE "EstadoConferenciaDiaria" ADD VALUE 'ENVIADA';
ALTER TYPE "EstadoConferenciaDiaria" ADD VALUE 'RESPONDIDA';
ALTER TYPE "EstadoConferenciaDiaria" ADD VALUE 'EXPIRADA';
ALTER TYPE "EstadoConferenciaDiaria" ADD VALUE 'FALHOU';

-- AlterTable
ALTER TABLE "conferencia_diaria" ADD COLUMN     "enviadaEm" TIMESTAMP(3),
ADD COLUMN     "erroEnvio" TEXT,
ADD COLUMN     "lembreteEnviadoEm" TIMESTAMP(3),
ADD COLUMN     "lembreteWamid" TEXT,
ADD COLUMN     "opcao" "OpcaoConferenciaDiaria",
ADD COLUMN     "respondidaEm" TIMESTAMP(3),
ADD COLUMN     "respostaTexto" TEXT,
ADD COLUMN     "suprimidaPor" TEXT,
ADD COLUMN     "wamid" TEXT;

-- AlterTable
ALTER TABLE "configuracao_conferencia_diaria" ADD COLUMN     "contatoEmpresa" TEXT,
ADD COLUMN     "diasParaSuspeitar" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "horasParaExpirar" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "horasParaLembrar" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "mensagemAoParar" TEXT,
ADD COLUMN     "mensagensParaSuspeitar" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "reenviar" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "suprimirResumoQuemRecebeuPergunta" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "configuracao_plataforma" ADD COLUMN     "maxConferenciasPorHora" INTEGER NOT NULL DEFAULT 60;

-- AlterTable
ALTER TABLE "motoristas" ADD COLUMN     "whatsappFalhasSeguidas" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "whatsappInalcancavelEm" TIMESTAMP(3),
ADD COLUMN     "whatsappReverificadoEm" TIMESTAMP(3),
ADD COLUMN     "whatsappSemEntregaDesde" TIMESTAMP(3),
ADD COLUMN     "whatsappUltimaEntregaEm" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "sugestoes_gestor" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "tipo" "TipoSugestaoGestor" NOT NULL,
    "status" "StatusSugestaoGestor" NOT NULL DEFAULT 'ABERTA',
    "motoristaId" TEXT,
    "conferenciaId" TEXT,
    "resumo" TEXT NOT NULL,
    "evidencia" JSONB NOT NULL,
    "chaveViva" TEXT,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decididaEm" TIMESTAMP(3),
    "decididaPorId" TEXT,
    "motivoDecisao" TEXT,

    CONSTRAINT "sugestoes_gestor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sugestoes_gestor_contaId_status_idx" ON "sugestoes_gestor"("contaId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sugestoes_gestor_contaId_chaveViva_key" ON "sugestoes_gestor"("contaId", "chaveViva");

-- CreateIndex
CREATE INDEX "conferencia_diaria_contaId_estado_idx" ON "conferencia_diaria"("contaId", "estado");

-- AddForeignKey
ALTER TABLE "sugestoes_gestor" ADD CONSTRAINT "sugestoes_gestor_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sugestoes_gestor" ADD CONSTRAINT "sugestoes_gestor_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
