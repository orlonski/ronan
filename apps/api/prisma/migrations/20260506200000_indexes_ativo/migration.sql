-- Indexes em flags boolean usadas em filtros do /m/catalogos.
-- Sem isso, cada chamada faz full table scan.

CREATE INDEX "veiculos_ativo_idx" ON "veiculos"("ativo");
CREATE INDEX "obras_ativa_idx" ON "obras"("ativa");
CREATE INDEX "materiais_ativo_idx" ON "materiais"("ativo");
CREATE INDEX "locais_ativo_idx" ON "locais"("ativo");
