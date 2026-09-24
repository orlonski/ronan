-- O dono marcou no papel Operador da Movatruck o que o operador deve ver
-- (23/09/2026), querendo que valesse pra Schaba — mas papel é por empresa, e
-- ninguém da Schaba consegue editar os dela pelo painel. Leva o que ele marcou
-- pro Operador da Schaba.
--
-- UNIÃO, não troca: nada que o Operador da Schaba já tinha sai. O que ela não
-- contratou (Ponto, CT-e) o boot poda sozinho (`podarAcimaDoTeto`).
UPDATE "papeis" s
SET "permissoes" = ARRAY(
      SELECT DISTINCT k FROM unnest(s."permissoes" || m."permissoes") AS k ORDER BY k
    ),
    "alteradoEm" = CURRENT_TIMESTAMP
FROM "papeis" m
JOIN "contas" c ON c."id" = m."contaId" AND c."ehPlataforma" = true
WHERE s."contaId" = 'cnt_schaba'
  AND s."nome" = 'Operador'
  AND m."nome" = 'Operador';
