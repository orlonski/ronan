-- CreateTable
CREATE TABLE "permissoes" (
    "chave" TEXT NOT NULL,
    "modulo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 100,
    "sistema" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "permissoes_pkey" PRIMARY KEY ("chave")
);

-- CreateIndex
CREATE INDEX "permissoes_modulo_ordem_idx" ON "permissoes"("modulo", "ordem");

-- CreateTable
CREATE TABLE "papeis" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "permissoes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sistema" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "papeis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "papeis_nome_key" ON "papeis"("nome");

-- AlterTable
ALTER TABLE "users" ADD COLUMN "papelId" TEXT;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_papelId_fkey" FOREIGN KEY ("papelId") REFERENCES "papeis"("id") ON DELETE SET NULL ON UPDATE CASCADE;
