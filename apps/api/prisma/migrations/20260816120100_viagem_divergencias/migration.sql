-- 1) Motivos pelos quais uma viagem entra carimbada.
CREATE TYPE "MotivoDivergencia" AS ENUM (
  'FALTA_MATERIAL',
  'FALTA_LOCAL_DESCARGA',
  'FALTA_KM',
  'FALTA_TONELADAS',
  'FALTA_CLIENTE',
  'CADASTRO_VEICULO_SUMIU',
  'CADASTRO_CLIENTE_SUMIU',
  'CADASTRO_MATERIAL_SUMIU',
  'CADASTRO_LOCAL_SUMIU',
  'CADASTRO_TIPO_SERVICO_SUMIU',
  'VIAGEM_ANTERIOR_ABERTA',
  'RESGATADA_DO_APP',
  'PAYLOAD_PARCIAL'
);

-- 2) Uma linha por (viagem, motivo). O unique é o que torna o reenvio do outbox
--    idempotente: a mesma viagem chegando de novo não duplica carimbo.
CREATE TABLE "viagem_divergencias" (
  "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
  "id" TEXT NOT NULL,
  "viagemId" TEXT NOT NULL,
  "motivo" "MotivoDivergencia" NOT NULL,
  "detalhe" TEXT NOT NULL,
  "dados" JSONB,
  "resolvidoEm" TIMESTAMP(3),
  "resolvidoPorId" TEXT,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "viagem_divergencias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "viagem_divergencias_viagemId_motivo_key"
  ON "viagem_divergencias" ("viagemId", "motivo");
CREATE INDEX "viagem_divergencias_contaId_resolvidoEm_idx"
  ON "viagem_divergencias" ("contaId", "resolvidoEm");
CREATE INDEX "viagem_divergencias_viagemId_idx"
  ON "viagem_divergencias" ("viagemId");

ALTER TABLE "viagem_divergencias"
  ADD CONSTRAINT "viagem_divergencias_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "viagem_divergencias"
  ADD CONSTRAINT "viagem_divergencias_viagemId_fkey"
  FOREIGN KEY ("viagemId") REFERENCES "viagens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "viagem_divergencias"
  ADD CONSTRAINT "viagem_divergencias_resolvidoPorId_fkey"
  FOREIGN KEY ("resolvidoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) A trava que gerava o "você já tem uma viagem em andamento".
--
-- O 409 nunca era culpa do motorista: era a viagem ANTERIOR dele que não tinha
-- conseguido fechar no servidor (material desativado, local excluído, foto
-- sumida no meio do finalizar). Ela ficava EM_ANDAMENTO pra sempre e TODAS as
-- viagens seguintes batiam aqui — numa viagem que ele acabou de iniciar e que
-- não tinha problema nenhum.
--
-- Duas viagens abertas ao mesmo tempo no servidor não incomodam ninguém: o app
-- continua tocando UMA por vez (o espelho local é que manda), e a que ficou pra
-- trás é carimbada com VIAGEM_ANTERIOR_ABERTA pra quem confere resolver.
DROP INDEX IF EXISTS "uq_viagem_em_andamento_por_motorista";
