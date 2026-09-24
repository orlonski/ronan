-- Capacidade nova "app.historico.ver" (Ver o histórico de viagens). Até aqui o
-- histórico não tinha interruptor e aparecia pra todo motorista; ela nasce
-- LIGADA pra quem já existe, pra ninguém perder nada no dia em que entra — a
-- empresa desliga de quem quiser.
--
-- Perfis: toda tabela/tipo que já existe passa a ter a chave. Nos perfis de
-- "só bate ponto" ela é inócua: a capacidade mora no cadastro de motorista.
UPDATE "perfis_acesso_app"
SET "capacidades" = array_append("capacidades", 'app.historico.ver'),
    "alteradoEm" = CURRENT_TIMESTAMP
WHERE NOT ('app.historico.ver' = ANY("capacidades"));

-- Acesso já calculado de quem tem cadastro de motorista: sem isto, o app
-- atualizado leria "não tem" até o próximo recálculo e esconderia o histórico
-- de todo mundo por alguns minutos (ou uma hora, nas empresas no modo antigo).
UPDATE "acessos_efetivos_app"
SET "capacidades" = array_append("capacidades", 'app.historico.ver'),
    "capacidadesSombra" = CASE
      WHEN 'app.historico.ver' = ANY("capacidadesSombra") THEN "capacidadesSombra"
      ELSE array_append("capacidadesSombra", 'app.historico.ver')
    END
WHERE "motoristaId" IS NOT NULL
  AND NOT ('app.historico.ver' = ANY("capacidades"));
