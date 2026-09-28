-- Onde começa a conversa atual: o robô não lê nada antes disto.
ALTER TABLE "leads" ADD COLUMN "cicloIniciadoEm" TIMESTAMP(3);
