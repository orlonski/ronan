-- CreateEnum
CREATE TYPE "VinculoApp" AS ENUM ('QUALQUER', 'MOTORISTA', 'FUNCIONARIO');

-- CreateEnum
CREATE TYPE "CondicaoRegime" AS ENUM ('QUALQUER', 'PARCEIRO', 'EMPREGADO', 'NAO_DECLARADO');

-- CreateEnum
CREATE TYPE "EfeitoExcecaoAcesso" AS ENUM ('CONCEDER', 'NEGAR');

-- CreateEnum
CREATE TYPE "FonteAcessoApp" AS ENUM ('COLUNAS', 'REGRAS');

-- AlterTable
ALTER TABLE "contas" ADD COLUMN     "rolloutsApp" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "motoristas" ADD COLUMN     "perfilFixadoMotivo" TEXT;

-- AlterTable
ALTER TABLE "perfis_acesso_app" ADD COLUMN     "capacidades" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "ponto_funcionarios" ADD COLUMN     "perfilAcessoId" TEXT,
ADD COLUMN     "perfilFixadoMotivo" TEXT;

-- CreateTable
CREATE TABLE "regras_acesso_app" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "ordem" INTEGER NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "vinculo" "VinculoApp" NOT NULL DEFAULT 'QUALQUER',
    "regime" "CondicaoRegime" NOT NULL DEFAULT 'QUALQUER',
    "modalidadeId" TEXT,
    "transportadoraId" TEXT,
    "perfilId" TEXT NOT NULL,
    "criadoPorId" TEXT,
    "alteradoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regras_acesso_app_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracao_acesso_app" (
    "contaId" TEXT NOT NULL,
    "fonte" "FonteAcessoApp" NOT NULL DEFAULT 'COLUNAS',
    "perfilPadraoMotoristaId" TEXT,
    "perfilPadraoFuncionarioId" TEXT,
    "camadasEmSombra" TEXT[] DEFAULT ARRAY['DEPENDENCIA', 'REGIME', 'PLATAFORMA', 'CONTRATO']::TEXT[],
    "versao" INTEGER NOT NULL DEFAULT 1,
    "espelhadoEm" TIMESTAMP(3),
    "espelhoDivergencias" INTEGER,
    "espelhoDetalhe" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracao_acesso_app_pkey" PRIMARY KEY ("contaId")
);

-- CreateTable
CREATE TABLE "excecoes_acesso_app" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "cpf" TEXT NOT NULL,
    "capacidade" TEXT NOT NULL,
    "efeito" "EfeitoExcecaoAcesso" NOT NULL,
    "motivo" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3),
    "origem" TEXT NOT NULL DEFAULT 'MANUAL',
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revogadaEm" TIMESTAMP(3),
    "revogadaPorId" TEXT,
    "motivoRevogacao" TEXT,
    "chaveViva" TEXT,

    CONSTRAINT "excecoes_acesso_app_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acessos_efetivos_app" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "cpf" TEXT NOT NULL,
    "motoristaId" TEXT,
    "funcionarioId" TEXT,
    "capacidades" TEXT[],
    "capacidadesSombra" TEXT[],
    "explicacao" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "proximaMudanca" TIMESTAMP(3),
    "calculadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "acessos_efetivos_app_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_acesso_app" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "tipo" TEXT NOT NULL,
    "cpf" TEXT,
    "alvoId" TEXT,
    "ganhou" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "perdeu" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "causa" TEXT,
    "motivo" TEXT,
    "autorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_acesso_app_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "regras_acesso_app_contaId_ordem_idx" ON "regras_acesso_app"("contaId", "ordem");

-- CreateIndex
CREATE INDEX "excecoes_acesso_app_contaId_cpf_idx" ON "excecoes_acesso_app"("contaId", "cpf");

-- CreateIndex
CREATE UNIQUE INDEX "excecoes_acesso_app_contaId_chaveViva_key" ON "excecoes_acesso_app"("contaId", "chaveViva");

-- CreateIndex
CREATE UNIQUE INDEX "acessos_efetivos_app_motoristaId_key" ON "acessos_efetivos_app"("motoristaId");

-- CreateIndex
CREATE UNIQUE INDEX "acessos_efetivos_app_funcionarioId_key" ON "acessos_efetivos_app"("funcionarioId");

-- CreateIndex
CREATE INDEX "acessos_efetivos_app_contaId_idx" ON "acessos_efetivos_app"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "acessos_efetivos_app_contaId_cpf_key" ON "acessos_efetivos_app"("contaId", "cpf");

-- CreateIndex
CREATE INDEX "log_acesso_app_contaId_cpf_criadoEm_idx" ON "log_acesso_app"("contaId", "cpf", "criadoEm");

-- CreateIndex
CREATE INDEX "ponto_funcionarios_perfilAcessoId_idx" ON "ponto_funcionarios"("perfilAcessoId");

-- AddForeignKey
ALTER TABLE "regras_acesso_app" ADD CONSTRAINT "regras_acesso_app_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regras_acesso_app" ADD CONSTRAINT "regras_acesso_app_perfilId_fkey" FOREIGN KEY ("perfilId") REFERENCES "perfis_acesso_app"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracao_acesso_app" ADD CONSTRAINT "configuracao_acesso_app_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracao_acesso_app" ADD CONSTRAINT "configuracao_acesso_app_perfilPadraoMotoristaId_fkey" FOREIGN KEY ("perfilPadraoMotoristaId") REFERENCES "perfis_acesso_app"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracao_acesso_app" ADD CONSTRAINT "configuracao_acesso_app_perfilPadraoFuncionarioId_fkey" FOREIGN KEY ("perfilPadraoFuncionarioId") REFERENCES "perfis_acesso_app"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "excecoes_acesso_app" ADD CONSTRAINT "excecoes_acesso_app_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acessos_efetivos_app" ADD CONSTRAINT "acessos_efetivos_app_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acessos_efetivos_app" ADD CONSTRAINT "acessos_efetivos_app_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acessos_efetivos_app" ADD CONSTRAINT "acessos_efetivos_app_funcionarioId_fkey" FOREIGN KEY ("funcionarioId") REFERENCES "ponto_funcionarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_acesso_app" ADD CONSTRAINT "log_acesso_app_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ponto_funcionarios" ADD CONSTRAINT "ponto_funcionarios_perfilAcessoId_fkey" FOREIGN KEY ("perfilAcessoId") REFERENCES "perfis_acesso_app"("id") ON DELETE SET NULL ON UPDATE CASCADE;

