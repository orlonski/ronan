-- Marca a viagem que a conferência AUTOMÁTICA aprovou.
--
-- A aprovação em si usa `revisadoEm` (com `revisadoPorId` nulo), que é o que
-- faz o FechamentoProcessor preservar a decisão em vez de sobrescrever o status
-- — mesmo comportamento de quando um humano confere, e é o desejado.
--
-- Esta coluna existe pela transparência: sem ela a viagem apareceria como
-- "revisada" e ninguém saberia por quem, o que é pior do que não aprovar. Com
-- ela, a tela diz que foi o sistema, dá pra auditar depois e dá pra desfazer em
-- lote se a calibragem se mostrar errada.
--
-- ESCRITA À MÃO pelo drift de `db push` nas FKs de `viagens` (ver migrations
-- 20260717120000 e 20260726210000).

-- AlterTable
ALTER TABLE "viagens" ADD COLUMN "conferidoPorIaEm" TIMESTAMP(3);

-- CreateIndex
-- Auditoria e desfazer em lote: "o que a IA aprovou desde tal dia".
CREATE INDEX "viagens_conferidoPorIaEm_idx" ON "viagens"("conferidoPorIaEm");
