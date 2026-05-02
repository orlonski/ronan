-- AlterTable
ALTER TABLE "envios_fechamento" ADD COLUMN     "empresaClienteId" TEXT,
ADD COLUMN     "periodoFim" DATE,
ADD COLUMN     "periodoInicio" DATE,
ADD COLUMN     "totalLinhas" INTEGER,
ALTER COLUMN "fechamentoId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "fechamento_linhas" ALTER COLUMN "ordem" DROP DEFAULT,
ALTER COLUMN "rawData" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "envios_fechamento_empresaClienteId_periodoInicio_idx" ON "envios_fechamento"("empresaClienteId", "periodoInicio");

-- AddForeignKey
ALTER TABLE "envios_fechamento" ADD CONSTRAINT "envios_fechamento_empresaClienteId_fkey" FOREIGN KEY ("empresaClienteId") REFERENCES "empresas_cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

