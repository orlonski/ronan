-- Acesso do encarregado da obra: portal /obra, entrada por código no WhatsApp.
-- Escrita à mão: o diff do schema contra o banco traz drift antigo (índices e
-- FKs que nada tem a ver com isto), que não entra aqui.

CREATE TYPE "StatusSolicitacaoObra" AS ENUM ('PENDENTE', 'CONFIRMADA', 'RECUSADA');

CREATE TABLE "encarregados_obra" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "podeVerValores" BOOLEAN NOT NULL DEFAULT false,
    "podePedirCaminhao" BOOLEAN NOT NULL DEFAULT true,
    "convidadoPorId" TEXT,
    "conviteEnviadoEm" TIMESTAMP(3),
    "ultimoAcessoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "encarregados_obra_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "encarregados_obra_telefone_idx" ON "encarregados_obra"("telefone");
CREATE INDEX "encarregados_obra_contaId_idx" ON "encarregados_obra"("contaId");
CREATE UNIQUE INDEX "encarregados_obra_clienteId_telefone_key" ON "encarregados_obra"("clienteId", "telefone");
ALTER TABLE "encarregados_obra" ADD CONSTRAINT "encarregados_obra_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "encarregados_obra" ADD CONSTRAINT "encarregados_obra_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "encarregados_obra" ADD CONSTRAINT "encarregados_obra_convidadoPorId_fkey" FOREIGN KEY ("convidadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Sessão: só o SHA-256 do token mora aqui.
CREATE TABLE "sessoes_encarregado" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "encarregadoId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "revogadaEm" TIMESTAMP(3),
    "ultimoUsoEm" TIMESTAMP(3),
    CONSTRAINT "sessoes_encarregado_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sessoes_encarregado_tokenHash_key" ON "sessoes_encarregado"("tokenHash");
CREATE INDEX "sessoes_encarregado_encarregadoId_idx" ON "sessoes_encarregado"("encarregadoId");
CREATE INDEX "sessoes_encarregado_contaId_idx" ON "sessoes_encarregado"("contaId");
ALTER TABLE "sessoes_encarregado" ADD CONSTRAINT "sessoes_encarregado_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sessoes_encarregado" ADD CONSTRAINT "sessoes_encarregado_encarregadoId_fkey" FOREIGN KEY ("encarregadoId") REFERENCES "encarregados_obra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Código de entrada, por telefone. Global: o login vem antes de saber a empresa.
CREATE TABLE "codigos_encarregado" (
    "telefone" TEXT NOT NULL,
    "codigoHash" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "enviadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "codigos_encarregado_pkey" PRIMARY KEY ("telefone")
);

-- "Preciso de caminhão", pedido pelo portal.
CREATE TABLE "solicitacoes_obra" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "encarregadoId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "quantidade" DECIMAL(12,3) NOT NULL,
    "unidade" "UnidadePedido" NOT NULL DEFAULT 'VIAGENS',
    "materialId" TEXT,
    "observacao" TEXT,
    "status" "StatusSolicitacaoObra" NOT NULL DEFAULT 'PENDENTE',
    "pedidoId" TEXT,
    "viagensProgramadas" INTEGER,
    "respondidoPorId" TEXT,
    "respondidoEm" TIMESTAMP(3),
    "recusaMotivo" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "solicitacoes_obra_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "solicitacoes_obra_contaId_status_idx" ON "solicitacoes_obra"("contaId", "status");
CREATE INDEX "solicitacoes_obra_clienteId_criadoEm_idx" ON "solicitacoes_obra"("clienteId", "criadoEm");
CREATE INDEX "solicitacoes_obra_contaId_idx" ON "solicitacoes_obra"("contaId");
ALTER TABLE "solicitacoes_obra" ADD CONSTRAINT "solicitacoes_obra_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "solicitacoes_obra" ADD CONSTRAINT "solicitacoes_obra_encarregadoId_fkey" FOREIGN KEY ("encarregadoId") REFERENCES "encarregados_obra"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "solicitacoes_obra" ADD CONSTRAINT "solicitacoes_obra_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "solicitacoes_obra" ADD CONSTRAINT "solicitacoes_obra_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materiais"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "solicitacoes_obra" ADD CONSTRAINT "solicitacoes_obra_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedidos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "solicitacoes_obra" ADD CONSTRAINT "solicitacoes_obra_respondidoPorId_fkey" FOREIGN KEY ("respondidoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A programação ganha a origem (pedido da obra) e o "pode vir" do encarregado.
ALTER TABLE "viagens_planejadas" ADD COLUMN "aprovadaObraEm" TIMESTAMP(3),
ADD COLUMN "aprovadaObraPorId" TEXT,
ADD COLUMN "solicitacaoObraId" TEXT;
ALTER TABLE "viagens_planejadas" ADD CONSTRAINT "viagens_planejadas_solicitacaoObraId_fkey" FOREIGN KEY ("solicitacaoObraId") REFERENCES "solicitacoes_obra"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "viagens_planejadas" ADD CONSTRAINT "viagens_planejadas_aprovadaObraPorId_fkey" FOREIGN KEY ("aprovadaObraPorId") REFERENCES "encarregados_obra"("id") ON DELETE SET NULL ON UPDATE CASCADE;
