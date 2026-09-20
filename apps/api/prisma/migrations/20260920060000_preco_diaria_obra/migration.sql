-- AlterEnum
ALTER TYPE "BasePreco" ADD VALUE 'DIARIA_OBRA';

-- AlterTable
ALTER TABLE "itens_acerto" ADD COLUMN     "registroPresencaId" TEXT;

-- CreateIndex
CREATE INDEX "itens_acerto_registroPresencaId_idx" ON "itens_acerto"("registroPresencaId");

-- AddForeignKey
ALTER TABLE "itens_acerto" ADD CONSTRAINT "itens_acerto_registroPresencaId_fkey" FOREIGN KEY ("registroPresencaId") REFERENCES "registros_presenca"("id") ON DELETE SET NULL ON UPDATE CASCADE;

