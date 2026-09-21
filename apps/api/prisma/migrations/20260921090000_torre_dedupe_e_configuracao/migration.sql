-- Torre de controle: o dedup que nunca dedupou, e a régua que ninguém podia mexer.
--
-- O alerta era criado com `create` dentro de um try/catch confiando neste índice:
--
--   CREATE UNIQUE INDEX ... ON "alertas_operacionais"("viagemId","tipo","resolvidoEm");
--
-- Alerta vivo tem "resolvidoEm" NULL, e no Postgres dois NULL nunca colidem num
-- índice único (NULLS DISTINCT é o default). O `create` passava SEMPRE. O catch
-- que o código tratava como "caminho normal a cada 5 minutos" jamais foi
-- atingido: uma viagem esquecida aberta rendia 288 alertas e 288 notificações
-- por dia, por pessoa, e a tela da torre (take: 100) enchia de cópias do mesmo
-- aviso a ponto de esconder um alerta novo de outra viagem.

-- 1) Tipo novo: viagem esquecida não é "parada longa". A ação é outra (fechar no
--    painel, não ligar pro motorista) e por isso ela nunca vira notificação.
ALTER TYPE "TipoAlertaOperacional" ADD VALUE IF NOT EXISTS 'VIAGEM_ESQUECIDA';

-- 2) Carimbo de "já avisei". O mesmo problema notifica UMA vez; a varredura
--    seguinte atualiza a linha e só volta a incomodar se a situação PIOROU.
ALTER TABLE "alertas_operacionais"
  ADD COLUMN "notificadoEm" TIMESTAMP(3),
  ADD COLUMN "severidadeNotificada" TEXT,
  ADD COLUMN "resolvidoAuto" BOOLEAN NOT NULL DEFAULT false;

-- Quem já está vivo e ALTA já incomodou alguém — muito. Carimbar como notificado
-- impede que a primeira varredura depois do deploy mande tudo de novo.
UPDATE "alertas_operacionais"
   SET "notificadoEm" = "detectadoEm", "severidadeNotificada" = "severidade"
 WHERE "resolvidoEm" IS NULL;

-- 3) Resolver as duplicatas já geradas, mantendo a mais ANTIGA de cada
--    (viagem, tipo) — a que tem o `detectadoEm` verdadeiro do problema.
--    Resolve em vez de apagar: saber que o caminhão ficou parado ontem é o dado
--    que explica o atraso de hoje, e é a regra da casa pra esta tabela.
UPDATE "alertas_operacionais" a
   SET "resolvidoEm" = now(), "resolvidoAuto" = true
  FROM (
    SELECT "id",
           row_number() OVER (
             PARTITION BY "viagemId", "tipo"
             ORDER BY "detectadoEm" ASC, "id" ASC
           ) AS n
      FROM "alertas_operacionais"
     WHERE "resolvidoEm" IS NULL
  ) dup
 WHERE a."id" = dup."id" AND dup.n > 1;

-- Alerta vivo de viagem que já não está em andamento também morre aqui: nada
-- nunca resolveu esses, e eles ficavam na tela para sempre.
UPDATE "alertas_operacionais" a
   SET "resolvidoEm" = now(), "resolvidoAuto" = true
  FROM "viagens" v
 WHERE a."viagemId" = v."id"
   AND a."resolvidoEm" IS NULL
   AND v."status" <> 'EM_ANDAMENTO';

-- 4) O índice que de fato dedupe. Parcial, e não NULLS NOT DISTINCT: com a
--    chave incluindo "resolvidoEm", dois alertas resolvidos no MESMO
--    milissegundo passariam a colidir e virar 500 na cara do supervisor. A
--    regra de negócio é sobre os VIVOS.
DROP INDEX IF EXISTS "alertas_operacionais_viagemId_tipo_resolvidoEm_key";
CREATE UNIQUE INDEX "alertas_operacionais_vivo_key"
  ON "alertas_operacionais" ("viagemId", "tipo")
  WHERE "resolvidoEm" IS NULL;

-- 5) Limpar o estoque de ruído no sininho. A impressão digital é exata: só a
--    torre manda "nova-viagem" com `alertaId` dentro de `dados` — viagem nova de
--    verdade nunca tem esse campo. São, literalmente, as centenas de "Nova
--    viagem · fulano sem registrar nada" que ninguém pediu pra receber.
DELETE FROM "admin_notificacoes"
 WHERE "tipo" = 'nova-viagem'
   AND "dados" ? 'alertaId';

-- 6) Carimbo pra viagem fechada sem o motorista ter finalizado.
ALTER TYPE "MotivoDivergencia" ADD VALUE IF NOT EXISTS 'VIAGEM_ABANDONADA';

-- 7) A régua da torre, por conta. Os defaults são os números que estavam
--    chumbados no código — ligar isto não muda o comportamento de ninguém.
CREATE TABLE "configuracao_torre" (
    "contaId" TEXT NOT NULL DEFAULT '__SEM_CONTA__',
    "id" TEXT NOT NULL,
    "paradaLongaMin" INTEGER NOT NULL DEFAULT 120,
    "paradaLongaAltaMin" INTEGER NOT NULL DEFAULT 240,
    "viagemEsquecidaMin" INTEGER NOT NULL DEFAULT 720,
    "semSinalMin" INTEGER NOT NULL DEFAULT 180,
    "horaInicio" INTEGER NOT NULL DEFAULT 6,
    "horaFim" INTEGER NOT NULL DEFAULT 20,
    "notificaDomingo" BOOLEAN NOT NULL DEFAULT true,
    "fecharAbandonadaHoras" INTEGER NOT NULL DEFAULT 0,
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    "alteradoPorId" TEXT,
    CONSTRAINT "configuracao_torre_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "configuracao_torre_contaId_key" ON "configuracao_torre"("contaId");

ALTER TABLE "configuracao_torre" ADD CONSTRAINT "configuracao_torre_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "configuracao_torre" ADD CONSTRAINT "configuracao_torre_alteradoPorId_fkey"
  FOREIGN KEY ("alteradoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
