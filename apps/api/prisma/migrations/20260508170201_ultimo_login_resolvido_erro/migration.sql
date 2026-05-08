-- AlterTable: campo de último login no admin/operador
ALTER TABLE "users" ADD COLUMN "ultimoLoginEm" TIMESTAMP(3);

-- AlterTable: marcar erro como corrigido
ALTER TABLE "error_logs" ADD COLUMN "resolvido" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "error_logs" ADD COLUMN "resolvidoEm" TIMESTAMP(3);
ALTER TABLE "error_logs" ADD COLUMN "resolvidoPorId" TEXT;

-- Índice pra filtro "pendentes vs resolvidos" ordenado por capturadoEm
CREATE INDEX "error_logs_resolvido_capturadoEm_idx" ON "error_logs"("resolvido", "capturadoEm");
