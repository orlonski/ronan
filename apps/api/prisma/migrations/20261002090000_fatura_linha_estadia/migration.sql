-- Linha de fatura que cobra ESTADIA aponta a parada (fila, espera) que ela
-- cobra — é o que impede a mesma estadia de entrar em duas faturas.
ALTER TABLE "fatura_linhas" ADD COLUMN "eventoViagemId" TEXT;
CREATE INDEX "fatura_linhas_eventoViagemId_idx" ON "fatura_linhas"("eventoViagemId");
ALTER TABLE "fatura_linhas" ADD CONSTRAINT "fatura_linhas_eventoViagemId_fkey" FOREIGN KEY ("eventoViagemId") REFERENCES "eventos_viagem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
