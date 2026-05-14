-- Apelidos/sinônimos por entidade pra busca fuzzy do agente WhatsApp.
-- Admin edita no dashboard; entram no ranking junto com nome/logradouro/bairro.

ALTER TABLE "locais"    ADD COLUMN "apelidos" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "obras"     ADD COLUMN "apelidos" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "materiais" ADD COLUMN "apelidos" TEXT[] NOT NULL DEFAULT '{}';

-- Achata o array em uma string normalizada pra GIN trigram funcionar.
CREATE OR REPLACE FUNCTION f_normalizar_array(arr text[]) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT f_normalizar(array_to_string(coalesce(arr, '{}'::text[]), ' '))
$$;

CREATE INDEX IF NOT EXISTS locais_apelidos_trgm_idx    ON locais    USING gin (f_normalizar_array(apelidos) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS obras_apelidos_trgm_idx     ON obras     USING gin (f_normalizar_array(apelidos) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS materiais_apelidos_trgm_idx ON materiais USING gin (f_normalizar_array(apelidos) gin_trgm_ops);
