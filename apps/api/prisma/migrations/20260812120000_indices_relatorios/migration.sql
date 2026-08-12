-- Índices que o relatório de produção por período precisa (tela /relatorios).
--
-- ESCRITA À MÃO: o banco de dev tem drift antigo de `db push` em índices e nas
-- FKs de `viagens` (mesma observação das migrations 20260717120000,
-- 20260726210000 e 20260805120000). Um `migrate dev` arrastaria esse drift pra
-- cá; esta migration contém APENAS os índices.
--
-- NÃO usar CREATE INDEX CONCURRENTLY: o `prisma migrate deploy` roda cada
-- migration dentro de uma transação e CONCURRENTLY é proibido em transação
-- (25001). O CREATE INDEX comum pega SHARE lock e bloqueia ESCRITA em "viagens"
-- enquanto constrói — em tabela desse tamanho é ~1s, mas o deploy deve sair
-- fora do pico de lançamento dos motoristas. Se a tabela crescer a ponto de
-- isso doer, criar os índices à mão em produção com CONCURRENTLY ANTES do
-- deploy: o IF NOT EXISTS abaixo vira no-op.

-- Recorte só por período (relatório sem filtro de dimensão). Todos os índices
-- que "viagens" já tinha lideram por outra coluna (transportadoraId,
-- motoristaId, veiculoId, clienteId, localCargaId), então nenhum deles atende
-- um WHERE apenas em data.
CREATE INDEX IF NOT EXISTS "viagens_data_idx" ON "viagens"("data");

-- Agrupar/filtrar por material era a única dimensão do relatório sem índice.
CREATE INDEX IF NOT EXISTS "viagens_materialId_data_idx" ON "viagens"("materialId", "data");

-- Reconciliação de pedágio por motorista no período. "pedagios" tinha
-- (veiculoId, data) e (transportadoraId, data), mas nada por motorista.
CREATE INDEX IF NOT EXISTS "pedagios_motoristaId_data_idx" ON "pedagios"("motoristaId", "data");
