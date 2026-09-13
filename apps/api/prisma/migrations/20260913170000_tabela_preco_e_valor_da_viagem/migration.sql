-- Tabela de preço de frete e o valor congelado da viagem.
--
-- Até aqui o sistema media km e tonelada com rigor e não sabia quanto a viagem
-- valia: o único campo de dinheiro na Viagem era o pedágio (o que SAI). O valor
-- entrava uma vez só, copiado da planilha que o tomador mandava.

CREATE TYPE "BasePreco" AS ENUM ('TONELADA', 'KM', 'VIAGEM', 'PERIODO');

CREATE TABLE "tabelas_preco" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "materialId" TEXT,
    "tipoServicoId" TEXT,
    "kmFaixaDe" DECIMAL(10,2) NOT NULL,
    "kmFaixaAte" DECIMAL(10,2),
    "base" "BasePreco" NOT NULL,
    "precoUnitario" DECIMAL(10,2) NOT NULL,
    "repassaPedagio" BOOLEAN NOT NULL DEFAULT false,
    "vigenciaDe" DATE NOT NULL,
    "vigenciaAte" DATE,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tabelas_preco_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tabelas_preco_empresaId_materialId_idx" ON "tabelas_preco"("empresaId", "materialId");
CREATE INDEX "tabelas_preco_ativo_idx" ON "tabelas_preco"("ativo");
CREATE INDEX "tabelas_preco_contaId_idx" ON "tabelas_preco"("contaId");

CREATE TABLE "viagem_valores" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "viagemId" TEXT NOT NULL,
    "tabelaPrecoId" TEXT,
    "base" "BasePreco" NOT NULL,
    "precoUnitario" DECIMAL(10,2) NOT NULL,
    "quantidade" DECIMAL(12,3) NOT NULL,
    "valorFrete" DECIMAL(12,2) NOT NULL,
    "valorPedagio" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "valorTotal" DECIMAL(12,2) NOT NULL,
    "alteradoPorId" TEXT,
    "alteracaoMotivo" TEXT,
    "calculadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "viagem_valores_pkey" PRIMARY KEY ("viagemId")
);

CREATE INDEX "viagem_valores_contaId_idx" ON "viagem_valores"("contaId");
CREATE INDEX "viagem_valores_tabelaPrecoId_idx" ON "viagem_valores"("tabelaPrecoId");

ALTER TABLE "tabelas_preco" ADD CONSTRAINT "tabelas_preco_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tabelas_preco" ADD CONSTRAINT "tabelas_preco_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tabelas_preco" ADD CONSTRAINT "tabelas_preco_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materiais"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tabelas_preco" ADD CONSTRAINT "tabelas_preco_tipoServicoId_fkey" FOREIGN KEY ("tipoServicoId") REFERENCES "tipos_servico"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tabelas_preco" ADD CONSTRAINT "tabelas_preco_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "viagem_valores" ADD CONSTRAINT "viagem_valores_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "viagem_valores" ADD CONSTRAINT "viagem_valores_viagemId_fkey" FOREIGN KEY ("viagemId") REFERENCES "viagens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "viagem_valores" ADD CONSTRAINT "viagem_valores_tabelaPrecoId_fkey" FOREIGN KEY ("tabelaPrecoId") REFERENCES "tabelas_preco"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "viagem_valores" ADD CONSTRAINT "viagem_valores_alteradoPorId_fkey" FOREIGN KEY ("alteradoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
