-- O telefone deixa de ser único no sistema e passa a ser único DENTRO da conta.
-- Motivo: o motorista que roda pra mais de uma empresa tem UM celular e precisa
-- poder falar com as duas. Cada empresa tem a sua sessão; quem recebe a mensagem
-- que chega é o cadastro que está com o aparelho (ver SessaoService).
DROP INDEX IF EXISTS "whatsapp_sessoes_telefone_key";

CREATE UNIQUE INDEX "whatsapp_sessoes_contaId_telefone_key" ON "whatsapp_sessoes"("contaId", "telefone");

-- A resolução "de quem é este número" busca sem filtro de conta (é justamente o
-- que revela a conta), então o telefone sozinho precisa de índice próprio.
CREATE INDEX "whatsapp_sessoes_telefone_idx" ON "whatsapp_sessoes"("telefone");
