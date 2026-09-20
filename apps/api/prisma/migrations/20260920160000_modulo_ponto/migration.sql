-- CreateEnum
CREATE TYPE "RegimeTrabalho" AS ENUM ('PARCEIRO', 'EMPREGADO');

-- CreateEnum
CREATE TYPE "OrigemMarcacao" AS ENUM ('APP', 'IMPORTACAO');

-- CreateEnum
CREATE TYPE "TipoCorrecaoPonto" AS ENUM ('INCLUSAO', 'DESCONSIDERACAO', 'ANOTACAO');

-- CreateEnum
CREATE TYPE "AutorPonto" AS ENUM ('FUNCIONARIO', 'GESTOR');

-- CreateEnum
CREATE TYPE "StatusCorrecaoPonto" AS ENUM ('PENDENTE', 'APROVADA', 'RECUSADA');

-- CreateEnum
CREATE TYPE "TipoJornada" AS ENUM ('SEMANAL', 'CICLO');

-- CreateEnum
CREATE TYPE "AbrangenciaFeriado" AS ENUM ('NACIONAL', 'ESTADUAL', 'MUNICIPAL');

-- CreateEnum
CREATE TYPE "FundamentoControlePonto" AS ENUM ('ACORDO_COLETIVO');

-- CreateEnum
CREATE TYPE "StatusFechamentoPonto" AS ENUM ('ABERTO', 'FECHADO');

-- CreateTable
CREATE TABLE "regimes_vigentes" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "cpf" TEXT NOT NULL,
    "regime" "RegimeTrabalho" NOT NULL,
    "iniciouEm" DATE NOT NULL,
    "encerradoEm" TIMESTAMP(3),
    "motivo" TEXT,
    "criadoPorId" TEXT,
    "chaveViva" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regimes_vigentes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ponto_funcionarios" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "identidadeId" TEXT,
    "nome" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "pis" TEXT,
    "matricula" TEXT,
    "cargo" TEXT,
    "uf" CHAR(2),
    "municipioIbge" CHAR(7),
    "admitidoEm" DATE NOT NULL,
    "desligadoEm" DATE,
    "desligamentoMotivo" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    "criadoPorId" TEXT,

    CONSTRAINT "ponto_funcionarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ponto_marcacoes" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "funcionarioId" TEXT NOT NULL,
    "numeroRegistro" INTEGER NOT NULL,
    "marcadoEm" TIMESTAMP(3) NOT NULL,
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "desvioRelogioSeg" INTEGER,
    "atrasoEnvioSeg" INTEGER,
    "dia" CHAR(10) NOT NULL,
    "origem" "OrigemMarcacao" NOT NULL DEFAULT 'APP',
    "clientId" TEXT NOT NULL,
    "appVersao" TEXT,
    "dispositivo" TEXT,
    "repVersao" TEXT NOT NULL,

    CONSTRAINT "ponto_marcacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ponto_marcacoes_localizacao" (
    "marcacaoId" TEXT NOT NULL,
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "precisao" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ponto_marcacoes_localizacao_pkey" PRIMARY KEY ("marcacaoId")
);

-- CreateTable
CREATE TABLE "ponto_sequencia" (
    "contaId" TEXT NOT NULL,
    "proximo" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ponto_sequencia_pkey" PRIMARY KEY ("contaId")
);

