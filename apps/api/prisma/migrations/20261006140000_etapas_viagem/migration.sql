-- Etapas da viagem (módulo `etapas`, Onda 0). Tudo aditivo: nenhuma tabela
-- existente perde coluna e nenhum dado é criado aqui — os modelos prontos
-- (Carregamento, Descarga, Acerto do frete) são OFERECIDOS no painel, nunca
-- semeados. A viagem ganha só a lista de versões que valem pra ela (vazia por
-- padrão: viagem antiga não passa a dever documento nenhum). O que falta é
-- calculado na leitura; nada entra em viagem_divergencias.
-- Desenho: docs/etapas-viagem/04-proposta.md ("Pra quem implementa").

-- CreateEnum
CREATE TYPE "MomentoEtapa" AS ENUM ('INICIO', 'FIM', 'AVULSA', 'EVENTO');

-- CreateEnum
CREATE TYPE "TipoAcaoEtapa" AS ENUM ('SEGUIU_SEM', 'DISPENSADO', 'ANEXADO_ESCRITORIO');

-- AlterTable
ALTER TABLE "viagens" ADD COLUMN     "etapasAplicaveis" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "etapasFixadasEm" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "modelos_etapa" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "momento" "MomentoEtapa" NOT NULL,
    "tipoEventoId" TEXT,
    "janelaDias" INTEGER NOT NULL DEFAULT 30,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "versaoAtualId" TEXT,
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "modelos_etapa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modelos_etapa_versoes" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "modeloId" TEXT NOT NULL,
    "versao" INTEGER NOT NULL,
    "definicao" JSONB NOT NULL,
    "publicadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publicadaPorId" TEXT,

    CONSTRAINT "modelos_etapa_versoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "respostas_etapa" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "modeloId" TEXT NOT NULL,
    "versaoId" TEXT NOT NULL,
    "modeloNome" TEXT NOT NULL,
    "momento" "MomentoEtapa" NOT NULL,
    "viagemClientId" TEXT NOT NULL,
    "viagemId" TEXT,
    "motoristaId" TEXT NOT NULL,
    "veiculoId" TEXT,
    "placa" TEXT,
    "iniciadaEm" TIMESTAMP(3),
    "concluida" BOOLEAN NOT NULL DEFAULT false,
    "concluidaEm" TIMESTAMP(3),
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "precisao" DOUBLE PRECISION,
    "marcas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "criadoOfflineEm" TIMESTAMP(3),
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "respostas_etapa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "respostas_etapa_itens" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "respostaId" TEXT NOT NULL,
    "itemChave" TEXT NOT NULL,
    "rotulo" TEXT NOT NULL,
    "area" TEXT,
    "tipo" TEXT NOT NULL,
    "obrigatorio" BOOLEAN NOT NULL,
    "simNao" BOOLEAN,
    "texto" TEXT,
    "numero" DECIMAL(16,3),
    "valor" DECIMAL(12,2),
    "comentario" TEXT,
    "assinaturaSvg" TEXT,
    "assinanteNome" TEXT,
    "respondidoEm" TIMESTAMP(3) NOT NULL,
    "corrigidoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "respostas_etapa_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "respostas_etapa_arquivos" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "nome" TEXT,
    "tamanho" INTEGER,
    "sha256" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removidoEm" TIMESTAMP(3),

    CONSTRAINT "respostas_etapa_arquivos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "respostas_etapa_itens_historico" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "antes" JSONB NOT NULL,
    "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "respostas_etapa_itens_historico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "etapa_pendencia_acoes" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "tipo" "TipoAcaoEtapa" NOT NULL,
    "clientId" TEXT,
    "modeloId" TEXT NOT NULL,
    "itemChave" TEXT,
    "viagemClientId" TEXT NOT NULL,
    "viagemId" TEXT,
    "motivoCodigo" TEXT,
    "motivo" TEXT,
    "acaoMotorista" TEXT,
    "motoristaId" TEXT,
    "autorUserId" TEXT,
    "autorNome" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "precisao" DOUBLE PRECISION,
    "ocorridoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "storageKey" TEXT,
    "mime" TEXT,
    "nomeArquivo" TEXT,
    "tamanho" INTEGER,
    "sha256" TEXT,
    "desfeitoEm" TIMESTAMP(3),
    "desfeitoPorId" TEXT,
    "desfeitoPorNome" TEXT,

    CONSTRAINT "etapa_pendencia_acoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "modelos_etapa_versaoAtualId_key" ON "modelos_etapa"("versaoAtualId");

-- CreateIndex
CREATE INDEX "modelos_etapa_contaId_ativo_ordem_idx" ON "modelos_etapa"("contaId", "ativo", "ordem");

-- CreateIndex
CREATE INDEX "modelos_etapa_tipoEventoId_idx" ON "modelos_etapa"("tipoEventoId");

-- CreateIndex
CREATE INDEX "modelos_etapa_contaId_idx" ON "modelos_etapa"("contaId");

-- CreateIndex
CREATE INDEX "modelos_etapa_versoes_contaId_idx" ON "modelos_etapa_versoes"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "modelos_etapa_versoes_modeloId_versao_key" ON "modelos_etapa_versoes"("modeloId", "versao");

-- CreateIndex
CREATE INDEX "respostas_etapa_contaId_motoristaId_recebidoEm_idx" ON "respostas_etapa"("contaId", "motoristaId", "recebidoEm");

