-- Fundação pra fuzzy search: trigram + unaccent + distância geo.
-- Habilita similaridade textual tolerante a typo/acento e distância em km
-- pra usar no ranking da tool buscar_catalogo (agente WhatsApp).
--
-- IMPORTANTE: extensions (unaccent, pg_trgm, cube, earthdistance) precisam
-- ser criadas previamente como superuser do banco — em Postgres 17 do
-- Easypanel o user `ronan` da app não tem privilégio pra `CREATE EXTENSION`
-- mesmo com IF NOT EXISTS. Rodar via psql como `postgres`:
--
--   \c ronan
--   CREATE EXTENSION IF NOT EXISTS unaccent;
--   CREATE EXTENSION IF NOT EXISTS pg_trgm;
--   CREATE EXTENSION IF NOT EXISTS cube;
--   CREATE EXTENSION IF NOT EXISTS earthdistance;
--   -- PG 15+: funções de extension não dão EXECUTE pra outros users por default.
--   -- f_normalizar abaixo é IMMUTABLE e o Postgres INLINEIA unaccent — o user da
--   -- app precisa EXECUTE pra o parse passar. Sem isso quebra com 42883
--   -- "function unaccent(text) does not exist" durante inlining.
--   GRANT EXECUTE ON FUNCTION public.unaccent(text) TO ronan;
--   GRANT EXECUTE ON FUNCTION public.unaccent(regdictionary, text) TO ronan;

-- Normaliza texto pra comparação fuzzy: minúsculas + sem acento + sem nulls.
-- IMMUTABLE é obrigatório pra usar em índice expression.
CREATE OR REPLACE FUNCTION f_normalizar(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT lower(unaccent(coalesce(t, '')))
$$;

CREATE INDEX IF NOT EXISTS locais_nome_trgm_idx       ON locais    USING gin (f_normalizar(nome) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS locais_logradouro_trgm_idx ON locais    USING gin (f_normalizar(logradouro) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS locais_bairro_trgm_idx     ON locais    USING gin (f_normalizar(coalesce(bairro,'')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS obras_nome_trgm_idx        ON obras     USING gin (f_normalizar(nome) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS materiais_nome_trgm_idx    ON materiais USING gin (f_normalizar(nome) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS veiculos_placa_trgm_idx    ON veiculos  USING gin (f_normalizar(placa) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS veiculos_modelo_trgm_idx   ON veiculos  USING gin (f_normalizar(coalesce(modelo,'')) gin_trgm_ops);
