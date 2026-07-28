-- Transportadora (a frota dona dos caminhões/motoristas) + escopo de acesso por
-- usuário. NÃO confundir com Empresa, que é o tomador de serviço.
--
-- Nada é enforçado por esta migration: todas as colunas nascem nullable e
-- `users.acessoGlobal` nasce true, então o comportamento atual do painel
-- (todo mundo vê tudo) fica idêntico até o escopo ser ligado usuário a usuário.

-- CreateTable
CREATE TABLE "transportadoras" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cnpj" TEXT,
    "contato" TEXT,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    "criadoPorId" TEXT,

    CONSTRAINT "transportadoras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuario_transportadoras" (
    "usuarioId" TEXT NOT NULL,
    "transportadoraId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuario_transportadoras_pkey" PRIMARY KEY ("usuarioId","transportadoraId")
);

-- CreateIndex
CREATE UNIQUE INDEX "transportadoras_cnpj_key" ON "transportadoras"("cnpj");

-- CreateIndex
CREATE INDEX "transportadoras_ativa_idx" ON "transportadoras"("ativa");

-- CreateIndex
CREATE INDEX "usuario_transportadoras_transportadoraId_idx" ON "usuario_transportadoras"("transportadoraId");

-- AlterTable: acessoGlobal=true preserva o acesso de todos os usuários atuais.
ALTER TABLE "users" ADD COLUMN "acessoGlobal" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable: dono do cadastro (classificado pelo admin na tela).
ALTER TABLE "motoristas" ADD COLUMN "transportadoraId" TEXT;
ALTER TABLE "veiculos" ADD COLUMN "transportadoraId" TEXT;

-- AlterTable: carimbo do lançamento, preenchido na criação. Desnormalizado de
-- propósito pra que reclassificar um motorista não mova o histórico dele.
ALTER TABLE "viagens" ADD COLUMN "transportadoraId" TEXT;
ALTER TABLE "pedagios" ADD COLUMN "transportadoraId" TEXT;
ALTER TABLE "abastecimentos" ADD COLUMN "transportadoraId" TEXT;

-- CreateIndex
CREATE INDEX "motoristas_transportadoraId_idx" ON "motoristas"("transportadoraId");
CREATE INDEX "veiculos_transportadoraId_idx" ON "veiculos"("transportadoraId");
CREATE INDEX "viagens_transportadoraId_data_idx" ON "viagens"("transportadoraId", "data");
CREATE INDEX "pedagios_transportadoraId_data_idx" ON "pedagios"("transportadoraId", "data");
CREATE INDEX "abastecimentos_transportadoraId_data_idx" ON "abastecimentos"("transportadoraId", "data");

-- AddForeignKey
ALTER TABLE "transportadoras" ADD CONSTRAINT "transportadoras_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "usuario_transportadoras" ADD CONSTRAINT "usuario_transportadoras_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "usuario_transportadoras" ADD CONSTRAINT "usuario_transportadoras_transportadoraId_fkey" FOREIGN KEY ("transportadoraId") REFERENCES "transportadoras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "motoristas" ADD CONSTRAINT "motoristas_transportadoraId_fkey" FOREIGN KEY ("transportadoraId") REFERENCES "transportadoras"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "veiculos" ADD CONSTRAINT "veiculos_transportadoraId_fkey" FOREIGN KEY ("transportadoraId") REFERENCES "transportadoras"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "viagens" ADD CONSTRAINT "viagens_transportadoraId_fkey" FOREIGN KEY ("transportadoraId") REFERENCES "transportadoras"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pedagios" ADD CONSTRAINT "pedagios_transportadoraId_fkey" FOREIGN KEY ("transportadoraId") REFERENCES "transportadoras"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "abastecimentos" ADD CONSTRAINT "abastecimentos_transportadoraId_fkey" FOREIGN KEY ("transportadoraId") REFERENCES "transportadoras"("id") ON DELETE SET NULL ON UPDATE CASCADE;
