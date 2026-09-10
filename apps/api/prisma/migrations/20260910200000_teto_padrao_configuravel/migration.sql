-- O teto padrão das empresas sai do código e vira dado editável.
--
-- Até aqui, "o que é da plataforma" era a constante RECURSOS_PLATAFORMA em
-- shared-types: abrir ou fechar uma tela pra todos os clientes exigia deploy.
-- A constante continua existindo, mas só como valor de partida — o boot semeia
-- esta linha uma vez e daí em diante quem manda é o banco.
CREATE TABLE "configuracao_permissoes" (
    "id"         TEXT NOT NULL DEFAULT 'singleton',
    "tetoPadrao" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "semeado"    BOOLEAN NOT NULL DEFAULT false,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracao_permissoes_pkey" PRIMARY KEY ("id")
);

-- Nenhuma empresa recebe teto próprio aqui, de propósito.
--
-- A tentação era congelar o teto atual de cada uma pra garantir que ninguém
-- perde tela no deploy. O efeito colateral seria pior: com todas carregando
-- teto próprio, o padrão configurável não valeria pra ninguém, e abrir uma tela
-- pra todos os clientes viraria trabalho empresa por empresa — exatamente o que
-- este recurso existe pra evitar.
--
-- Quem realmente precisa de teto próprio é só a empresa que ERA a plataforma, e
-- disso cuida a migration que cria a conta Movatruck: ela sabe quem era a casa.
