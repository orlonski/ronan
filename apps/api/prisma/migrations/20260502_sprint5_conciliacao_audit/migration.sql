-- CreateEnum
CREATE TYPE "StatusEnvio" AS ENUM ('GERADO', 'ENVIADO');

-- CreateEnum
CREATE TYPE "AcaoAuditoria" AS ENUM ('UPDATE', 'DELETE', 'RESOLVER', 'SUBSTITUIR', 'EXPORTAR', 'MARCAR_ENVIADO', 'MATCH_AUTOMATICO', 'MATCH_IA');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StatusFechamento" ADD VALUE 'RECEBIDO';
ALTER TYPE "StatusFechamento" ADD VALUE 'EM_PROCESSAMENTO';
ALTER TYPE "StatusFechamento" ADD VALUE 'CONFERIDO';
ALTER TYPE "StatusFechamento" ADD VALUE 'EXPORTADO';
ALTER TYPE "StatusFechamento" ADD VALUE 'SUBSTITUIDO';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StatusLinhaFechamento" ADD VALUE 'MATCH_IA';
ALTER TYPE "StatusLinhaFechamento" ADD VALUE 'RESOLVIDA_OPERADORA';

-- AlterEnum
ALTER TYPE "StatusViagem" ADD VALUE 'AJUSTADA';

-- AlterTable
ALTER TABLE "empresas_cliente" DROP COLUMN "layoutExport";

-- AlterTable
ALTER TABLE "fechamento_linhas" ADD COLUMN     "materialTexto" TEXT,
ADD COLUMN     "motivoResolucao" TEXT,
ADD COLUMN     "obraTexto" TEXT,
ADD COLUMN     "ordem" INTEGER NOT NULL,
ADD COLUMN     "rawData" JSONB NOT NULL,
ADD COLUMN     "resolvidoPorId" TEXT,
ADD COLUMN     "sugestaoIa" JSONB,
ADD COLUMN     "toneladas" DECIMAL(10,3),
ALTER COLUMN "placa" DROP NOT NULL,
ALTER COLUMN "data" DROP NOT NULL,
ALTER COLUMN "ticket" DROP NOT NULL;

-- AlterTable
ALTER TABLE "fechamentos" ADD COLUMN     "arquivoMimetype" TEXT,
ADD COLUMN     "arquivoOriginalNome" TEXT,
ADD COLUMN     "layoutSalvo" JSONB,
ADD COLUMN     "resumoIa" JSONB,
ADD COLUMN     "substituidoPorId" TEXT,
ADD COLUMN     "versao" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "status" SET DEFAULT 'RECEBIDO';

-- CreateTable
CREATE TABLE "layouts_envio" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "colunas" JSONB NOT NULL,
    "config" JSONB,
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "layouts_envio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "envios_fechamento" (
    "id" TEXT NOT NULL,
    "fechamentoId" TEXT NOT NULL,
    "layoutId" TEXT,
    "arquivoGeradoKey" TEXT NOT NULL,
    "arquivoNome" TEXT NOT NULL,
    "geradoPorId" TEXT,
    "geradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "StatusEnvio" NOT NULL DEFAULT 'GERADO',
    "marcadoEnviadoEm" TIMESTAMP(3),
    "canalEnvio" TEXT,
    "observacao" TEXT,

    CONSTRAINT "envios_fechamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT,
    "entidade" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "acao" "AcaoAuditoria" NOT NULL,
    "campo" TEXT,
    "valorAntes" JSONB,
    "valorDepois" JSONB,
    "motivo" TEXT,
    "metadata" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "layouts_envio_empresaId_idx" ON "layouts_envio"("empresaId");

-- CreateIndex
CREATE INDEX "envios_fechamento_fechamentoId_idx" ON "envios_fechamento"("fechamentoId");

-- CreateIndex
CREATE INDEX "audit_logs_entidade_entidadeId_idx" ON "audit_logs"("entidade", "entidadeId");

-- CreateIndex
CREATE INDEX "audit_logs_usuarioId_criadoEm_idx" ON "audit_logs"("usuarioId", "criadoEm");

-- CreateIndex
CREATE INDEX "fechamento_linhas_viagemMatchId_idx" ON "fechamento_linhas"("viagemMatchId");

-- CreateIndex
CREATE INDEX "fechamentos_status_idx" ON "fechamentos"("status");

-- CreateIndex
CREATE INDEX "viagens_veiculoId_data_ticket_idx" ON "viagens"("veiculoId", "data", "ticket");

-- AddForeignKey
ALTER TABLE "fechamentos" ADD CONSTRAINT "fechamentos_substituidoPorId_fkey" FOREIGN KEY ("substituidoPorId") REFERENCES "fechamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fechamento_linhas" ADD CONSTRAINT "fechamento_linhas_resolvidoPorId_fkey" FOREIGN KEY ("resolvidoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layouts_envio" ADD CONSTRAINT "layouts_envio_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas_cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layouts_envio" ADD CONSTRAINT "layouts_envio_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envios_fechamento" ADD CONSTRAINT "envios_fechamento_fechamentoId_fkey" FOREIGN KEY ("fechamentoId") REFERENCES "fechamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envios_fechamento" ADD CONSTRAINT "envios_fechamento_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "layouts_envio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envios_fechamento" ADD CONSTRAINT "envios_fechamento_geradoPorId_fkey" FOREIGN KEY ("geradoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

