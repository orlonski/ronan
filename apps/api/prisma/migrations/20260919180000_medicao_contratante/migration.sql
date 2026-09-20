-- CreateTable
CREATE TABLE "medicoes_contratante" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "linhas" JSONB NOT NULL,
    "origem" TEXT NOT NULL DEFAULT 'MANUAL',
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicoes_contratante_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "medicoes_contratante_contaId_competencia_idx" ON "medicoes_contratante"("contaId", "competencia");

-- CreateIndex
CREATE UNIQUE INDEX "medicoes_contratante_empresaId_competencia_key" ON "medicoes_contratante"("empresaId", "competencia");

-- AddForeignKey
ALTER TABLE "medicoes_contratante" ADD CONSTRAINT "medicoes_contratante_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicoes_contratante" ADD CONSTRAINT "medicoes_contratante_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicoes_contratante" ADD CONSTRAINT "medicoes_contratante_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

