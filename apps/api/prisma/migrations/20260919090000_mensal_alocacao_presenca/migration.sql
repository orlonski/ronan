-- CreateEnum
CREATE TYPE "OrigemPresenca" AS ENUM ('APP', 'PAINEL');

-- AlterTable
ALTER TABLE "motoristas" ADD COLUMN     "podeVerValorDiaria" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "alocacoes_obra" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "motoristaId" TEXT NOT NULL,
    "veiculoId" TEXT NOT NULL,
    "inicio" DATE NOT NULL,
    "fim" DATE,
    "valorDiaria" DECIMAL(10,2),
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "encerradaEm" TIMESTAMP(3),
    "encerradaMotivo" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    "criadoPorId" TEXT,
    "vigenteDe" TEXT,

    CONSTRAINT "alocacoes_obra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registros_presenca" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "alocacaoId" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "registradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "origem" "OrigemPresenca" NOT NULL DEFAULT 'APP',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "precisao" DOUBLE PRECISION,
    "motivoPainel" TEXT,
    "criadoPorId" TEXT,
    "clientId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registros_presenca_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alocacoes_obra_contaId_clienteId_ativa_idx" ON "alocacoes_obra"("contaId", "clienteId", "ativa");

-- CreateIndex
CREATE INDEX "alocacoes_obra_motoristaId_ativa_idx" ON "alocacoes_obra"("motoristaId", "ativa");

-- CreateIndex
CREATE UNIQUE INDEX "uma_alocacao_ativa_por_motorista" ON "alocacoes_obra"("contaId", "vigenteDe");

-- CreateIndex
CREATE INDEX "registros_presenca_contaId_data_idx" ON "registros_presenca"("contaId", "data");

-- CreateIndex
CREATE UNIQUE INDEX "registros_presenca_alocacaoId_data_key" ON "registros_presenca"("alocacaoId", "data");

-- CreateIndex
CREATE UNIQUE INDEX "registros_presenca_contaId_clientId_key" ON "registros_presenca"("contaId", "clientId");

-- AddForeignKey
ALTER TABLE "alocacoes_obra" ADD CONSTRAINT "alocacoes_obra_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alocacoes_obra" ADD CONSTRAINT "alocacoes_obra_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alocacoes_obra" ADD CONSTRAINT "alocacoes_obra_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alocacoes_obra" ADD CONSTRAINT "alocacoes_obra_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "veiculos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alocacoes_obra" ADD CONSTRAINT "alocacoes_obra_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registros_presenca" ADD CONSTRAINT "registros_presenca_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registros_presenca" ADD CONSTRAINT "registros_presenca_alocacaoId_fkey" FOREIGN KEY ("alocacaoId") REFERENCES "alocacoes_obra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registros_presenca" ADD CONSTRAINT "registros_presenca_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

