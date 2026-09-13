-- Frota: manutenção, pneu, documento com vencimento e multa.
--
-- Depois do diesel, manutenção e pneu são o maior custo da operação — e não
-- existia nada: nem plano preventivo, nem OS, nem histórico, nem custo por
-- caminhão. CRLV e seguro venciam sem ninguém ser avisado, e o caminhão parava
-- na balança.

CREATE TYPE "TipoManutencao" AS ENUM ('PREVENTIVA', 'CORRETIVA', 'PNEU', 'SINISTRO', 'OUTRO');
CREATE TYPE "StatusManutencao" AS ENUM ('ABERTA', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA');
CREATE TYPE "StatusMulta" AS ENUM ('RECEBIDA', 'INDICADA', 'RECORRIDA', 'PAGA', 'CANCELADA');

CREATE TABLE "manutencoes_veiculo" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "veiculoId" TEXT NOT NULL,
    "tipo" "TipoManutencao" NOT NULL DEFAULT 'PREVENTIVA',
    "status" "StatusManutencao" NOT NULL DEFAULT 'ABERTA',
    "descricao" TEXT NOT NULL,
    "odometro" INTEGER,
    "iniciadaEm" TIMESTAMP(3),
    "concluidaEm" TIMESTAMP(3),
    "previstaEm" DATE,
    "fornecedorId" TEXT,
    "valorPecas" DECIMAL(12,2),
    "valorMaoObra" DECIMAL(12,2),
    "valorTotal" DECIMAL(12,2),
    "tituloPagarId" TEXT,
    "observacao" TEXT,
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "manutencoes_veiculo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "manutencoes_veiculo_tituloPagarId_key" ON "manutencoes_veiculo"("tituloPagarId");
CREATE INDEX "manutencoes_veiculo_veiculoId_status_idx" ON "manutencoes_veiculo"("veiculoId", "status");
CREATE INDEX "manutencoes_veiculo_contaId_status_idx" ON "manutencoes_veiculo"("contaId", "status");
CREATE INDEX "manutencoes_veiculo_contaId_idx" ON "manutencoes_veiculo"("contaId");

CREATE TABLE "planos_manutencao" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "veiculoId" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "intervaloKm" INTEGER,
    "intervaloDias" INTEGER,
    "ultimoOdometro" INTEGER,
    "ultimaEm" DATE,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "planos_manutencao_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "planos_manutencao_veiculoId_ativo_idx" ON "planos_manutencao"("veiculoId", "ativo");
CREATE INDEX "planos_manutencao_contaId_idx" ON "planos_manutencao"("contaId");

CREATE TABLE "documentos_veiculo" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "veiculoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "numero" TEXT,
    "validade" DATE,
    "storageKey" TEXT,
    "nomeArquivo" TEXT,
    "observacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "documentos_veiculo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "documentos_veiculo_veiculoId_tipo_key" ON "documentos_veiculo"("veiculoId", "tipo");
CREATE INDEX "documentos_veiculo_contaId_validade_idx" ON "documentos_veiculo"("contaId", "validade");
CREATE INDEX "documentos_veiculo_contaId_idx" ON "documentos_veiculo"("contaId");

CREATE TABLE "pneus" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "numeroFogo" TEXT NOT NULL,
    "marca" TEXT,
    "medida" TEXT,
    "veiculoId" TEXT,
    "posicao" TEXT,
    "sulcoMm" DECIMAL(4,1),
    "medidoEm" DATE,
    "odometroInstalacao" INTEGER,
    "recapagens" INTEGER NOT NULL DEFAULT 0,
    "valorCompra" DECIMAL(10,2),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "observacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pneus_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pneus_contaId_numeroFogo_key" ON "pneus"("contaId", "numeroFogo");
CREATE INDEX "pneus_veiculoId_ativo_idx" ON "pneus"("veiculoId", "ativo");
CREATE INDEX "pneus_contaId_idx" ON "pneus"("contaId");

CREATE TABLE "multas" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "veiculoId" TEXT,
    "motoristaId" TEXT,
    "numeroAit" TEXT,
    "infracao" TEXT NOT NULL,
    "gravidade" TEXT,
    "pontos" INTEGER,
    "local" TEXT,
    "ocorridaEm" TIMESTAMP(3) NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "valorComDesconto" DECIMAL(10,2),
    "vencimento" DATE,
    "prazoIndicacao" DATE,
    "status" "StatusMulta" NOT NULL DEFAULT 'RECEBIDA',
    "descontarDoMotorista" BOOLEAN NOT NULL DEFAULT false,
    "itemAcertoId" TEXT,
    "observacao" TEXT,
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "multas_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "multas_contaId_status_idx" ON "multas"("contaId", "status");
CREATE INDEX "multas_veiculoId_ocorridaEm_idx" ON "multas"("veiculoId", "ocorridaEm");
CREATE INDEX "multas_motoristaId_ocorridaEm_idx" ON "multas"("motoristaId", "ocorridaEm");
CREATE INDEX "multas_contaId_idx" ON "multas"("contaId");

ALTER TABLE "manutencoes_veiculo" ADD CONSTRAINT "manutencoes_veiculo_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manutencoes_veiculo" ADD CONSTRAINT "manutencoes_veiculo_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "veiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manutencoes_veiculo" ADD CONSTRAINT "manutencoes_veiculo_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "fornecedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "manutencoes_veiculo" ADD CONSTRAINT "manutencoes_veiculo_tituloPagarId_fkey" FOREIGN KEY ("tituloPagarId") REFERENCES "titulos_pagar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "manutencoes_veiculo" ADD CONSTRAINT "manutencoes_veiculo_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "planos_manutencao" ADD CONSTRAINT "planos_manutencao_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "planos_manutencao" ADD CONSTRAINT "planos_manutencao_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "veiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "documentos_veiculo" ADD CONSTRAINT "documentos_veiculo_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "documentos_veiculo" ADD CONSTRAINT "documentos_veiculo_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "veiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pneus" ADD CONSTRAINT "pneus_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pneus" ADD CONSTRAINT "pneus_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "veiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "multas" ADD CONSTRAINT "multas_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "multas" ADD CONSTRAINT "multas_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "veiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "multas" ADD CONSTRAINT "multas_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "multas" ADD CONSTRAINT "multas_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
