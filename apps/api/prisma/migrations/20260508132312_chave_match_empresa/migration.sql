-- AlterTable: chave de match e tolerâncias por empresa
ALTER TABLE "empresas_cliente" ADD COLUMN "chaveMatch" JSONB;
ALTER TABLE "empresas_cliente" ADD COLUMN "toleranciaKmPct" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "empresas_cliente" ADD COLUMN "toleranciaTonPct" INTEGER NOT NULL DEFAULT 0;
