-- Fundação pra fuzzy search: trigram + distância geo.
-- Habilita similaridade textual tolerante a typo/acento e distância em km
-- pra usar no ranking da tool buscar_catalogo (agente WhatsApp).
--
-- IMPORTANTE: extensions (pg_trgm, cube, earthdistance) precisam ser criadas
-- previamente como superuser do banco — em Postgres 17 do Easypanel o user
-- `ronan` da app não tem privilégio pra `CREATE EXTENSION` mesmo com
-- IF NOT EXISTS. Rodar via psql como `postgres`:
--
--   \c ronan
--   CREATE EXTENSION IF NOT EXISTS pg_trgm;
--   CREATE EXTENSION IF NOT EXISTS cube;
--   CREATE EXTENSION IF NOT EXISTS earthdistance;
--
-- A normalização de acentos NÃO usa a extension `unaccent` — em PG 15+ as
-- funções de extension não recebem EXECUTE pra outros users por default,
-- e a inline da `unaccent` durante o parse de `f_normalizar` IMMUTABLE
-- quebra com 42883 "function unaccent(text) does not exist". Em vez disso
-- usa `translate()` builtin com mapping ASCII dos acentos PT-BR — funciona
-- em qualquer Postgres, IMMUTABLE de verdade, sem extension, sem privilege.

-- Normaliza texto pra comparação fuzzy: minúsculas + sem acento + sem nulls.
-- IMMUTABLE é obrigatório pra usar em índice expression.
CREATE OR REPLACE FUNCTION f_normalizar(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT lower(translate(
    coalesce(t, ''),
    'ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñÝý',
    'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNnYy'
  ))
$$;

CREATE INDEX IF NOT EXISTS locais_nome_trgm_idx       ON locais    USING gin (f_normalizar(nome) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS locais_logradouro_trgm_idx ON locais    USING gin (f_normalizar(logradouro) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS locais_bairro_trgm_idx     ON locais    USING gin (f_normalizar(coalesce(bairro,'')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS obras_nome_trgm_idx        ON obras     USING gin (f_normalizar(nome) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS materiais_nome_trgm_idx    ON materiais USING gin (f_normalizar(nome) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS veiculos_placa_trgm_idx    ON veiculos  USING gin (f_normalizar(placa) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS veiculos_modelo_trgm_idx   ON veiculos  USING gin (f_normalizar(coalesce(modelo,'')) gin_trgm_ops);
