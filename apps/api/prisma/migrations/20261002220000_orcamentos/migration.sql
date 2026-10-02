-- Orçamento (proposta comercial) que vira pedido.
--
-- Entidade separada do pedido de propósito: um status "PROPOSTA" no
-- StatusPedido vazaria pro saldo, pra programação e pra torre — o mesmo
-- raciocínio da ViagemPlanejada. Aprovado, cada item vira um Pedido de verdade
-- e fica ligado a ele por `orcamento_itens.pedidoId`.

CREATE TYPE "StatusOrcamento" AS ENUM ('RASCUNHO', 'ENVIADO', 'APROVADO', 'RECUSADO', 'VENCIDO');

CREATE TABLE "orcamentos" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "empresaId" TEXT,
    "clienteId" TEXT,
    "prospectNome" TEXT,
    "prospectContato" TEXT,
    "validadeEm" DATE NOT NULL,
    "status" "StatusOrcamento" NOT NULL DEFAULT 'RASCUNHO',
    "condicoes" TEXT,
    "inicioPrevistoEm" DATE,
    "prazoEm" DATE,
    "enviadoEm" TIMESTAMP(3),
    "aprovadoPorId" TEXT,
    "aprovadoEm" TIMESTAMP(3),
    "recusadoEm" TIMESTAMP(3),
    "motivoRecusa" TEXT,
    "vencidoEm" TIMESTAMP(3),
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orcamentos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orcamento_itens" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "orcamentoId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "materialId" TEXT,
    "tipoServicoId" TEXT,
    "localCargaId" TEXT,
    "localDescargaId" TEXT,
    "descricao" TEXT,
    "quantidade" DECIMAL(12,3) NOT NULL,
    "unidade" "UnidadePedido" NOT NULL,
    "base" "BasePreco" NOT NULL,
    "precoUnitario" DECIMAL(10,2) NOT NULL,
    "kmEstimado" DECIMAL(10,2),
    "pedidoId" TEXT,
    "tabelaPrecoCriadaId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orcamento_itens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "orcamentos_contaId_numero_key" ON "orcamentos"("contaId", "numero");
CREATE INDEX "orcamentos_contaId_status_idx" ON "orcamentos"("contaId", "status");
CREATE INDEX "orcamentos_empresaId_idx" ON "orcamentos"("empresaId");
CREATE INDEX "orcamentos_contaId_idx" ON "orcamentos"("contaId");

CREATE UNIQUE INDEX "orcamento_itens_pedidoId_key" ON "orcamento_itens"("pedidoId");
CREATE INDEX "orcamento_itens_orcamentoId_idx" ON "orcamento_itens"("orcamentoId");
CREATE INDEX "orcamento_itens_contaId_idx" ON "orcamento_itens"("contaId");

ALTER TABLE "orcamentos" ADD CONSTRAINT "orcamentos_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orcamentos" ADD CONSTRAINT "orcamentos_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orcamentos" ADD CONSTRAINT "orcamentos_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orcamentos" ADD CONSTRAINT "orcamentos_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "orcamento_itens" ADD CONSTRAINT "orcamento_itens_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orcamento_itens" ADD CONSTRAINT "orcamento_itens_orcamentoId_fkey" FOREIGN KEY ("orcamentoId") REFERENCES "orcamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orcamento_itens" ADD CONSTRAINT "orcamento_itens_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materiais"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orcamento_itens" ADD CONSTRAINT "orcamento_itens_tipoServicoId_fkey" FOREIGN KEY ("tipoServicoId") REFERENCES "tipos_servico"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orcamento_itens" ADD CONSTRAINT "orcamento_itens_localCargaId_fkey" FOREIGN KEY ("localCargaId") REFERENCES "locais"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orcamento_itens" ADD CONSTRAINT "orcamento_itens_localDescargaId_fkey" FOREIGN KEY ("localDescargaId") REFERENCES "locais"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orcamento_itens" ADD CONSTRAINT "orcamento_itens_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedidos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
