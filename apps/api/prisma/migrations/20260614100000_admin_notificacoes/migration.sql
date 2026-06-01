-- Caixa de entrada do admin no dashboard. Fan-out: 1 linha por admin ativo
-- quando algo relevante acontece. Sininho no topo le esta tabela.
CREATE TABLE "admin_notificacoes" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "corpo" TEXT NOT NULL,
    "dados" JSONB,
    "lida" BOOLEAN NOT NULL DEFAULT false,
    "lidaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_notificacoes_pkey" PRIMARY KEY ("id")
);

-- Filtro principal: notificacoes nao-lidas do user, ordenadas por data.
CREATE INDEX "admin_notificacoes_usuarioId_lida_criadoEm_idx"
  ON "admin_notificacoes"("usuarioId", "lida", "criadoEm");

-- Cleanup global por data (job futuro de retencao).
CREATE INDEX "admin_notificacoes_criadoEm_idx"
  ON "admin_notificacoes"("criadoEm");

-- FK pra user com cascade: user deletado -> notificacoes vao junto.
ALTER TABLE "admin_notificacoes"
  ADD CONSTRAINT "admin_notificacoes_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
