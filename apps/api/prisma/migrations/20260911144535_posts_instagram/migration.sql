-- Fila de posts do Instagram do @movatruck (ferramenta da plataforma).
--
-- Gerada por `migrate diff` contra o banco, porque `migrate dev` queria resetar:
-- uma migration antiga não recria limpa no shadow database. O diff trouxe junto
-- um `DROP COLUMN` na tabela leads, que é drift do banco local e NÃO tem nada a
-- ver com esta mudança — removido à mão. Conferir com `git show --stat` que este
-- arquivo entrou: pasta vazia o git ignora em silêncio.

-- CreateEnum
CREATE TYPE "StatusPostInstagram" AS ENUM ('RASCUNHO', 'AGENDADO', 'PUBLICANDO', 'PUBLICADO', 'FALHOU', 'CANCELADO', 'INDETERMINADO', 'DESCARTADA');

-- AlterTable
ALTER TABLE "configuracao_plataforma" ADD COLUMN     "instagramAtivo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "instagramMaxPorDia" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "posts_instagram" (
    "id" TEXT NOT NULL,
    "peca" TEXT NOT NULL,
    "legenda" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "arteToken" TEXT NOT NULL,
    "arteExpiraEm" TIMESTAMP(3) NOT NULL,
    "status" "StatusPostInstagram" NOT NULL DEFAULT 'RASCUNHO',
    "publicarEm" TIMESTAMP(3),
    "postAtivo" TEXT,
    "containerId" TEXT,
    "mediaId" TEXT,
    "permalink" TEXT,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proximaTentativaEm" TIMESTAMP(3),
    "workerId" TEXT,
    "reivindicadoEm" TIMESTAMP(3),
    "iniciadoEm" TIMESTAMP(3),
    "publicadoEm" TIMESTAMP(3),
    "erroCodigo" INTEGER,
    "erro" TEXT,
    "avisadoEm" TIMESTAMP(3),
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posts_instagram_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "posts_instagram_arteToken_key" ON "posts_instagram"("arteToken");

-- CreateIndex
CREATE UNIQUE INDEX "posts_instagram_postAtivo_key" ON "posts_instagram"("postAtivo");

-- CreateIndex
CREATE INDEX "posts_instagram_status_publicarEm_idx" ON "posts_instagram"("status", "publicarEm");

-- CreateIndex
CREATE INDEX "posts_instagram_status_proximaTentativaEm_idx" ON "posts_instagram"("status", "proximaTentativaEm");

-- CreateIndex
CREATE INDEX "posts_instagram_publicadoEm_idx" ON "posts_instagram"("publicadoEm" DESC);

-- AddForeignKey
ALTER TABLE "posts_instagram" ADD CONSTRAINT "posts_instagram_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

