-- O teste guiado pelo robô comercial: a conta criada pelo lead e as etapas.
ALTER TABLE "leads" ADD COLUMN "contaId" TEXT;
ALTER TABLE "leads" ADD COLUMN "testeOferecidoEm" TIMESTAMP(3);
ALTER TABLE "leads" ADD COLUMN "testeGuiaEm" TIMESTAMP(3);
ALTER TABLE "leads" ADD COLUMN "testeLembreteEm" TIMESTAMP(3);

CREATE INDEX "leads_testeOferecidoEm_idx" ON "leads"("testeOferecidoEm");
