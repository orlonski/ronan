-- Sobretaxa de combustível na fatura do cliente pagador.
-- A regra nasce DESLIGADA: nenhuma fatura muda de valor porque esta migration subiu.
CREATE TABLE "regras_sobretaxa_combustivel" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "dieselReferencia" DECIMAL(6,3) NOT NULL,
    "gatilho" DECIMAL(6,3) NOT NULL,
    "percentualPorPasso" DECIMAL(6,3) NOT NULL,
    "tetoPercentual" DECIMAL(6,3),
    "vigenciaDe" DATE NOT NULL,
    "vigenciaAte" DATE,
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "regras_sobretaxa_combustivel_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "regras_sobretaxa_combustivel_empresaId_ativo_idx" ON "regras_sobretaxa_combustivel"("empresaId", "ativo");
CREATE INDEX "regras_sobretaxa_combustivel_contaId_idx" ON "regras_sobretaxa_combustivel"("contaId");

ALTER TABLE "regras_sobretaxa_combustivel" ADD CONSTRAINT "regras_sobretaxa_combustivel_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "regras_sobretaxa_combustivel" ADD CONSTRAINT "regras_sobretaxa_combustivel_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Os números da conta, congelados na linha da fatura.
ALTER TABLE "fatura_linhas" ADD COLUMN "sobretaxa" JSONB;
