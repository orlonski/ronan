-- Conferência da tag de pedágio (módulo `tag-pedagio`, Onda 1). Tudo aditivo:
-- nenhuma coluna existente muda e nenhum dado é criado. A conta ganha só o
-- interruptor da ligação automática (nasce DESLIGADO: o 1º mês só sugere) e o
-- veículo ganha os eixos de costume (opcionais, confirmados por gente).
-- O de-para GLOBAL de praças (`pracas_tag_de_para`) não tem contaId: a praça é
-- dado público e só a equipe da plataforma confirma ali (04-qa M6).
-- Desenho: docs/tag-pedagio/03-proposta.md ("Onda 1"), 04-qa.md, 05-prova.

-- AlterTable
ALTER TABLE "contas" ADD COLUMN     "ligacaoAutomaticaTag" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "veiculos" ADD COLUMN     "eixosCavalo" INTEGER,
ADD COLUMN     "eixosComposicao" INTEGER,
ADD COLUMN     "eixosConfirmadoEm" TIMESTAMP(3),
ADD COLUMN     "eixosConfirmadoPorId" TEXT,
ADD COLUMN     "eixosSuspensosVazio" INTEGER;

-- CreateTable
CREATE TABLE "extratos_tag" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "operadora" TEXT NOT NULL,
    "formato" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "motivo" TEXT,
    "nomeArquivo" TEXT NOT NULL,
    "hashArquivo" TEXT NOT NULL,
    "arquivoKey" TEXT,
    "arquivoExpiraEm" TIMESTAMP(3),
    "numeroFatura" TEXT,
    "numeroNotaFiscal" TEXT,
    "codigoCliente" TEXT,
    "cnpjFatura" TEXT,
    "nomeFatura" TEXT,
    "cnpjConfirmadoPorId" TEXT,
    "periodoDe" DATE,
    "periodoAte" DATE,
    "emitidoEm" DATE,
    "totalNota" DECIMAL(12,2),
    "conferencia" JSONB NOT NULL,
    "passagens" INTEGER NOT NULL DEFAULT 0,
    "importadoPorId" TEXT,
    "importadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processadoEm" TIMESTAMP(3),

    CONSTRAINT "extratos_tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extratos_tag_veiculos" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "extratoId" TEXT NOT NULL,
    "placaTexto" TEXT NOT NULL,
    "veiculoId" TEXT,
    "plano" DECIMAL(10,2) NOT NULL,
    "uso" DECIMAL(12,2) NOT NULL,
    "qtdUsos" INTEGER NOT NULL,
    "outras" DECIMAL(10,2) NOT NULL,
    "somaDetalhe" DECIMAL(12,2) NOT NULL,
    "qtdDetalhe" INTEGER NOT NULL,
    "ajuste" DECIMAL(12,2) NOT NULL,
    "taxas" JSONB NOT NULL,

    CONSTRAINT "extratos_tag_veiculos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passagens_tag" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "extratoId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "dc" TEXT NOT NULL,
    "placaTexto" TEXT NOT NULL,
    "veiculoId" TEXT,
    "ocorridoEm" TIMESTAMP(3) NOT NULL,
    "dataHoraTexto" TEXT NOT NULL,
    "fusoOffsetMin" INTEGER NOT NULL,
    "concessionaria" TEXT,
    "pracaTexto" TEXT NOT NULL,
    "chavePraca" TEXT NOT NULL,
    "rodovia" TEXT NOT NULL,
    "kmMetros" INTEGER NOT NULL,
    "sentido" TEXT NOT NULL,
    "cidade" TEXT NOT NULL,
    "uf" TEXT,
    "categoria" INTEGER NOT NULL,
    "eixosCobrados" INTEGER NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "embarcadorTexto" TEXT,
    "numeroViagemVale" TEXT,
    "linhaOriginal" TEXT NOT NULL,
    "linhaPdf" INTEGER NOT NULL,

    CONSTRAINT "passagens_tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pracas_tag_de_para" (
    "id" TEXT NOT NULL,
    "operadora" TEXT NOT NULL,
    "chavePraca" TEXT NOT NULL,
    "pedagioRodoviaId" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "evidencia" JSONB,
    "confirmadoPorId" TEXT,
    "confirmadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pracas_tag_de_para_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pracas_tag_de_para_conta" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "operadora" TEXT NOT NULL,
    "chavePraca" TEXT NOT NULL,
    "pedagioRodoviaId" TEXT NOT NULL,
    "confirmadoPorId" TEXT,
    "confirmadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pracas_tag_de_para_conta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trechos_tag" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "placaTexto" TEXT NOT NULL,
    "veiculoId" TEXT,
    "estado" TEXT NOT NULL,
    "ini" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3) NOT NULL,
    "passagemIds" TEXT[],
    "passagemAncoraId" TEXT NOT NULL,
    "viagemInferidaAncoraId" TEXT,
    "valorTag" DECIMAL(10,2) NOT NULL,
    "valorVale" DECIMAL(10,2) NOT NULL,
    "abriuPor" TEXT NOT NULL,
    "cruzamento" JSONB NOT NULL,
    "calculadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trechos_tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ligacoes_tag_viagem" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "passagemAncoraId" TEXT NOT NULL,
    "viagemId" TEXT,
    "tipo" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "autorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "desfeitaEm" TIMESTAMP(3),
    "desfeitaPorId" TEXT,
    "desfeitaMotivo" TEXT,

    CONSTRAINT "ligacoes_tag_viagem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achados_tag" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "caixa" TEXT NOT NULL,
    "extratoId" TEXT,
    "placaTexto" TEXT,
    "veiculoId" TEXT,
    "passagemAncoraId" TEXT,
    "passagemIds" TEXT[],
    "valor" DECIMAL(12,2),
    "titulo" TEXT NOT NULL,
    "explicacao" TEXT NOT NULL,
    "explicacoes" JSONB,
    "evidencia" JSONB,
    "prazoEm" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ABERTO',
    "motivo" TEXT,
    "decididoPorId" TEXT,
    "decididoEm" TIMESTAMP(3),
    "vigente" BOOLEAN NOT NULL DEFAULT true,
    "calculadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "achados_tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "respostas_carga_tag" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "passagemAncoraId" TEXT NOT NULL,
    "resposta" TEXT NOT NULL,
    "empresaId" TEXT,
    "comprovante" TEXT,
    "observacao" TEXT,
    "autorId" TEXT,
    "respondidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "respostas_carga_tag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "extratos_tag_contaId_importadoEm_idx" ON "extratos_tag"("contaId", "importadoEm");

