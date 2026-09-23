-- A navegação por voz deixa de ser item à parte: vem junto com "Iniciar viagem
-- com GPS", a única tela onde ela existe (decisão do dono, 22/09/2026).
-- Ninguém perde nada no celular: quem tinha a voz sem o GPS não tinha onde
-- usá-la, e quem tem o GPS passa a ter a voz.

UPDATE "perfis_acesso_app"
   SET "capacidades" = array_remove("capacidades", 'app.navegacao.aoVivo')
 WHERE 'app.navegacao.aoVivo' = ANY("capacidades");

UPDATE "acessos_efetivos_app"
   SET "capacidades"       = array_remove("capacidades", 'app.navegacao.aoVivo'),
       "capacidadesSombra" = array_remove("capacidadesSombra", 'app.navegacao.aoVivo')
 WHERE 'app.navegacao.aoVivo' = ANY("capacidades")
    OR 'app.navegacao.aoVivo' = ANY("capacidadesSombra");

UPDATE "configuracao_acesso_app"
   SET "capacidadesTravadas" = array_remove("capacidadesTravadas", 'app.navegacao.aoVivo')
 WHERE 'app.navegacao.aoVivo' = ANY("capacidadesTravadas");

-- Exceção viva da voz não tem mais do que ser exceção: fica revogada, com o
-- porquê, em vez de apagada (é histórico de quem deu o quê a quem).
UPDATE "excecoes_acesso_app"
   SET "revogadaEm" = now(),
       "motivoRevogacao" = 'A navegação por voz passou a vir junto com Iniciar viagem com GPS.',
       "chaveViva" = NULL
 WHERE "capacidade" = 'app.navegacao.aoVivo'
   AND "revogadaEm" IS NULL;

UPDATE "contas"
   SET "rolloutsApp" = array_remove("rolloutsApp", 'app.navegacao.aoVivo')
 WHERE 'app.navegacao.aoVivo' = ANY("rolloutsApp");
