-- Papéis-modelo publicados pela plataforma, pra empresa copiar em vez de montar
-- do zero. GLOBAL de propósito: um modelo não tem dono, existe pra ser copiado.
CREATE TABLE "papeis_modelo" (
    "id"         TEXT NOT NULL,
    "nome"       TEXT NOT NULL,
    "descricao"  TEXT,
    "permissoes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ativo"      BOOLEAN NOT NULL DEFAULT true,
    "criadoEm"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "papeis_modelo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "papeis_modelo_nome_key" ON "papeis_modelo"("nome");

-- De qual modelo o papel veio. Só telemetria — a autorização nunca lê isto, e
-- por isso `ON DELETE SET NULL`: apagar o modelo não pode mexer em quem copiou.
ALTER TABLE "papeis" ADD COLUMN "modeloId" TEXT;

ALTER TABLE "papeis"
  ADD CONSTRAINT "papeis_modeloId_fkey"
  FOREIGN KEY ("modeloId") REFERENCES "papeis_modelo"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- O teto de cada empresa: o que o administrador dela pode conceder. Vazio = o
-- padrão do código (PERMISSOES_ADMIN_EMPRESA), que é como todas nascem — então
-- esta migration não muda o comportamento de ninguém.
ALTER TABLE "contas"
  ADD COLUMN "permissoesPermitidas" TEXT[] DEFAULT ARRAY[]::TEXT[];
