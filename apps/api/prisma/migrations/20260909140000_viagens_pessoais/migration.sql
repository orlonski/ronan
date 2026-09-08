-- A viagem que o motorista faz por conta própria.
-- Não é a Viagem da transportadora: aquela vive dentro de uma conta e se apoia
-- no catálogo dela. Aqui não há empresa, então o que lá é FK vira texto livre.
CREATE TABLE "viagens_pessoais" (
    "id" TEXT NOT NULL,
    "identidadeId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "origem" TEXT NOT NULL,
    "destino" TEXT NOT NULL,
    "carga" TEXT,
    "km" DECIMAL(10,2),
    "peso" DECIMAL(10,3),
    "valorRecebido" DECIMAL(12,2),
    "observacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "viagens_pessoais_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "viagens_pessoais_identidadeId_clientId_key" ON "viagens_pessoais"("identidadeId", "clientId");
CREATE INDEX "viagens_pessoais_identidadeId_data_idx" ON "viagens_pessoais"("identidadeId", "data");

ALTER TABLE "viagens_pessoais" ADD CONSTRAINT "viagens_pessoais_identidadeId_fkey"
    FOREIGN KEY ("identidadeId") REFERENCES "motorista_identidades"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- O gasto pode pertencer a uma viagem dele (o diesel daquele trecho). Opcional:
-- a maioria dos gastos do dia não é de viagem nenhuma.
ALTER TABLE "lancamentos_pessoais" ADD COLUMN "viagemPessoalId" TEXT;
ALTER TABLE "lancamentos_pessoais" ADD CONSTRAINT "lancamentos_pessoais_viagemPessoalId_fkey"
    FOREIGN KEY ("viagemPessoalId") REFERENCES "viagens_pessoais"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
