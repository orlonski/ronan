-- Nome do posto é texto livre e virou CHAVE de agrupamento no relatório de
-- abastecimentos. Espaço nas pontas rachava o mesmo posto em dois grupos e
-- quebrava o drill-down (o grupo somava a linha, o filtro da listagem não a
-- encontrava). A validação passou a dar trim na escrita; isto limpa o passado.
UPDATE "abastecimentos"
   SET "postoNome" = NULLIF(btrim("postoNome"), '')
 WHERE "postoNome" IS NOT NULL
   AND "postoNome" IS DISTINCT FROM NULLIF(btrim("postoNome"), '');
