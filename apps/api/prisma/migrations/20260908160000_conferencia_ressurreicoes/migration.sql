-- Quantas vezes a conferência voltou pra fila depois de ter falhado.
-- Falha de conexão com o provedor não custou leitura nenhuma; o contador é o
-- que permite tentar de novo mais tarde sem virar loop.
ALTER TABLE "conferencias_ticket" ADD COLUMN "ressurreicoes" INTEGER NOT NULL DEFAULT 0;