-- CreateIndex
CREATE INDEX "extratos_tag_contaId_operadora_numeroFatura_idx" ON "extratos_tag"("contaId", "operadora", "numeroFatura");

-- CreateIndex
CREATE UNIQUE INDEX "extratos_tag_contaId_hashArquivo_key" ON "extratos_tag"("contaId", "hashArquivo");

-- CreateIndex
CREATE INDEX "extratos_tag_veiculos_contaId_placaTexto_idx" ON "extratos_tag_veiculos"("contaId", "placaTexto");

-- CreateIndex
CREATE UNIQUE INDEX "extratos_tag_veiculos_extratoId_placaTexto_key" ON "extratos_tag_veiculos"("extratoId", "placaTexto");

-- CreateIndex
CREATE INDEX "passagens_tag_contaId_chave_idx" ON "passagens_tag"("contaId", "chave");

-- CreateIndex
CREATE INDEX "passagens_tag_contaId_placaTexto_ocorridoEm_idx" ON "passagens_tag"("contaId", "placaTexto", "ocorridoEm");

-- CreateIndex
CREATE INDEX "passagens_tag_veiculoId_ocorridoEm_idx" ON "passagens_tag"("veiculoId", "ocorridoEm");

-- CreateIndex
CREATE UNIQUE INDEX "passagens_tag_extratoId_chave_key" ON "passagens_tag"("extratoId", "chave");

