-- CreateTable
CREATE TABLE "config_mensal_contratante" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "diaCorte" INTEGER NOT NULL DEFAULT 20,
    "diasEsperadosSemana" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[],
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "config_mensal_contratante_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "config_mensal_contratante_empresaId_key" ON "config_mensal_contratante"("empresaId");

-- CreateIndex
CREATE INDEX "config_mensal_contratante_contaId_idx" ON "config_mensal_contratante"("contaId");

-- AddForeignKey
ALTER TABLE "config_mensal_contratante" ADD CONSTRAINT "config_mensal_contratante_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config_mensal_contratante" ADD CONSTRAINT "config_mensal_contratante_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

