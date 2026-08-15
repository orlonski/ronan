-- Move a exigência de foto de Empresa para Conta.
--
-- Eixo errado na primeira versão, por uma ambiguidade real do sistema:
--   Empresa = a CONTRAPARTE (a pedreira que manda/recebe planilha de fechamento)
--   Conta   = a TRANSPORTADORA dona do sistema (tela "Minha empresa")
-- Exigir foto é política de quem usa o sistema, e vale pros clientes todos dela.

ALTER TABLE "contas"
  ADD COLUMN "exigeFotoViagem" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "exigeFotoAbastecimento" BOOLEAN NOT NULL DEFAULT false;

-- Preserva a intenção antes de destruir: se alguma empresa da conta estava com a
-- flag ligada, ligar significava "quero exigir foto" — então a conta herda.
-- OR entre as empresas, porque o eixo novo é tudo-ou-nada por conta.
UPDATE "contas" c
SET "exigeFotoViagem" = true
WHERE EXISTS (SELECT 1 FROM "empresas" e WHERE e."contaId" = c."id" AND e."exigeFotoViagem");

UPDATE "contas" c
SET "exigeFotoAbastecimento" = true
WHERE EXISTS (SELECT 1 FROM "empresas" e WHERE e."contaId" = c."id" AND e."exigeFotoAbastecimento");

ALTER TABLE "empresas"
  DROP COLUMN "exigeFotoViagem",
  DROP COLUMN "exigeFotoAbastecimento";
