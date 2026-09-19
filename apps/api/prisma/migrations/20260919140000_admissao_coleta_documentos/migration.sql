-- CreateTable
CREATE TABLE "documentos_exigidos" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "empresaId" TEXT,
    "titulo" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "obrigatorio" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documentos_exigidos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "convites_coleta" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "motoristaId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "criadoPorId" TEXT,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "revogadoEm" TIMESTAMP(3),
    "visualizacoes" INTEGER NOT NULL DEFAULT 0,
    "primeiroAcessoEm" TIMESTAMP(3),
    "ultimoAcessoEm" TIMESTAMP(3),
    "ultimoAcessoIp" TEXT,
    "enviosFeitos" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "convites_coleta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "documentos_exigidos_contaId_ativo_idx" ON "documentos_exigidos"("contaId", "ativo");

-- CreateIndex
CREATE INDEX "documentos_exigidos_empresaId_idx" ON "documentos_exigidos"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "convites_coleta_token_key" ON "convites_coleta"("token");

-- CreateIndex
CREATE INDEX "convites_coleta_motoristaId_criadoEm_idx" ON "convites_coleta"("motoristaId", "criadoEm");

-- CreateIndex
CREATE INDEX "convites_coleta_expiraEm_idx" ON "convites_coleta"("expiraEm");

-- CreateIndex
CREATE INDEX "convites_coleta_contaId_idx" ON "convites_coleta"("contaId");

-- AddForeignKey
ALTER TABLE "documentos_exigidos" ADD CONSTRAINT "documentos_exigidos_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos_exigidos" ADD CONSTRAINT "documentos_exigidos_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "convites_coleta" ADD CONSTRAINT "convites_coleta_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "convites_coleta" ADD CONSTRAINT "convites_coleta_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "convites_coleta" ADD CONSTRAINT "convites_coleta_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

