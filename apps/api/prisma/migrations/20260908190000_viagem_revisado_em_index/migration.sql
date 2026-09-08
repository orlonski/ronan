-- Índice pro histórico de tempo de conferência (admin/relatorios/conferencia),
-- que filtra viagens por `revisadoEm` dentro da conta ao longo de meses. Sem
-- ele a tela faz seq scan na tabela inteira de viagens a cada troca de período.
CREATE INDEX IF NOT EXISTS "viagens_contaId_revisadoEm_idx" ON "viagens"("contaId", "revisadoEm");
