-- Ticket repetido deixa de TRAVAR e passa a SINALIZAR.
--
-- Antes: 409 no lançamento -> erro permanente -> o item morria na tela de
-- Pendentes do motorista até ele editar o número, no meio da estrada.
-- Agora: a viagem entra carimbada com a anterior de mesmo número, o painel
-- mostra e quem confere decide (aceita a duplicidade ou reprova a viagem).
--
-- Não há constraint única de ticket no banco (só o índice composto
-- [veiculoId, data, ticket], não-único), então a duplicata sempre coube aqui —
-- a trava era regra de aplicação.

-- AlterEnum
ALTER TYPE "TipoDivergencia" ADD VALUE IF NOT EXISTS 'TICKET_DUPLICADO';

-- AlterTable: auto-relação apontando pra viagem anterior de mesmo ticket,
-- e o carimbo de "conferi e está certo" (espelha kmAceitoEm).
ALTER TABLE "viagens"
  ADD COLUMN "ticketDuplicadoDeId" TEXT,
  ADD COLUMN "duplicidadeAceitaEm" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "viagens_ticketDuplicadoDeId_idx" ON "viagens"("ticketDuplicadoDeId");

-- AddForeignKey: SetNull porque, se a viagem anterior sumir, não há mais
-- duplicidade que sinalizar.
ALTER TABLE "viagens" ADD CONSTRAINT "viagens_ticketDuplicadoDeId_fkey" FOREIGN KEY ("ticketDuplicadoDeId") REFERENCES "viagens"("id") ON DELETE SET NULL ON UPDATE CASCADE;