-- CreateIndex
CREATE UNIQUE INDEX "pracas_tag_de_para_operadora_chavePraca_key" ON "pracas_tag_de_para"("operadora", "chavePraca");

-- CreateIndex
CREATE UNIQUE INDEX "pracas_tag_de_para_conta_contaId_operadora_chavePraca_key" ON "pracas_tag_de_para_conta"("contaId", "operadora", "chavePraca");

-- CreateIndex
CREATE INDEX "trechos_tag_contaId_placaTexto_ini_idx" ON "trechos_tag"("contaId", "placaTexto", "ini");

-- CreateIndex
CREATE UNIQUE INDEX "trechos_tag_contaId_passagemAncoraId_key" ON "trechos_tag"("contaId", "passagemAncoraId");

-- CreateIndex
CREATE INDEX "ligacoes_tag_viagem_contaId_passagemAncoraId_idx" ON "ligacoes_tag_viagem"("contaId", "passagemAncoraId");

-- CreateIndex
CREATE INDEX "ligacoes_tag_viagem_viagemId_idx" ON "ligacoes_tag_viagem"("viagemId");

-- CreateIndex
CREATE INDEX "achados_tag_contaId_caixa_vigente_idx" ON "achados_tag"("contaId", "caixa", "vigente");

-- CreateIndex
CREATE UNIQUE INDEX "achados_tag_contaId_chave_key" ON "achados_tag"("contaId", "chave");

-- CreateIndex
CREATE UNIQUE INDEX "respostas_carga_tag_contaId_passagemAncoraId_key" ON "respostas_carga_tag"("contaId", "passagemAncoraId");

-- AddForeignKey
ALTER TABLE "extratos_tag" ADD CONSTRAINT "extratos_tag_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extratos_tag" ADD CONSTRAINT "extratos_tag_importadoPorId_fkey" FOREIGN KEY ("importadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extratos_tag_veiculos" ADD CONSTRAINT "extratos_tag_veiculos_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extratos_tag_veiculos" ADD CONSTRAINT "extratos_tag_veiculos_extratoId_fkey" FOREIGN KEY ("extratoId") REFERENCES "extratos_tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extratos_tag_veiculos" ADD CONSTRAINT "extratos_tag_veiculos_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "veiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passagens_tag" ADD CONSTRAINT "passagens_tag_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passagens_tag" ADD CONSTRAINT "passagens_tag_extratoId_fkey" FOREIGN KEY ("extratoId") REFERENCES "extratos_tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passagens_tag" ADD CONSTRAINT "passagens_tag_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "veiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pracas_tag_de_para" ADD CONSTRAINT "pracas_tag_de_para_pedagioRodoviaId_fkey" FOREIGN KEY ("pedagioRodoviaId") REFERENCES "pedagios_rodovia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pracas_tag_de_para_conta" ADD CONSTRAINT "pracas_tag_de_para_conta_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pracas_tag_de_para_conta" ADD CONSTRAINT "pracas_tag_de_para_conta_pedagioRodoviaId_fkey" FOREIGN KEY ("pedagioRodoviaId") REFERENCES "pedagios_rodovia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trechos_tag" ADD CONSTRAINT "trechos_tag_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ligacoes_tag_viagem" ADD CONSTRAINT "ligacoes_tag_viagem_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ligacoes_tag_viagem" ADD CONSTRAINT "ligacoes_tag_viagem_viagemId_fkey" FOREIGN KEY ("viagemId") REFERENCES "viagens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achados_tag" ADD CONSTRAINT "achados_tag_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "respostas_carga_tag" ADD CONSTRAINT "respostas_carga_tag_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "respostas_carga_tag" ADD CONSTRAINT "respostas_carga_tag_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