-- CreateTable
CREATE TABLE "ponto_correcoes" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "funcionarioId" TEXT NOT NULL,
    "dia" CHAR(10) NOT NULL,
    "tipo" "TipoCorrecaoPonto" NOT NULL,
    "marcacaoId" TEXT,
    "instantePretendido" TIMESTAMP(3),
    "motivoCodigo" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "anexoKey" TEXT,
    "pedidoPor" "AutorPonto" NOT NULL,
    "pedidoPorFuncionarioId" TEXT,
    "pedidoPorUserId" TEXT,
    "status" "StatusCorrecaoPonto" NOT NULL DEFAULT 'PENDENTE',
    "decididoPorUserId" TEXT,
    "decididoEm" TIMESTAMP(3),
    "decisaoMotivo" TEXT,
    "cienciaEm" TIMESTAMP(3),
    "cienciaPresencial" BOOLEAN NOT NULL DEFAULT false,
    "cienciaColhidaPorUserId" TEXT,
    "cienciaObservacao" TEXT,
    "clientId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ponto_correcoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ponto_motivos_correcao" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "exigeAnexo" BOOLEAN NOT NULL DEFAULT false,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ponto_motivos_correcao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ponto_modelos_jornada" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "nome" TEXT NOT NULL,
    "tipo" "TipoJornada" NOT NULL DEFAULT 'SEMANAL',
    "cicloDias" INTEGER,
    "ancoraCiclo" DATE,
    "toleranciaPorMarcacaoMin" INTEGER NOT NULL DEFAULT 5,
    "toleranciaDiariaMin" INTEGER NOT NULL DEFAULT 10,
    "intervaloMinimoMin" INTEGER NOT NULL DEFAULT 60,
    "preAssinalacaoIntervalo" BOOLEAN NOT NULL DEFAULT false,
    "preAssinalacaoMinutos" INTEGER,
    "maxDirecaoContinuaMin" INTEGER,
    "descansoDirecaoMin" INTEGER,
    "interjornadaMin" INTEGER DEFAULT 660,
    "descansoSemanalMin" INTEGER DEFAULT 2100,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ponto_modelos_jornada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ponto_modelos_jornada_dias" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "modeloId" TEXT NOT NULL,
    "posicao" INTEGER NOT NULL,
    "trabalha" BOOLEAN NOT NULL DEFAULT true,
    "entrada" CHAR(5),
    "saida" CHAR(5),
    "intervaloMin" INTEGER NOT NULL DEFAULT 60,
    "cargaMin" INTEGER NOT NULL,

    CONSTRAINT "ponto_modelos_jornada_dias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ponto_vinculos_jornada" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "funcionarioId" TEXT NOT NULL,
    "modeloId" TEXT NOT NULL,
    "vigenteDe" DATE NOT NULL,
    "vigenteAte" DATE,
    "criadoPorId" TEXT,
    "chaveViva" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ponto_vinculos_jornada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ponto_feriados" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "data" DATE NOT NULL,
    "nome" TEXT NOT NULL,
    "abrangencia" "AbrangenciaFeriado" NOT NULL DEFAULT 'NACIONAL',
    "uf" CHAR(2),
    "municipioIbge" CHAR(7),

    CONSTRAINT "ponto_feriados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ponto_config" (
    "contaId" TEXT NOT NULL,
    "razaoSocial" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "fundamento" "FundamentoControlePonto",
    "fundamentoReferencia" TEXT,
    "fundamentoRegistradoEm" TIMESTAMP(3),
    "fundamentoRegistradoPorId" TEXT,
    "diaFechamento" INTEGER NOT NULL DEFAULT 30,
    "identificacaoRep" TEXT NOT NULL,
    "diasRetencaoLocalizacao" INTEGER NOT NULL DEFAULT 90,
    "avisoLgpdTexto" TEXT NOT NULL,
    "mesesAcessoAposDesligamento" INTEGER NOT NULL DEFAULT 12,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ponto_config_pkey" PRIMARY KEY ("contaId")
);

