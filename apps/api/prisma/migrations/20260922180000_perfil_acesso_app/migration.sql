-- O molde de acessos do app: "o que esse TIPO de pessoa faz", em vez de treze
-- perguntas de sim/não por motorista.
--
-- O perfil é MOLDE, não fonte: atribuir ou editar escreve as colunas `pode*`
-- do motorista, e ninguém lê "o perfil" pra decidir. Ver o comentário do model
-- no schema — `podeChat` entra em cláusula WHERE do Prisma, e valor calculado
-- em tempo de leitura não vai pra dentro de um WHERE.
CREATE TABLE "perfis_acesso_app" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    -- Regime que este perfil costuma servir. SUGERE no cadastro, nunca decide:
    -- o motorista CLT da própria transportadora dirige e lança viagem.
    "sugeridoPara" "RegimeTrabalho",
    "podeLancarViagem" BOOLEAN NOT NULL DEFAULT false,
    "podeLancarAbastecimento" BOOLEAN NOT NULL DEFAULT false,
    "podeLancarPedagio" BOOLEAN NOT NULL DEFAULT false,
    "podeViagemLifecycle" BOOLEAN NOT NULL DEFAULT false,
    "podeIniciarViagem" BOOLEAN NOT NULL DEFAULT false,
    "podeUsarOcrTicket" BOOLEAN NOT NULL DEFAULT false,
    "podeReferenciaKm" BOOLEAN NOT NULL DEFAULT false,
    "podeVerTodosLocais" BOOLEAN NOT NULL DEFAULT false,
    "podeTelemetria" BOOLEAN NOT NULL DEFAULT false,
    "podeChat" BOOLEAN NOT NULL DEFAULT false,
    "podeVerStories" BOOLEAN NOT NULL DEFAULT false,
    "podeDiaria" BOOLEAN NOT NULL DEFAULT false,
    "podeVerValorDiaria" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perfis_acesso_app_pkey" PRIMARY KEY ("id")
);

-- Nome é como o escritório chama o perfil; dois com o mesmo nome na mesma
-- empresa tornaria a lista inútil justamente na hora de escolher.
CREATE UNIQUE INDEX "perfis_acesso_app_contaId_nome_key" ON "perfis_acesso_app"("contaId", "nome");

ALTER TABLE "perfis_acesso_app" ADD CONSTRAINT "perfis_acesso_app_contaId_fkey"
    FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- NULL = ninguém aplicou perfil nenhum, e as colunas do motorista valem como
-- sempre valeram. É o que faz esta migration não mudar NADA no dia 1.
ALTER TABLE "motoristas" ADD COLUMN "perfilAcessoId" TEXT;

ALTER TABLE "motoristas" ADD CONSTRAINT "motoristas_perfilAcessoId_fkey"
    FOREIGN KEY ("perfilAcessoId") REFERENCES "perfis_acesso_app"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "motoristas_perfilAcessoId_idx" ON "motoristas"("perfilAcessoId");
