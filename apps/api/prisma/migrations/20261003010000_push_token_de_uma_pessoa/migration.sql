-- Um token de push pertence a UM aparelho, e o aparelho a UMA pessoa por vez.
-- Quem entrou como outro motorista (suporte, teste) deixava o token gravado nele
-- pra sempre e o celular seguia recebendo o push dele.
--
-- Só mexe em token que está em PESSOAS DIFERENTES (CPF diferente). Fica com o
-- registro mais recente; se nenhum tiver data, não decide nada. Cadastros da
-- mesma pessoa não são tocados. O app reenvia o token a cada abertura, então
-- quem era o dono de verdade se recompõe sozinho.
CREATE TEMP TABLE _push_donos AS
WITH linhas AS (
  SELECT "expoPushToken" AS token,
         regexp_replace("cpf", '\D', '', 'g') AS cpf,
         "pushTokenAtualizadoEm" AS ts
    FROM "motoristas" WHERE "expoPushToken" IS NOT NULL
  UNION ALL
  SELECT "expoPushToken", regexp_replace("cpf", '\D', '', 'g'), "pushTokenAtualizadoEm"
    FROM "motorista_identidades" WHERE "expoPushToken" IS NOT NULL
),
vencedor AS (
  SELECT DISTINCT ON (token) token, cpf
    FROM linhas
   WHERE ts IS NOT NULL
   ORDER BY token, ts DESC, cpf
)
SELECT v.token, v.cpf FROM vencedor v
 WHERE (SELECT COUNT(DISTINCT l.cpf) FROM linhas l WHERE l.token = v.token) > 1;

UPDATE "motoristas" m
   SET "expoPushToken" = NULL, "pushTokenAtualizadoEm" = NULL
  FROM _push_donos d
 WHERE m."expoPushToken" = d.token
   AND regexp_replace(m."cpf", '\D', '', 'g') <> d.cpf;

UPDATE "motorista_identidades" i
   SET "expoPushToken" = NULL, "pushTokenAtualizadoEm" = NULL
  FROM _push_donos d
 WHERE i."expoPushToken" = d.token
   AND regexp_replace(i."cpf", '\D', '', 'g') <> d.cpf;

DROP TABLE _push_donos;
