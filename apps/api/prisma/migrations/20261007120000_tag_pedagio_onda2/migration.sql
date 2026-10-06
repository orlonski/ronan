-- AlterTable
ALTER TABLE "itens_acerto" ADD COLUMN     "decisaoPedagioTagId" TEXT;

-- CreateTable
CREATE TABLE "decisoes_pedagio_tag" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "viagemId" TEXT NOT NULL,
    "valorLancado" DECIMAL(12,2) NOT NULL,
    "valorTag" DECIMAL(12,2) NOT NULL,
    "valorReembolso" DECIMAL(12,2) NOT NULL,
    "motivo" TEXT,
    "acertoId" TEXT,
    "decididoPorId" TEXT,
    "decididoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decisoes_pedagio_tag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "decisoes_pedagio_tag_contaId_idx" ON "decisoes_pedagio_tag"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "decisoes_pedagio_tag_contaId_viagemId_key" ON "decisoes_pedagio_tag"("contaId", "viagemId");

-- AddForeignKey
ALTER TABLE "itens_acerto" ADD CONSTRAINT "itens_acerto_decisaoPedagioTagId_fkey" FOREIGN KEY ("decisaoPedagioTagId") REFERENCES "decisoes_pedagio_tag"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisoes_pedagio_tag" ADD CONSTRAINT "decisoes_pedagio_tag_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisoes_pedagio_tag" ADD CONSTRAINT "decisoes_pedagio_tag_viagemId_fkey" FOREIGN KEY ("viagemId") REFERENCES "viagens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisoes_pedagio_tag" ADD CONSTRAINT "decisoes_pedagio_tag_decididoPorId_fkey" FOREIGN KEY ("decididoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