-- CreateTable
CREATE TABLE "ponto_fechamentos" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "competencia" TEXT NOT NULL,
    "inicio" DATE NOT NULL,
    "fim" DATE NOT NULL,
    "status" "StatusFechamentoPonto" NOT NULL DEFAULT 'ABERTO',
    "fechadoEm" TIMESTAMP(3),
    "fechadoPorId" TEXT,
    "reabertoEm" TIMESTAMP(3),
    "reabertoPorId" TEXT,
    "reaberturaMotivo" TEXT,

    CONSTRAINT "ponto_fechamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ponto_apuracoes_dia" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "fechamentoId" TEXT NOT NULL,
    "funcionarioId" TEXT NOT NULL,
    "dia" CHAR(10) NOT NULL,
    "minutosPrevistos" INTEGER NOT NULL,
    "minutosTrabalhados" INTEGER NOT NULL,
    "minutosConsiderados" INTEGER NOT NULL,
    "saldoMin" INTEGER NOT NULL,
    "registrosNumero" INTEGER[],
    "correcoesIds" TEXT[],
    "jornadaModeloNome" TEXT NOT NULL,
    "alertas" TEXT[],

    CONSTRAINT "ponto_apuracoes_dia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ponto_ciencias_espelho" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "funcionarioId" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "cienteEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concorda" BOOLEAN NOT NULL,
    "observacao" TEXT,
    "hashEspelho" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "ponto_ciencias_espelho_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "regimes_vigentes_contaId_cpf_idx" ON "regimes_vigentes"("contaId", "cpf");

-- CreateIndex
CREATE UNIQUE INDEX "um_regime_vigente_por_cpf" ON "regimes_vigentes"("contaId", "chaveViva");

-- CreateIndex
CREATE INDEX "ponto_funcionarios_contaId_ativo_idx" ON "ponto_funcionarios"("contaId", "ativo");

-- CreateIndex
CREATE INDEX "ponto_funcionarios_contaId_identidadeId_idx" ON "ponto_funcionarios"("contaId", "identidadeId");

-- CreateIndex
CREATE UNIQUE INDEX "ponto_funcionarios_contaId_cpf_key" ON "ponto_funcionarios"("contaId", "cpf");

-- CreateIndex
CREATE INDEX "ponto_marcacoes_contaId_funcionarioId_dia_idx" ON "ponto_marcacoes"("contaId", "funcionarioId", "dia");

-- CreateIndex
CREATE INDEX "ponto_marcacoes_contaId_dia_idx" ON "ponto_marcacoes"("contaId", "dia");

