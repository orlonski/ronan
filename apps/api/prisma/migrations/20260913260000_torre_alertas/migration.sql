-- Torre de controle: ocorrência com duração e alerta ao vivo.
--
-- A viagem em curso não emitia um único sinal. Os treze tipos de aviso do painel
-- eram todos reativos a algo que o motorista já tinha terminado, e o modelo
-- mental era "tem uma tela, alguém que olhe" — o que não escala, porque ninguém
-- fica olhando quarenta cards.

CREATE TYPE "TipoAlertaOperacional" AS ENUM ('ATRASO', 'PARADA_LONGA', 'SEM_SINAL', 'NAO_INICIOU', 'OCORRENCIA_ABERTA');

-- O catálogo de eventos nasceu como a espinha do fluxo feliz (cheguei,
-- carreguei, saí). Nada respondia "carga recusada", "3h na fila", "quebrei".
ALTER TABLE "tipos_evento_viagem"
  ADD COLUMN "ehOcorrencia" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "severidade" TEXT,
  ADD COLUMN "temDuracao" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "geraCobranca" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "valorHora" DECIMAL(10,2);

ALTER TABLE "eventos_viagem"
  ADD COLUMN "iniciouEm" TIMESTAMP(3),
  ADD COLUMN "terminouEm" TIMESTAMP(3),
  ADD COLUMN "encerradoPorId" TEXT;

CREATE TABLE "alertas_operacionais" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "tipo" "TipoAlertaOperacional" NOT NULL,
    "severidade" TEXT NOT NULL DEFAULT 'MEDIA',
    "viagemId" TEXT,
    "motoristaId" TEXT,
    "titulo" TEXT NOT NULL,
    "detalhe" TEXT,
    "dados" JSONB,
    "detectadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvidoEm" TIMESTAMP(3),
    "resolvidoPorId" TEXT,
    CONSTRAINT "alertas_operacionais_pkey" PRIMARY KEY ("id")
);

-- Um alerta vivo por tipo e viagem: o cron roda a cada 5 min e não pode
-- empilhar o mesmo aviso doze vezes por hora.
CREATE UNIQUE INDEX "alertas_operacionais_viagemId_tipo_resolvidoEm_key"
  ON "alertas_operacionais"("viagemId", "tipo", "resolvidoEm");
CREATE INDEX "alertas_operacionais_contaId_resolvidoEm_severidade_idx"
  ON "alertas_operacionais"("contaId", "resolvidoEm", "severidade");
CREATE INDEX "alertas_operacionais_contaId_idx" ON "alertas_operacionais"("contaId");

ALTER TABLE "eventos_viagem" ADD CONSTRAINT "eventos_viagem_encerradoPorId_fkey" FOREIGN KEY ("encerradoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "alertas_operacionais" ADD CONSTRAINT "alertas_operacionais_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "alertas_operacionais" ADD CONSTRAINT "alertas_operacionais_viagemId_fkey" FOREIGN KEY ("viagemId") REFERENCES "viagens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "alertas_operacionais" ADD CONSTRAINT "alertas_operacionais_motoristaId_fkey" FOREIGN KEY ("motoristaId") REFERENCES "motoristas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "alertas_operacionais" ADD CONSTRAINT "alertas_operacionais_resolvidoPorId_fkey" FOREIGN KEY ("resolvidoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
