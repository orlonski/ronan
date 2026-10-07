-- CreateTable
CREATE TABLE "chamadas_externas" (
    "id" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contaId" TEXT,
    "gatilho" TEXT,
    "servico" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "metodo" TEXT NOT NULL,
    "caminho" TEXT NOT NULL,
    "status" INTEGER,
    "ok" BOOLEAN NOT NULL,
    "duracaoMs" INTEGER NOT NULL,
    "bytesEnvio" INTEGER,
    "bytesResposta" INTEGER,
    "pedido" JSONB,
    "resposta" JSONB,
    "erro" TEXT,
    "iaModelo" TEXT,
    "iaTokensEntrada" INTEGER,
    "iaTokensSaida" INTEGER,

    CONSTRAINT "chamadas_externas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chamadas_externas_criadoEm_idx" ON "chamadas_externas"("criadoEm" DESC);

-- CreateIndex
CREATE INDEX "chamadas_externas_servico_criadoEm_idx" ON "chamadas_externas"("servico", "criadoEm" DESC);

-- CreateIndex
CREATE INDEX "chamadas_externas_contaId_criadoEm_idx" ON "chamadas_externas"("contaId", "criadoEm" DESC);

