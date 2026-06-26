-- CreateEnum
CREATE TYPE "OrigemCadastroLocal" AS ENUM ('MOTORISTA_FORMULARIO', 'MOTORISTA_RAPIDO', 'VIAGEM_OFFLINE', 'ADMIN_MANUAL', 'ADMIN_AUDITORIA');

-- AlterTable
ALTER TABLE "locais" ADD COLUMN "origemCadastro" "OrigemCadastroLocal";
