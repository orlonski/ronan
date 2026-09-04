-- Aviso do canal com foto + story oficial (publicado pelo painel).

-- Mensagem do chat pode ser uma foto (hoje só no canal de Avisos).
ALTER TYPE "TipoMensagemChat" ADD VALUE IF NOT EXISTS 'FOTO';

ALTER TABLE "mensagens_chat" ADD COLUMN "fotoKey" TEXT;

-- Story deixa de ser sempre de um motorista: o oficial é da transportadora.
ALTER TABLE "stories" ALTER COLUMN "motoristaId" DROP NOT NULL;
ALTER TABLE "stories" ADD COLUMN "oficial" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "stories" ADD COLUMN "usuarioId" TEXT;
ALTER TABLE "stories" ADD COLUMN "autorNome" TEXT;
ALTER TABLE "stories" ADD COLUMN "avisoMensagemId" TEXT;

CREATE UNIQUE INDEX "stories_avisoMensagemId_key" ON "stories"("avisoMensagemId");

ALTER TABLE "stories" ADD CONSTRAINT "stories_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stories" ADD CONSTRAINT "stories_avisoMensagemId_fkey"
  FOREIGN KEY ("avisoMensagemId") REFERENCES "mensagens_chat"("id") ON DELETE SET NULL ON UPDATE CASCADE;