-- CreateIndex
CREATE INDEX "ponto_marcacoes_contaId_funcionarioId_marcadoEm_idx" ON "ponto_marcacoes"("contaId", "funcionarioId", "marcadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "ponto_marcacoes_contaId_numeroRegistro_key" ON "ponto_marcacoes"("contaId", "numeroRegistro");

-- CreateIndex
CREATE UNIQUE INDEX "ponto_marcacoes_contaId_clientId_key" ON "ponto_marcacoes"("contaId", "clientId");

-- CreateIndex
CREATE INDEX "ponto_marcacoes_localizacao_contaId_criadoEm_idx" ON "ponto_marcacoes_localizacao"("contaId", "criadoEm");

-- CreateIndex
CREATE INDEX "ponto_correcoes_contaId_status_idx" ON "ponto_correcoes"("contaId", "status");

-- CreateIndex
CREATE INDEX "ponto_correcoes_contaId_funcionarioId_dia_idx" ON "ponto_correcoes"("contaId", "funcionarioId", "dia");

-- CreateIndex
CREATE UNIQUE INDEX "ponto_correcoes_contaId_clientId_key" ON "ponto_correcoes"("contaId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ponto_motivos_correcao_contaId_codigo_key" ON "ponto_motivos_correcao"("contaId", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "ponto_modelos_jornada_contaId_nome_key" ON "ponto_modelos_jornada"("contaId", "nome");

-- CreateIndex
CREATE INDEX "ponto_modelos_jornada_dias_contaId_idx" ON "ponto_modelos_jornada_dias"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "ponto_modelos_jornada_dias_modeloId_posicao_key" ON "ponto_modelos_jornada_dias"("modeloId", "posicao");

-- CreateIndex
CREATE INDEX "ponto_vinculos_jornada_contaId_funcionarioId_vigenteDe_idx" ON "ponto_vinculos_jornada"("contaId", "funcionarioId", "vigenteDe");

-- CreateIndex
CREATE UNIQUE INDEX "ponto_vinculos_jornada_funcionarioId_vigenteDe_key" ON "ponto_vinculos_jornada"("funcionarioId", "vigenteDe");

-- CreateIndex
CREATE UNIQUE INDEX "uma_jornada_viva_por_funcionario" ON "ponto_vinculos_jornada"("contaId", "chaveViva");

-- CreateIndex
CREATE INDEX "ponto_feriados_contaId_data_idx" ON "ponto_feriados"("contaId", "data");

-- CreateIndex
CREATE UNIQUE INDEX "ponto_feriados_contaId_data_abrangencia_uf_municipioIbge_key" ON "ponto_feriados"("contaId", "data", "abrangencia", "uf", "municipioIbge");

-- CreateIndex
CREATE UNIQUE INDEX "ponto_fechamentos_contaId_competencia_key" ON "ponto_fechamentos"("contaId", "competencia");

-- CreateIndex
CREATE INDEX "ponto_apuracoes_dia_contaId_funcionarioId_dia_idx" ON "ponto_apuracoes_dia"("contaId", "funcionarioId", "dia");

-- CreateIndex
CREATE UNIQUE INDEX "ponto_apuracoes_dia_contaId_fechamentoId_funcionarioId_dia_key" ON "ponto_apuracoes_dia"("contaId", "fechamentoId", "funcionarioId", "dia");

-- CreateIndex
CREATE INDEX "ponto_ciencias_espelho_contaId_competencia_idx" ON "ponto_ciencias_espelho"("contaId", "competencia");

-- CreateIndex
CREATE UNIQUE INDEX "ponto_ciencias_espelho_contaId_funcionarioId_competencia_key" ON "ponto_ciencias_espelho"("contaId", "funcionarioId", "competencia");

-- AddForeignKey
ALTER TABLE "regimes_vigentes" ADD CONSTRAINT "regimes_vigentes_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ponto_funcionarios" ADD CONSTRAINT "ponto_funcionarios_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ponto_funcionarios" ADD CONSTRAINT "ponto_funcionarios_identidadeId_fkey" FOREIGN KEY ("identidadeId") REFERENCES "motorista_identidades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ponto_marcacoes" ADD CONSTRAINT "ponto_marcacoes_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ponto_marcacoes" ADD CONSTRAINT "ponto_marcacoes_funcionarioId_fkey" FOREIGN KEY ("funcionarioId") REFERENCES "ponto_funcionarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ponto_marcacoes_localizacao" ADD CONSTRAINT "ponto_marcacoes_localizacao_marcacaoId_fkey" FOREIGN KEY ("marcacaoId") REFERENCES "ponto_marcacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ponto_marcacoes_localizacao" ADD CONSTRAINT "ponto_marcacoes_localizacao_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ponto_sequencia" ADD CONSTRAINT "ponto_sequencia_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ponto_correcoes" ADD CONSTRAINT "ponto_correcoes_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ponto_correcoes" ADD CONSTRAINT "ponto_correcoes_funcionarioId_fkey" FOREIGN KEY ("funcionarioId") REFERENCES "ponto_funcionarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ponto_motivos_correcao" ADD CONSTRAINT "ponto_motivos_correcao_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ponto_modelos_jornada" ADD CONSTRAINT "ponto_modelos_jornada_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ponto_modelos_jornada_dias" ADD CONSTRAINT "ponto_modelos_jornada_dias_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ponto_modelos_jornada_dias" ADD CONSTRAINT "ponto_modelos_jornada_dias_modeloId_fkey" FOREIGN KEY ("modeloId") REFERENCES "ponto_modelos_jornada"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ponto_vinculos_jornada" ADD CONSTRAINT "ponto_vinculos_jornada_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ponto_vinculos_jornada" ADD CONSTRAINT "ponto_vinculos_jornada_funcionarioId_fkey" FOREIGN KEY ("funcionarioId") REFERENCES "ponto_funcionarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ponto_vinculos_jornada" ADD CONSTRAINT "ponto_vinculos_jornada_modeloId_fkey" FOREIGN KEY ("modeloId") REFERENCES "ponto_modelos_jornada"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ponto_feriados" ADD CONSTRAINT "ponto_feriados_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ponto_config" ADD CONSTRAINT "ponto_config_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ponto_fechamentos" ADD CONSTRAINT "ponto_fechamentos_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ponto_apuracoes_dia" ADD CONSTRAINT "ponto_apuracoes_dia_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ponto_apuracoes_dia" ADD CONSTRAINT "ponto_apuracoes_dia_fechamentoId_fkey" FOREIGN KEY ("fechamentoId") REFERENCES "ponto_fechamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ponto_ciencias_espelho" ADD CONSTRAINT "ponto_ciencias_espelho_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ponto_ciencias_espelho" ADD CONSTRAINT "ponto_ciencias_espelho_funcionarioId_fkey" FOREIGN KEY ("funcionarioId") REFERENCES "ponto_funcionarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═══════════════════════════════════════════════════════════════════════════
-- O registro de ponto é APPEND-ONLY, e quem garante isso é o banco.
--
-- Art. 82, IV da Portaria MTP 671/2021: o sistema não pode permitir alteração
-- do dado registrado pelo trabalhador. Deixar isso a cargo do código é deixar
-- a cargo de quem escrever o próximo service — e um `updateMany` distraído
-- destrói a única coisa que o módulo tem pra vender.
--
-- Função qualificada com `public.` de propósito: função chamada por trigger
-- sem schema explícito já deu 42883 neste projeto.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.ponto_marcacao_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ponto_marcacoes é append-only: correção é linha nova em ponto_correcoes';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ponto_marcacoes_append_only ON "ponto_marcacoes";
CREATE TRIGGER ponto_marcacoes_append_only
  BEFORE UPDATE OR DELETE ON "ponto_marcacoes"
  FOR EACH ROW EXECUTE FUNCTION public.ponto_marcacao_append_only();

-- ═══════════════════════════════════════════════════════════════════════════
-- Backfill: quem já está alocado numa obra hoje é PARCEIRO.
--
-- Sem isto a trava nasce vazia e o primeiro cadastro de funcionário aceitaria
-- alguém que já é parceiro — que é exatamente o que ela existe pra impedir.
-- `chaveViva` recebe o CPF porque a alocação está ativa.
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO "regimes_vigentes" ("id", "contaId", "cpf", "regime", "iniciouEm", "chaveViva", "criadoEm", "alteradoEm")
SELECT
  gen_random_uuid()::text,
  a."contaId",
  regexp_replace(m."cpf", '[^0-9]', '', 'g'),
  'PARCEIRO',
  MIN(a."inicio"),
  regexp_replace(m."cpf", '[^0-9]', '', 'g'),
  NOW(),
  NOW()
FROM "alocacoes_obra" a
JOIN "motoristas" m ON m."id" = a."motoristaId"
WHERE a."ativa" = true
  AND m."cpf" IS NOT NULL
  AND length(regexp_replace(m."cpf", '[^0-9]', '', 'g')) = 11
GROUP BY a."contaId", regexp_replace(m."cpf", '[^0-9]', '', 'g')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- O teto padrão já gravado em produção não conhece as chaves do ponto, e o
-- seed tinha early-return. O código foi corrigido pra UNIR as chaves novas;
-- esta linha resolve a instalação que já existe, no mesmo deploy.
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE "configuracao_permissoes"
SET "tetoPadrao" = (
  SELECT ARRAY(SELECT DISTINCT unnest("tetoPadrao" || ARRAY[
    'ponto.ver',
    'funcionarios.ver','funcionarios.criar','funcionarios.editar','funcionarios.desligar','funcionarios.importar',
    'jornadas.ver','jornadas.editar',
    'espelho-ponto.ver','espelho-ponto.exportar',
    'correcoes-ponto.ver','correcoes-ponto.lancar','correcoes-ponto.decidir',
    'fechamento-ponto.ver','fechamento-ponto.fechar','fechamento-ponto.reabrir',
    'config-ponto.ver','config-ponto.editar'
  ]))
)
WHERE "id" = 'singleton';
