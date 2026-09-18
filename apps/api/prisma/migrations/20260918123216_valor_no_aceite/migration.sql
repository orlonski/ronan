-- Congela a condição comercial no momento do aceite.
-- Nulo = conta sem assinatura (teste grátis, ou cliente que não paga).
ALTER TABLE "aceites_termo" ADD COLUMN "valorCentavosNoAceite" INTEGER;
ALTER TABLE "aceites_termo" ADD COLUMN "cicloNoAceite" TEXT;
