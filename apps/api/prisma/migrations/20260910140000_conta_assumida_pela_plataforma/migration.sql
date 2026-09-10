-- A empresa que um operador da plataforma está assumindo pra dar suporte.
--
-- Fica no banco, e não no JWT, porque assim vale pra todo canal de uma vez — o
-- SSE do sininho, as fotos que o <img> busca, os downloads. `ON DELETE SET NULL`
-- porque excluir uma empresa não pode derrubar o acesso de quem a visitava: ele
-- volta pra casa dele sozinho.
ALTER TABLE "users" ADD COLUMN "contaAtivaId" TEXT;

ALTER TABLE "users"
  ADD CONSTRAINT "users_contaAtivaId_fkey"
  FOREIGN KEY ("contaAtivaId") REFERENCES "contas"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Entrar e sair de uma empresa vira histórico DELA. Sem isso, as ações do
-- visitante apareceriam assinadas por um usuário que não é de lá, sem nada
-- explicando quem é nem desde quando.
--
-- ADD VALUE roda em transação a partir do PG12 (prod é PG17) desde que o valor
-- novo não seja USADO na mesma transação — só declaramos aqui.
ALTER TYPE "AcaoAuditoria" ADD VALUE 'PLATAFORMA_ASSUMIU_CONTA';
ALTER TYPE "AcaoAuditoria" ADD VALUE 'PLATAFORMA_SAIU_DA_CONTA';
