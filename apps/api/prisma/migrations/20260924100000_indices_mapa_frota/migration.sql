-- Mapa da frota: a última posição de cada motorista desde X, por capturadoEm
-- OU recebidoEm. Sem índice que comece pela conta em cada coluna, o OR fazia o
-- Postgres ler todas as posições da empresa (até 90 dias, ~500 mil linhas) —
-- 3,4s medidos na primeira abertura. Com os dois, ele junta (BitmapOr) e lê só
-- a janela: ~7.700 páginas → ~70 no teste.
CREATE INDEX IF NOT EXISTS "motorista_posicoes_contaId_capturadoEm_idx" ON "motorista_posicoes"("contaId", "capturadoEm");
CREATE INDEX IF NOT EXISTS "motorista_posicoes_contaId_recebidoEm_idx" ON "motorista_posicoes"("contaId", "recebidoEm");
