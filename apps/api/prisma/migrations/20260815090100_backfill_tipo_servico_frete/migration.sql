-- Backfill: toda conta que já existe ganha o modo de serviço "Frete por
-- tonelada" como padrão — o mesmo que o kit inicial dá pra conta nova.
--
-- Sem isso, o painel de uma conta antiga abriria a tela de Modos de serviço
-- vazia e não haveria padrão pra viagem sem tipoServicoId herdar.
--
-- Idempotente (ON CONFLICT DO NOTHING) e sem tocar em nenhuma viagem: as
-- existentes continuam com tipoServicoId NULL, que resolve pro padrão.
INSERT INTO "tipos_servico" ("contaId", "id", "slug", "nome", "ativo", "padrao", "ordem", "medicao", "alteradoEm")
SELECT c."id", gen_random_uuid()::text, 'frete', 'Frete por tonelada', true, true, 1, 'PESO', NOW()
FROM "contas" c
ON CONFLICT ("contaId", "slug") DO NOTHING;
