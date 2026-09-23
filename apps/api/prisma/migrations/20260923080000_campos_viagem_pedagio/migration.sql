-- "Mostrar o pedágio" por modo de serviço (tela "Campos da viagem no app").
-- Default true: toda conta segue vendo o pedágio exatamente como antes.
ALTER TABLE "tipos_servico" ADD COLUMN IF NOT EXISTS "mostraPedagio" BOOLEAN NOT NULL DEFAULT true;