-- CreateIndex
CREATE INDEX "respostas_etapa_viagemId_idx" ON "respostas_etapa"("viagemId");

-- CreateIndex
CREATE INDEX "respostas_etapa_modeloId_idx" ON "respostas_etapa"("modeloId");

-- CreateIndex
CREATE INDEX "respostas_etapa_versaoId_idx" ON "respostas_etapa"("versaoId");

-- CreateIndex
CREATE INDEX "respostas_etapa_contaId_idx" ON "respostas_etapa"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "respostas_etapa_contaId_viagemClientId_modeloId_key" ON "respostas_etapa"("contaId", "viagemClientId", "modeloId");

-- CreateIndex
CREATE INDEX "respostas_etapa_itens_contaId_idx" ON "respostas_etapa_itens"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "respostas_etapa_itens_respostaId_itemChave_key" ON "respostas_etapa_itens"("respostaId", "itemChave");

-- CreateIndex
CREATE INDEX "respostas_etapa_arquivos_contaId_sha256_idx" ON "respostas_etapa_arquivos"("contaId", "sha256");

-- CreateIndex
CREATE INDEX "respostas_etapa_arquivos_contaId_idx" ON "respostas_etapa_arquivos"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "respostas_etapa_arquivos_itemId_storageKey_key" ON "respostas_etapa_arquivos"("itemId", "storageKey");

-- CreateIndex
CREATE INDEX "respostas_etapa_itens_historico_itemId_idx" ON "respostas_etapa_itens_historico"("itemId");

-- CreateIndex
CREATE INDEX "respostas_etapa_itens_historico_contaId_idx" ON "respostas_etapa_itens_historico"("contaId");

-- CreateIndex
CREATE INDEX "etapa_pendencia_acoes_contaId_viagemClientId_idx" ON "etapa_pendencia_acoes"("contaId", "viagemClientId");

-- CreateIndex
CREATE INDEX "etapa_pendencia_acoes_viagemId_idx" ON "etapa_pendencia_acoes"("viagemId");

-- CreateIndex
CREATE INDEX "etapa_pendencia_acoes_modeloId_idx" ON "etapa_pendencia_acoes"("modeloId");

-- CreateIndex
CREATE INDEX "etapa_pendencia_acoes_motoristaId_idx" ON "etapa_pendencia_acoes"("motoristaId");

-- CreateIndex
CREATE INDEX "etapa_pendencia_acoes_contaId_idx" ON "etapa_pendencia_acoes"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "etapa_pendencia_acoes_contaId_clientId_itemChave_key" ON "etapa_pendencia_acoes"("contaId", "clientId", "itemChave");

-- AddForeignKey
ALTER TABLE "modelos_etapa" ADD CONSTRAINT "modelos_etapa_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modelos_etapa" ADD CONSTRAINT "modelos_etapa_tipoEventoId_fkey" FOREIGN KEY ("tipoEventoId") REFERENCES "tipos_evento_viagem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modelos_etapa" ADD CONSTRAINT "modelos_etapa_versaoAtualId_fkey" FOREIGN KEY ("versaoAtualId") REFERENCES "modelos_etapa_versoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modelos_etapa_versoes" ADD CONSTRAINT "modelos_etapa_versoes_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modelos_etapa_versoes" ADD CONSTRAINT "modelos_etapa_versoes_modeloId_fkey" FOREIGN KEY ("modeloId") REFERENCES "modelos_etapa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "respostas_etapa" ADD CONSTRAINT "respostas_etapa_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "respostas_etapa" ADD CONSTRAINT "respostas_etapa_modeloId_fkey" FOREIGN KEY ("modeloId") REFERENCES "modelos_etapa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "respostas_etapa" ADD CONSTRAINT "respostas_etapa_versaoId_fkey" FOREIGN KEY ("versaoId") REFERENCES "modelos_etapa_versoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "respostas_etapa" ADD CONSTRAINT "respostas_etapa_viagemId_fkey" FOREIGN KEY ("viagemId") REFERENCES "viagens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "respostas_etapa" ADD CONSTRAINT "respostas_etapa_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "respostas_etapa_itens" ADD CONSTRAINT "respostas_etapa_itens_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "respostas_etapa_itens" ADD CONSTRAINT "respostas_etapa_itens_respostaId_fkey" FOREIGN KEY ("respostaId") REFERENCES "respostas_etapa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "respostas_etapa_arquivos" ADD CONSTRAINT "respostas_etapa_arquivos_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "respostas_etapa_arquivos" ADD CONSTRAINT "respostas_etapa_arquivos_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "respostas_etapa_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "respostas_etapa_itens_historico" ADD CONSTRAINT "respostas_etapa_itens_historico_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "respostas_etapa_itens_historico" ADD CONSTRAINT "respostas_etapa_itens_historico_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "respostas_etapa_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etapa_pendencia_acoes" ADD CONSTRAINT "etapa_pendencia_acoes_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etapa_pendencia_acoes" ADD CONSTRAINT "etapa_pendencia_acoes_modeloId_fkey" FOREIGN KEY ("modeloId") REFERENCES "modelos_etapa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etapa_pendencia_acoes" ADD CONSTRAINT "etapa_pendencia_acoes_viagemId_fkey" FOREIGN KEY ("viagemId") REFERENCES "viagens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etapa_pendencia_acoes" ADD CONSTRAINT "etapa_pendencia_acoes_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

