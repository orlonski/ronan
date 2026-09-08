-- Redefinição de senha para quem não tem empresa nenhuma.
--
-- A senha sempre foi da PESSOA (MotoristaIdentidade), mas o pedido de "esqueci
-- minha senha" só sabia pendurar em Motorista (o vínculo). Quem se cadastrou
-- pelo app e ainda não foi convidado por ninguém recebia "CPF não cadastrado"
-- no próprio CPF e ficava trancado fora da conta pra sempre.
--
-- `contaId` também vira opcional: pedido de identidade não é de empresa
-- nenhuma, e a FK para "contas" recusaria o default '__SEM_CONTA__'.

ALTER TABLE "redefinicoes_senha_pendentes" ALTER COLUMN "motoristaId" DROP NOT NULL;
ALTER TABLE "redefinicoes_senha_pendentes" ALTER COLUMN "contaId" DROP NOT NULL;
ALTER TABLE "redefinicoes_senha_pendentes" ALTER COLUMN "contaId" DROP DEFAULT;

ALTER TABLE "redefinicoes_senha_pendentes" ADD COLUMN "identidadeId" TEXT;

CREATE UNIQUE INDEX "redefinicoes_senha_pendentes_identidadeId_key"
  ON "redefinicoes_senha_pendentes"("identidadeId");

ALTER TABLE "redefinicoes_senha_pendentes"
  ADD CONSTRAINT "redefinicoes_senha_pendentes_identidadeId_fkey"
  FOREIGN KEY ("identidadeId") REFERENCES "motorista_identidades"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
