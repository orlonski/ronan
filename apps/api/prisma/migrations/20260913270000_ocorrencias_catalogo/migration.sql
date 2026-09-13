-- Catálogo de ocorrências pras contas que JÁ existem.
--
-- O kit inicial só roda em conta nova; sem isto, a torre e a estadia nasceriam
-- inertes justamente nas contas que estão operando hoje.
--
-- `valorHora` fica NULO de propósito nas que geram cobrança: o preço da hora
-- parada é de contrato, e um número chutado aqui viraria cobrança inventada
-- dentro de um fechamento real. As horas passam a ser contadas desde já; o
-- valor aparece quando alguém preencher.
INSERT INTO "tipos_evento_viagem"
  ("id", "contaId", "slug", "nome", "ordem", "repetivel", "ehOcorrencia",
   "severidade", "temDuracao", "geraCobranca", "pedeGps", "pedeFoto",
   "pedeObservacao", "criadoEm", "alteradoEm")
SELECT
  gen_random_uuid()::text,
  c."id",
  t."slug", t."nome", t."ordem", TRUE, TRUE,
  t."severidade", t."temDuracao", t."geraCobranca", TRUE, t."pedeFoto",
  TRUE, NOW(), NOW()
FROM "contas" c
CROSS JOIN (VALUES
  ('fila-carga',           'Fila para carregar',                20, 'MEDIA', TRUE,  TRUE,  FALSE),
  ('fila-descarga',        'Fila para descarregar',             21, 'MEDIA', TRUE,  TRUE,  FALSE),
  ('aguardando-liberacao', 'Aguardando liberação ou documento', 22, 'MEDIA', TRUE,  TRUE,  FALSE),
  ('sem-produto',          'Sem produto no local',              23, 'ALTA',  TRUE,  FALSE, FALSE),
  ('carga-recusada',       'Carga recusada',                    24, 'ALTA',  FALSE, FALSE, TRUE),
  ('quebra',               'Quebra do veículo',                 25, 'ALTA',  TRUE,  FALSE, FALSE),
  ('pneu',                 'Problema de pneu',                  26, 'MEDIA', TRUE,  FALSE, FALSE),
  ('acidente',             'Acidente',                          27, 'ALTA',  FALSE, FALSE, TRUE)
) AS t("slug", "nome", "ordem", "severidade", "temDuracao", "geraCobranca", "pedeFoto")
-- Idempotente: a conta que já tiver o slug (criada depois do kit novo) passa
-- batido. O único índice é (contaId, slug), então é ele que manda.
ON CONFLICT ("contaId", "slug") DO NOTHING;
