-- AlterTable
-- Nasce desligado: o registro singleton existente também recebe ativo=false.
ALTER TABLE "configuracao_agente" ADD COLUMN     "ativo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mensagemInativo" TEXT;
