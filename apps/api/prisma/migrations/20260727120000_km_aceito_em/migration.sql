-- "Aceitar km" (km atípico) parava de ser distinguível de "pré-validar a
-- viagem": os dois fluxos gravavam no mesmo campo `revisadoEm`, então aceitar
-- um km atípico fazia o card de Pré-validação do painel (e o
-- FechamentoProcessor) tratar a viagem como já revisada/divergente sem que
-- ninguém tivesse pré-validado nada. `kmAceitoEm` dá ao km atípico seu próprio
-- carimbo, independente de `revisadoEm`.

-- AlterTable
ALTER TABLE "viagens" ADD COLUMN     "kmAceitoEm" TIMESTAMP(3);
