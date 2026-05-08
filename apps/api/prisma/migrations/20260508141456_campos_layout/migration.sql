-- CreateTable: campos disponíveis pra mapear no layout de importação
CREATE TABLE "campos_layout" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 100,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "sistema" BOOLEAN NOT NULL DEFAULT false,
    "tipo" TEXT NOT NULL DEFAULT 'TEXTO',
    "descricao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campos_layout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campos_layout_slug_key" ON "campos_layout"("slug");

-- CreateIndex
CREATE INDEX "campos_layout_ativo_ordem_idx" ON "campos_layout"("ativo", "ordem");
