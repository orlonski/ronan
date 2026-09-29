-- Conferência diária: o painel liga/desliga por motorista, com registro de quem e quando.
-- Origem: 'MOTORISTA' (Parar perguntas no WhatsApp) ou 'PAINEL'. Nulo com o campo
-- em false = linha antiga, tratada como MOTORISTA (era o único caminho que desligava).

ALTER TYPE "AcaoAuditoria" ADD VALUE IF NOT EXISTS 'CONFERENCIA_MOTORISTA_DESLIGADA';
ALTER TYPE "AcaoAuditoria" ADD VALUE IF NOT EXISTS 'CONFERENCIA_MOTORISTA_RELIGADA';

-- AlterTable
ALTER TABLE "motoristas" ADD COLUMN     "conferenciaDesligadaEm" TIMESTAMP(3),
ADD COLUMN     "conferenciaDesligadaMotivo" TEXT,
ADD COLUMN     "conferenciaDesligadaOrigem" TEXT,
ADD COLUMN     "conferenciaDesligadaPorId" TEXT;

-- AddForeignKey
ALTER TABLE "motoristas" ADD CONSTRAINT "motoristas_conferenciaDesligadaPorId_fkey" FOREIGN KEY ("conferenciaDesligadaPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
