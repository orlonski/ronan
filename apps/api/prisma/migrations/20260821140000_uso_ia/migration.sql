-- Medição de custo das chamadas de IA.
--
-- Até aqui o `usage` que a Anthropic devolve em toda resposta era simplesmente
-- descartado, e a consequência é que ninguém no sistema consegue responder
-- "quanto o OCR de ticket custou este mês" — a tela de configuração de IA
-- chegava a mostrar "~R$ 0,01 por match", número escrito à mão no frontend.
--
-- `custoUsd` é DECIMAL(12,6) e não (10,4) de propósito: uma chamada de Haiku
-- custa na casa de US$ 0,0004 e arredondaria pra ZERO em 4 casas — a medição
-- morreria calada, que é o problema que esta tabela existe pra resolver.
--
-- ESCRITA À MÃO: o banco de dev tem drift antigo de `db push` nas FKs de
-- `viagens` (mesma observação das migrations 20260717120000 e
-- 20260726210000). Um `migrate dev` arrastaria esse drift pra cá e pediria
-- reset do banco; esta migration contém APENAS a feature.

-- CreateTable
CREATE TABLE "usos_ia" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "escopo" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "tokensEntrada" INTEGER NOT NULL DEFAULT 0,
    "tokensSaida" INTEGER NOT NULL DEFAULT 0,
    "tokensCacheLeitura" INTEGER NOT NULL DEFAULT 0,
    "tokensCacheEscrita" INTEGER NOT NULL DEFAULT 0,
    "custoUsd" DECIMAL(12,6),
    "duracaoMs" INTEGER,
    "sucesso" BOOLEAN NOT NULL DEFAULT true,
    "erro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usos_ia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Custo por conta num período: é a query do painel.
CREATE INDEX "usos_ia_contaId_criadoEm_idx" ON "usos_ia"("contaId", "criadoEm" DESC);

-- CreateIndex
-- "quanto o OCR do app custou vs o conferente" — atravessa contas, é da plataforma.
CREATE INDEX "usos_ia_escopo_criadoEm_idx" ON "usos_ia"("escopo", "criadoEm" DESC);

-- AddForeignKey
ALTER TABLE "usos_ia" ADD CONSTRAINT "usos_ia_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
