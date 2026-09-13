-- Pedido do cliente e viagem programada.
--
-- Até aqui existiam exatamente dois pontos de criação de viagem no projeto, e
-- os dois exigiam token de MOTORISTA: o painel não conseguia criar viagem. Tudo
-- começava quando ele tocava "Iniciar viagem", e a programação do dia vivia no
-- grupo de WhatsApp.

CREATE TYPE "UnidadePedido" AS ENUM ('VIAGENS', 'TONELADAS');
CREATE TYPE "StatusPedido" AS ENUM ('ABERTO', 'EM_CURSO', 'CUMPRIDO', 'CANCELADO');
CREATE TYPE "StatusViagemPlanejada" AS ENUM ('PLANEJADA', 'PUBLICADA', 'ACEITA', 'RECUSADA', 'EM_EXECUCAO', 'CUMPRIDA', 'FURADA', 'CANCELADA');

-- Ficha técnica do veículo. Tudo nullable: frota que já usa o sistema não pode
-- travar por cadastro incompleto — quem exigir o campo cobra na hora de usar.
ALTER TABLE "veiculos"
  ADD COLUMN "capacidadeToneladas" DECIMAL(10,3),
  ADD COLUMN "tara" DECIMAL(10,3),
  ADD COLUMN "renavam" TEXT,
  ADD COLUMN "chassi" TEXT,
  ADD COLUMN "anoFabricacao" INTEGER,
  ADD COLUMN "anoModelo" INTEGER,
  ADD COLUMN "marca" TEXT,
  ADD COLUMN "tipoRodado" TEXT,
  ADD COLUMN "tipoCarroceria" TEXT,
  ADD COLUMN "tipoProprietario" TEXT,
  ADD COLUMN "cpfCnpjProprietario" TEXT,
  ADD COLUMN "rntrcProprietario" TEXT,
  ADD COLUMN "crlvValidade" DATE,
  ADD COLUMN "seguroValidade" DATE;

CREATE TABLE "pedidos" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "empresaId" TEXT NOT NULL,
    "clienteId" TEXT,
    "materialId" TEXT,
    "localCargaId" TEXT,
    "localDescargaId" TEXT,
    "tipoServicoId" TEXT,
    "quantidadeAlvo" DECIMAL(12,3) NOT NULL,
    "unidadeAlvo" "UnidadePedido" NOT NULL DEFAULT 'VIAGENS',
    "inicioEm" DATE NOT NULL,
    "prazoEm" DATE,
    "prioridade" INTEGER NOT NULL DEFAULT 0,
    "status" "StatusPedido" NOT NULL DEFAULT 'ABERTO',
    "observacao" TEXT,
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pedidos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pedidos_contaId_numero_key" ON "pedidos"("contaId", "numero");
CREATE INDEX "pedidos_contaId_status_idx" ON "pedidos"("contaId", "status");
CREATE INDEX "pedidos_empresaId_prazoEm_idx" ON "pedidos"("empresaId", "prazoEm");
CREATE INDEX "pedidos_contaId_idx" ON "pedidos"("contaId");

CREATE TABLE "viagens_planejadas" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "pedidoId" TEXT,
    "motoristaId" TEXT,
    "veiculoId" TEXT,
    "dataPrevista" DATE NOT NULL,
    "janelaInicio" TEXT,
    "janelaFim" TEXT,
    "sequencia" INTEGER NOT NULL DEFAULT 0,
    "status" "StatusViagemPlanejada" NOT NULL DEFAULT 'PLANEJADA',
    "viagemId" TEXT,
    "observacao" TEXT,
    "publicadoEm" TIMESTAMP(3),
    "respondidoEm" TIMESTAMP(3),
    "recusaMotivo" TEXT,
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "viagens_planejadas_pkey" PRIMARY KEY ("id")
);

-- Uma viagem real cumpre no máximo uma planejada.
CREATE UNIQUE INDEX "viagens_planejadas_viagemId_key" ON "viagens_planejadas"("viagemId");
CREATE INDEX "viagens_planejadas_contaId_dataPrevista_idx" ON "viagens_planejadas"("contaId", "dataPrevista");
CREATE INDEX "viagens_planejadas_motoristaId_dataPrevista_idx" ON "viagens_planejadas"("motoristaId", "dataPrevista");
CREATE INDEX "viagens_planejadas_pedidoId_idx" ON "viagens_planejadas"("pedidoId");
CREATE INDEX "viagens_planejadas_contaId_idx" ON "viagens_planejadas"("contaId");

ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materiais"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_localCargaId_fkey" FOREIGN KEY ("localCargaId") REFERENCES "locais"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_localDescargaId_fkey" FOREIGN KEY ("localDescargaId") REFERENCES "locais"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_tipoServicoId_fkey" FOREIGN KEY ("tipoServicoId") REFERENCES "tipos_servico"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "viagens_planejadas" ADD CONSTRAINT "viagens_planejadas_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "viagens_planejadas" ADD CONSTRAINT "viagens_planejadas_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedidos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "viagens_planejadas" ADD CONSTRAINT "viagens_planejadas_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "viagens_planejadas" ADD CONSTRAINT "viagens_planejadas_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "veiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "viagens_planejadas" ADD CONSTRAINT "viagens_planejadas_viagemId_fkey" FOREIGN KEY ("viagemId") REFERENCES "viagens"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "viagens_planejadas" ADD CONSTRAINT "viagens_planejadas_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
