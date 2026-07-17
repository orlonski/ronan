-- Chat por viagem (admin <-> motorista). Cada mensagem tem autor (dois lados
-- possiveis, motorista nao e User), nome snapshot, texto, acao opcional e data.
-- Escrita a mao pra nao arrastar o drift de FK/coluna pre-existente do schema.

-- CreateEnum
CREATE TYPE "AutorMensagem" AS ENUM ('ADMIN', 'MOTORISTA');

-- CreateTable
CREATE TABLE "viagem_mensagens" (
    "id" TEXT NOT NULL,
    "viagemId" TEXT NOT NULL,
    "autor" "AutorMensagem" NOT NULL,
    "usuarioId" TEXT,
    "motoristaId" TEXT,
    "autorNome" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "acao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "viagem_mensagens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "viagem_mensagens_viagemId_criadoEm_idx" ON "viagem_mensagens"("viagemId", "criadoEm");

-- AddForeignKey
ALTER TABLE "viagem_mensagens" ADD CONSTRAINT "viagem_mensagens_viagemId_fkey" FOREIGN KEY ("viagemId") REFERENCES "viagens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viagem_mensagens" ADD CONSTRAINT "viagem_mensagens_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viagem_mensagens" ADD CONSTRAINT "viagem_mensagens_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
