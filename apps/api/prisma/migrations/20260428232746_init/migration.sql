-- CreateEnum
CREATE TYPE "PerfilUsuario" AS ENUM ('ADMIN', 'OPERADOR');

-- CreateEnum
CREATE TYPE "PapelEmpresa" AS ENUM ('RECEBE_PLANILHA', 'MANDA_FECHAMENTO', 'AMBOS');

-- CreateEnum
CREATE TYPE "TipoLocal" AS ENUM ('CARGA', 'DESCARGA', 'AMBOS');

-- CreateEnum
CREATE TYPE "StatusViagem" AS ENUM ('RASCUNHO_OFFLINE', 'ENVIADA', 'EM_CONFERENCIA', 'DIVERGENTE', 'OK');

-- CreateEnum
CREATE TYPE "FonteFechamento" AS ENUM ('UPLOAD', 'MANUAL', 'EMAIL');

-- CreateEnum
CREATE TYPE "StatusFechamento" AS ENUM ('AGUARDANDO_REVISAO', 'EM_CONCILIACAO', 'CONCLUIDO');

-- CreateEnum
CREATE TYPE "StatusLinhaFechamento" AS ENUM ('MATCH', 'DIVERGENCIA', 'FALTANDO', 'EXTRA');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "perfil" "PerfilUsuario" NOT NULL DEFAULT 'OPERADOR',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "motoristas" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "usuario" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "telefone" TEXT,
    "veiculoDefaultId" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ultimoLoginEm" TIMESTAMP(3),
    "tentativasLogin" INTEGER NOT NULL DEFAULT 0,
    "bloqueadoAte" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "motoristas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "veiculos" (
    "id" TEXT NOT NULL,
    "placa" TEXT NOT NULL,
    "modelo" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "veiculos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "empresas_cliente" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cnpj" TEXT,
    "contato" TEXT,
    "papel" "PapelEmpresa" NOT NULL DEFAULT 'AMBOS',
    "layoutImport" JSONB,
    "layoutExport" JSONB,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "empresas_cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obras" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "empresaClienteId" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "obras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materiais" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "materiais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locais" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "logradouro" TEXT NOT NULL,
    "numero" TEXT,
    "bairro" TEXT,
    "cidade" TEXT NOT NULL,
    "uf" CHAR(2) NOT NULL,
    "cep" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "pontoReferencia" TEXT,
    "tipo" "TipoLocal" NOT NULL,
    "obraId" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "locais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "viagens" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "motoristaId" TEXT NOT NULL,
    "veiculoId" TEXT NOT NULL,
    "obraId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "toneladas" DECIMAL(10,3) NOT NULL,
    "ticket" TEXT NOT NULL,
    "km" DECIMAL(10,2) NOT NULL,
    "observacao" TEXT,
    "status" "StatusViagem" NOT NULL DEFAULT 'ENVIADA',
    "localCargaId" TEXT NOT NULL,
    "localDescargaId" TEXT NOT NULL,
    "valorPedagioTotal" DECIMAL(10,2),
    "criadoOfflineEm" TIMESTAMP(3),
    "sincronizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "viagens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_fotos" (
    "id" TEXT NOT NULL,
    "viagemId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "capturadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_fotos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedagios" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "veiculoId" TEXT NOT NULL,
    "motoristaId" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "pracaPedagio" TEXT NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "viagemId" TEXT,
    "criadoOfflineEm" TIMESTAMP(3),
    "sincronizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pedagios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fechamentos" (
    "id" TEXT NOT NULL,
    "empresaClienteId" TEXT NOT NULL,
    "periodoInicio" DATE NOT NULL,
    "periodoFim" DATE NOT NULL,
    "fonte" "FonteFechamento" NOT NULL,
    "arquivoOriginalKey" TEXT,
    "status" "StatusFechamento" NOT NULL DEFAULT 'AGUARDANDO_REVISAO',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fechamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fechamento_linhas" (
    "id" TEXT NOT NULL,
    "fechamentoId" TEXT NOT NULL,
    "placa" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "ticket" TEXT NOT NULL,
    "km" DECIMAL(10,2),
    "valor" DECIMAL(10,2),
    "viagemMatchId" TEXT,
    "status" "StatusLinhaFechamento" NOT NULL,
    "divergencias" JSONB,
    "resolvidoEm" TIMESTAMP(3),

    CONSTRAINT "fechamento_linhas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "motoristas_usuario_key" ON "motoristas"("usuario");

-- CreateIndex
CREATE UNIQUE INDEX "veiculos_placa_key" ON "veiculos"("placa");

-- CreateIndex
CREATE UNIQUE INDEX "empresas_cliente_cnpj_key" ON "empresas_cliente"("cnpj");

-- CreateIndex
CREATE INDEX "obras_empresaClienteId_idx" ON "obras"("empresaClienteId");

-- CreateIndex
CREATE UNIQUE INDEX "materiais_nome_key" ON "materiais"("nome");

-- CreateIndex
CREATE INDEX "locais_obraId_idx" ON "locais"("obraId");

-- CreateIndex
CREATE INDEX "locais_cidade_uf_idx" ON "locais"("cidade", "uf");

-- CreateIndex
CREATE UNIQUE INDEX "viagens_clientId_key" ON "viagens"("clientId");

-- CreateIndex
CREATE INDEX "viagens_motoristaId_data_idx" ON "viagens"("motoristaId", "data");

-- CreateIndex
CREATE INDEX "viagens_veiculoId_data_idx" ON "viagens"("veiculoId", "data");

-- CreateIndex
CREATE INDEX "viagens_obraId_data_idx" ON "viagens"("obraId", "data");

-- CreateIndex
CREATE INDEX "ticket_fotos_viagemId_idx" ON "ticket_fotos"("viagemId");

-- CreateIndex
CREATE UNIQUE INDEX "pedagios_clientId_key" ON "pedagios"("clientId");

-- CreateIndex
CREATE INDEX "pedagios_veiculoId_data_idx" ON "pedagios"("veiculoId", "data");

-- CreateIndex
CREATE INDEX "pedagios_viagemId_idx" ON "pedagios"("viagemId");

-- CreateIndex
CREATE INDEX "fechamentos_empresaClienteId_periodoInicio_idx" ON "fechamentos"("empresaClienteId", "periodoInicio");

-- CreateIndex
CREATE INDEX "fechamento_linhas_fechamentoId_status_idx" ON "fechamento_linhas"("fechamentoId", "status");

-- AddForeignKey
ALTER TABLE "motoristas" ADD CONSTRAINT "motoristas_veiculoDefaultId_fkey" FOREIGN KEY ("veiculoDefaultId") REFERENCES "veiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obras" ADD CONSTRAINT "obras_empresaClienteId_fkey" FOREIGN KEY ("empresaClienteId") REFERENCES "empresas_cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locais" ADD CONSTRAINT "locais_obraId_fkey" FOREIGN KEY ("obraId") REFERENCES "obras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viagens" ADD CONSTRAINT "viagens_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viagens" ADD CONSTRAINT "viagens_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "veiculos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viagens" ADD CONSTRAINT "viagens_obraId_fkey" FOREIGN KEY ("obraId") REFERENCES "obras"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viagens" ADD CONSTRAINT "viagens_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materiais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viagens" ADD CONSTRAINT "viagens_localCargaId_fkey" FOREIGN KEY ("localCargaId") REFERENCES "locais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viagens" ADD CONSTRAINT "viagens_localDescargaId_fkey" FOREIGN KEY ("localDescargaId") REFERENCES "locais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_fotos" ADD CONSTRAINT "ticket_fotos_viagemId_fkey" FOREIGN KEY ("viagemId") REFERENCES "viagens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedagios" ADD CONSTRAINT "pedagios_veiculoId_fkey" FOREIGN KEY ("veiculoId") REFERENCES "veiculos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedagios" ADD CONSTRAINT "pedagios_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedagios" ADD CONSTRAINT "pedagios_viagemId_fkey" FOREIGN KEY ("viagemId") REFERENCES "viagens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fechamentos" ADD CONSTRAINT "fechamentos_empresaClienteId_fkey" FOREIGN KEY ("empresaClienteId") REFERENCES "empresas_cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fechamento_linhas" ADD CONSTRAINT "fechamento_linhas_fechamentoId_fkey" FOREIGN KEY ("fechamentoId") REFERENCES "fechamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fechamento_linhas" ADD CONSTRAINT "fechamento_linhas_viagemMatchId_fkey" FOREIGN KEY ("viagemMatchId") REFERENCES "viagens"("id") ON DELETE SET NULL ON UPDATE CASCADE;
