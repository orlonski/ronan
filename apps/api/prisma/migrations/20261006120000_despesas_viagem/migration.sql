-- Gasto de viagem (módulo `despesas`, Etapa 1). Tudo aditivo: nenhuma tabela
-- existente perde coluna, e nenhum dado é criado aqui — o kit de tipos é
-- semeado quando a plataforma LIGA o módulo numa conta (função idempotente),
-- nunca por migration.
-- Desenho: docs/despesas-viagem/09-modelo-dinamico.md.

-- CreateEnum
CREATE TYPE "StatusDespesa" AS ENUM ('COM_ESCRITORIO', 'APROVADA', 'NAO_REEMBOLSADA');

-- CreateEnum
CREATE TYPE "VinculoDespesa" AS ENUM ('SEM_RESPOSTA', 'VIAGEM', 'FORA_DE_VIAGEM');

-- CreateEnum
CREATE TYPE "VinculoPorDespesa" AS ENUM ('MOTORISTA', 'ESCRITORIO');

-- AlterEnum: linha nova do acerto. Nenhuma linha existente usa o valor.
ALTER TYPE "TipoItemAcerto" ADD VALUE 'REEMBOLSO_DESPESA';

-- AlterTable: o item de acerto aponta pro gasto que reembolsa.
ALTER TABLE "itens_acerto" ADD COLUMN "despesaId" TEXT;

-- AlterTable: terceiro interruptor de reembolso da modalidade (nasce ligado,
-- como reembolsaPedagio/reembolsaAbastecimento).
ALTER TABLE "modalidades_motorista" ADD COLUMN "reembolsaDespesa" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "tipos_despesa" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "icone" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "devolve" BOOLEAN NOT NULL DEFAULT true,
    "aprovaSozinhoAte" DECIMAL(10,2),
    "devolveNoMaximo" DECIMAL(10,2),
    "manutencao" BOOLEAN NOT NULL DEFAULT false,
    "podeCobrarCliente" BOOLEAN NOT NULL DEFAULT false,
    "campos" JSONB NOT NULL DEFAULT '{"v":1,"foto":"PEDE","campos":{}}',
    "camposVersao" INTEGER NOT NULL DEFAULT 1,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tipos_despesa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "despesas" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "motoristaId" TEXT NOT NULL,
    "tipoDespesaId" TEXT NOT NULL,
    "tipoNome" TEXT NOT NULL,
    "valorInformado" DECIMAL(10,2) NOT NULL,
    "valorAprovado" DECIMAL(10,2),
    "data" TIMESTAMP(3) NOT NULL,
    "vinculo" "VinculoDespesa" NOT NULL DEFAULT 'SEM_RESPOSTA',
    "vinculoPor" "VinculoPorDespesa",
    "vinculadoEm" TIMESTAMP(3),
    "viagemId" TEXT,
    "viagemClientId" TEXT,
    "veiculoId" TEXT,
    "descricao" TEXT,
    "litros" DECIMAL(10,3),
    "odometro" INTEGER,
    "onde" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "precisao" DOUBLE PRECISION,
    "semComprovanteMotivo" TEXT,
    "chaveFiscal" TEXT,
    "camposVersao" INTEGER,
    "status" "StatusDespesa" NOT NULL DEFAULT 'COM_ESCRITORIO',
    "motivo" TEXT,
    "decididoPorId" TEXT,
    "decididoEm" TIMESTAMP(3),
    "decididoAutomatico" BOOLEAN NOT NULL DEFAULT false,
    "marcas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "duplicadaDeId" TEXT,
    "repetidoPor" TEXT,
    "confirmouQueEOutro" BOOLEAN NOT NULL DEFAULT false,
    "criadoOfflineEm" TIMESTAMP(3),
    "sincronizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "despesas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "despesa_fotos" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "despesaId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT,
    "rotacao" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "despesa_fotos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tipos_despesa_contaId_ativo_ordem_idx" ON "tipos_despesa"("contaId", "ativo", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "tipos_despesa_contaId_slug_key" ON "tipos_despesa"("contaId", "slug");

-- CreateIndex
CREATE INDEX "despesas_contaId_status_data_idx" ON "despesas"("contaId", "status", "data");

-- CreateIndex
CREATE INDEX "despesas_contaId_data_idx" ON "despesas"("contaId", "data");

-- CreateIndex
CREATE INDEX "despesas_motoristaId_data_idx" ON "despesas"("motoristaId", "data");

-- CreateIndex
CREATE INDEX "despesas_viagemId_idx" ON "despesas"("viagemId");

-- CreateIndex
CREATE INDEX "despesas_viagemClientId_idx" ON "despesas"("viagemClientId");

-- CreateIndex
CREATE INDEX "despesas_contaId_chaveFiscal_idx" ON "despesas"("contaId", "chaveFiscal");

-- CreateIndex
CREATE INDEX "despesas_contaId_idx" ON "despesas"("contaId");

-- CreateIndex: idempotência do outbox — único POR MOTORISTA.
CREATE UNIQUE INDEX "despesas_motoristaId_clientId_key" ON "despesas"("motoristaId", "clientId");

-- CreateIndex
CREATE INDEX "despesa_fotos_despesaId_idx" ON "despesa_fotos"("despesaId");

-- CreateIndex
CREATE INDEX "despesa_fotos_contaId_sha256_idx" ON "despesa_fotos"("contaId", "sha256");

-- CreateIndex
CREATE INDEX "despesa_fotos_contaId_idx" ON "despesa_fotos"("contaId");

-- CreateIndex
CREATE INDEX "itens_acerto_despesaId_idx" ON "itens_acerto"("despesaId");

-- AddForeignKey
ALTER TABLE "itens_acerto" ADD CONSTRAINT "itens_acerto_despesaId_fkey" FOREIGN KEY ("despesaId") REFERENCES "despesas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tipos_despesa" ADD CONSTRAINT "tipos_despesa_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "despesas" ADD CONSTRAINT "despesas_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "despesas" ADD CONSTRAINT "despesas_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "despesas" ADD CONSTRAINT "despesas_tipoDespesaId_fkey" FOREIGN KEY ("tipoDespesaId") REFERENCES "tipos_despesa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "despesas" ADD CONSTRAINT "despesas_viagemId_fkey" FOREIGN KEY ("viagemId") REFERENCES "viagens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "despesas" ADD CONSTRAINT "despesas_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "veiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "despesas" ADD CONSTRAINT "despesas_decididoPorId_fkey" FOREIGN KEY ("decididoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "despesas" ADD CONSTRAINT "despesas_duplicadaDeId_fkey" FOREIGN KEY ("duplicadaDeId") REFERENCES "despesas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "despesa_fotos" ADD CONSTRAINT "despesa_fotos_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "despesa_fotos" ADD CONSTRAINT "despesa_fotos_despesaId_fkey" FOREIGN KEY ("despesaId") REFERENCES "despesas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
