-- Um estado entre "funcionando" e "morta".
--
-- Até aqui a empresa só tinha `ativa`: ou opera, ou ninguém entra. Para um
-- período de teste que termina isso é o pior desfecho possível — quem estava
-- gostando do produto perde o acesso aos próprios dados de uma vez, sem
-- conseguir exportar o fechamento que acabou de montar.
--
-- `somenteLeitura` deixa a empresa entrar, ver tudo e exportar, sem escrever.
-- Ninguém nasce assim: o default false mantém todas as contas como estão.
ALTER TABLE "contas" ADD COLUMN "somenteLeitura" BOOLEAN NOT NULL DEFAULT false;

-- Quando o teste termina. NULL = não é teste, é cliente — que é o caso de
-- todas as contas que existem hoje.
ALTER TABLE "contas" ADD COLUMN "trialExpiraEm" TIMESTAMP(3);

-- Por que está bloqueada, escrito para quem vai ler na tela. Sem isto o painel
-- diz "credenciais inválidas" a quem não errou senha nenhuma.
ALTER TABLE "contas" ADD COLUMN "motivoBloqueio" TEXT;

-- Sem índice em `trialExpiraEm` de propósito: `contas` tem dezenas de linhas e
-- o cron roda uma vez por dia. Um índice parcial aqui só somaria drift com o
-- schema do Prisma, que não sabe declarar `WHERE`.
