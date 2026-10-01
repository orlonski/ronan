-- Conferência diária: proteção do número comercial compartilhado contra telefone digitado errado.
-- Opção por empresa (nasce DESLIGADA = comportamento de sempre), confirmação do escritório por
-- motorista e o "número errado" respondido pelo WhatsApp.

ALTER TYPE "AcaoAuditoria" ADD VALUE IF NOT EXISTS 'CONFERENCIA_TELEFONE_CONFIRMADO';
ALTER TYPE "AcaoAuditoria" ADD VALUE IF NOT EXISTS 'CONFERENCIA_NUMERO_ERRADO';
ALTER TYPE "TipoSugestaoGestor" ADD VALUE IF NOT EXISTS 'NUMERO_ERRADO';

-- AlterTable
ALTER TABLE "configuracao_conferencia_diaria" ADD COLUMN "soPerguntarNumeroConfirmado" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "motoristas" ADD COLUMN "telefoneConfirmadoEm" TIMESTAMP(3),
ADD COLUMN "telefoneConfirmadoPorId" TEXT,
ADD COLUMN "telefoneErradoEm" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "motoristas" ADD CONSTRAINT "motoristas_telefoneConfirmadoPorId_fkey" FOREIGN KEY ("telefoneConfirmadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
