-- Decisão do dono (23/09/2026): as três modalidades padrão (Autônomo (TAC),
-- Agregado, Empregado CLT) ficam só onde a empresa NÃO tinha modalidade
-- própria. Onde ela já tinha as dela (ex.: "Motorista Autônomo", "Motorista
-- Frota"), as padrão lado a lado só confundiam.
--
-- Só apaga o que a migration 20260923020000 criou, e com segurança:
--   - identificador de uma das três e sem autor (a tela sempre grava o autor);
--   - criada a partir de 23/09/2026 (o dia da migration);
--   - a empresa já tinha outra modalidade antes disso;
--   - ninguém está nela e nenhuma regra de acesso aponta pra ela.
DELETE FROM "modalidades_motorista" m
WHERE m."slug" IN ('autonomo-tac', 'agregado', 'empregado-clt')
  AND m."criadoPorId" IS NULL
  AND m."criadoEm" >= '2026-09-23 00:00:00'
  AND EXISTS (
    SELECT 1 FROM "modalidades_motorista" o
    WHERE o."contaId" = m."contaId" AND o."criadoEm" < '2026-09-23 00:00:00'
  )
  AND NOT EXISTS (SELECT 1 FROM "motoristas" x WHERE x."modalidadeId" = m."id")
  AND NOT EXISTS (SELECT 1 FROM "regras_acesso_app" r WHERE r."modalidadeId" = m."id");
