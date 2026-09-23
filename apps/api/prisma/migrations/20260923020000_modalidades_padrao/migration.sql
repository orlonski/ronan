-- As três modalidades do mercado em toda empresa (decisão do dono, 22/09/2026):
-- Autônomo (TAC), Agregado e Empregado CLT. São o ponto de partida da tela
-- "Permissões do app" (cada modalidade é um tipo ali). Dado, não regra: a
-- empresa renomeia, desliga e cria as dela.
--
-- Nascem sem régua de pagamento e sem exigir foto (padrões da tabela): não
-- mudam acerto nem abastecimento de ninguém. Pula a que a empresa já tiver
-- com o mesmo identificador ou o mesmo nome.
INSERT INTO "modalidades_motorista" ("id", "contaId", "slug", "nome", "ordem", "alteradoEm")
SELECT gen_random_uuid()::text, c."id", m.slug, m.nome, m.ordem, now()
FROM "contas" c
CROSS JOIN (VALUES
  ('autonomo-tac', 'Autônomo (TAC)', 1),
  ('agregado', 'Agregado', 2),
  ('empregado-clt', 'Empregado CLT', 3)
) AS m(slug, nome, ordem)
WHERE NOT EXISTS (
  SELECT 1 FROM "modalidades_motorista" x
  WHERE x."contaId" = c."id" AND (x."slug" = m.slug OR lower(x."nome") = lower(m.nome))
);
