-- O caderninho do motorista: o que ele gastou e recebeu, do bolso dele.
-- Sem contaId de propósito — é da PESSOA, e nenhuma empresa enxerga.
CREATE TYPE "TipoLancamentoPessoal" AS ENUM ('ABASTECIMENTO', 'PEDAGIO', 'MANUTENCAO', 'ALIMENTACAO', 'OUTRO_GASTO', 'GANHO');

CREATE TABLE "lancamentos_pessoais" (
    "id" TEXT NOT NULL,
    "identidadeId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tipo" "TipoLancamentoPessoal" NOT NULL,
    "data" DATE NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "litros" DECIMAL(8,2),
    "odometro" INTEGER,
    "descricao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lancamentos_pessoais_pkey" PRIMARY KEY ("id")
);

-- Idempotência do outbox: rede ruim reenvia o mesmo lançamento e ele não vira
-- dois. Por PESSOA, não global — colisão entre caderninhos diferentes não é
-- conflito, é coincidência sem consequência.
CREATE UNIQUE INDEX "lancamentos_pessoais_identidadeId_clientId_key" ON "lancamentos_pessoais"("identidadeId", "clientId");
CREATE INDEX "lancamentos_pessoais_identidadeId_data_idx" ON "lancamentos_pessoais"("identidadeId", "data");

ALTER TABLE "lancamentos_pessoais" ADD CONSTRAINT "lancamentos_pessoais_identidadeId_fkey"
    FOREIGN KEY ("identidadeId") REFERENCES "motorista_identidades"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
